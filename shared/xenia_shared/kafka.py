"""Kafka for every service: publish(), run_consumer(), and a stand-in broker for tests.

The rules this file enforces for EVERY message (spec 6.2, 10, 13.2):

  publish()       validates the envelope BEFORE sending. An invalid message is never sent.
  run_consumer()  validates the envelope AFTER receiving. An invalid message goes to the
                  `dead.letter` topic with its original trace_id and the reason, never to the handler.
                  Then, for a valid message:
                    1. skip it if its idempotency_key was already processed (duplicate delivery)
                    2. run the handler; transient failures (deadlock, DB briefly down) are retried
                       with bounded exponential backoff (1 s, 2 s, 4 s), then dead-lettered
                    3. commit the Kafka offset ONLY AFTER the handler's database transaction committed

Why that order: Kafka delivers "at least once". If the worker dies after the database write but
before the offset commit, the message comes again. The processed_events row, written in the SAME
database transaction as the change, makes the second delivery a harmless no-op.
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time
import uuid
import zlib
from abc import ABC, abstractmethod
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any, Callable

from .config import env_float, env_str
from .db import Database, is_duplicate_key, is_transient
from .envelope import EnvelopeError, make_envelope, validate
from .timeutil import utc_now

log = logging.getLogger("xenia.kafka")

# Must match infra/kafka/create-topics.sh. Auto-creation is off in Kafka, so a typo would fail.
TOPICS: tuple[str, ...] = (
    "booking.requested", "booking.approved", "booking.declined", "booking.cancelled", "booking.completed",
    "availability.blocked", "availability.released",
    "property.viewed", "property.saved", "search.performed", "availability.notified",
    "review.created", "message.sent",
    "ai.requests", "debate.round.0", "debate.round.1", "debate.round.2", "ai.results",
    "trace.steps", "dead.letter",
)
PARTITIONS = 3

# Wait 1 s, 2 s, then 4 s between tries (so one first try + three retries), then dead-letter.
RETRY_BACKOFF_SECONDS = (1.0, 2.0, 4.0)


class KafkaUnavailable(Exception):
    """The message could not be delivered (broker down or too slow)."""


class PermanentError(Exception):
    """A handler raises this for a message that can never succeed: no retries, straight to dead.letter."""


class TransientError(Exception):
    """A handler raises this for a failure that may go away: the consumer retries with backoff."""


@dataclass
class Record:
    topic: str
    partition: int
    offset: int
    key: str | None
    value: bytes


# ---------------------------------------------------------------------------------------------
# Transports: the real broker (confluent-kafka) and an in-memory one for tests / no-Docker work
# ---------------------------------------------------------------------------------------------
class TransportConsumer(ABC):
    @abstractmethod
    def poll(self, timeout: float) -> Record | None: ...

    @abstractmethod
    def commit(self, record: Record) -> None: ...

    @abstractmethod
    def close(self) -> None: ...


class Transport(ABC):
    @abstractmethod
    def produce(self, topic: str, key: str | None, value: bytes) -> None: ...

    @abstractmethod
    def consumer(self, topics: list[str], group: str, offset_reset: str = "earliest") -> TransportConsumer: ...


class MemoryTransport(Transport):
    """A tiny Kafka in one process: topics with 3 partitions, keys choose the partition, consumer
    groups with committed offsets. A consumer that stops WITHOUT committing gets the message again
    when the next consumer of the same group starts, exactly like the real thing (spec 13.2).

    Set `available = False` to simulate a broker that is down."""

    def __init__(self, partitions: int = PARTITIONS):
        self.partitions = partitions
        self.available = True
        self._log: dict[tuple[str, int], list[Record]] = {}
        self._committed: dict[tuple[str, str, int], int] = {}
        self._members: dict[str, list["_MemoryConsumer"]] = {}
        self._round_robin = 0
        self._cond = threading.Condition(threading.RLock())

    def produce(self, topic: str, key: str | None, value: bytes) -> None:
        if topic not in TOPICS:
            raise KafkaUnavailable(f"unknown topic '{topic}' (topics are created by infra/kafka/create-topics.sh)")
        with self._cond:
            if not self.available:
                raise KafkaUnavailable("broker is down (memory transport)")
            if key is None:
                partition = self._round_robin % self.partitions
                self._round_robin += 1
            else:
                partition = zlib.crc32(key.encode()) % self.partitions
            entries = self._log.setdefault((topic, partition), [])
            entries.append(Record(topic, partition, len(entries), key, value))
            self._cond.notify_all()

    def consumer(self, topics: list[str], group: str, offset_reset: str = "earliest") -> "_MemoryConsumer":
        member = _MemoryConsumer(self, topics, group, offset_reset)
        with self._cond:
            self._members.setdefault(group, []).append(member)
        return member

    # ---- helpers for tests and evidence ----
    def messages(self, topic: str) -> list[dict[str, Any]]:
        """Every message ever sent to a topic (all partitions), as dicts, in send order per partition."""
        with self._cond:
            out = [r for (t, _), rs in self._log.items() if t == topic for r in rs]
        return [json.loads(r.value) for r in sorted(out, key=lambda r: (r.partition, r.offset))]

    def lag(self, group: str, topic: str) -> int:
        """Messages in `topic` that `group` has not committed yet (what `kafka-consumer-groups` shows)."""
        with self._cond:
            total = 0
            for (t, p), rs in self._log.items():
                if t == topic:
                    total += len(rs) - self._committed.get((group, t, p), 0)
            return total

    def committed_offsets(self, group: str, topic: str) -> dict[int, int]:
        with self._cond:
            return {p: self._committed.get((group, topic, p), 0) for p in range(self.partitions)}


class _MemoryConsumer(TransportConsumer):
    def __init__(self, broker: MemoryTransport, topics: list[str], group: str, offset_reset: str):
        self.broker, self.topics, self.group, self.offset_reset = broker, topics, group, offset_reset
        self._position: dict[tuple[str, int], int] = {}
        self._closed = False
        self._start_ends = {(t, p): len(broker._log.get((t, p), [])) for t in topics for p in range(broker.partitions)}

    def _assigned(self) -> list[tuple[str, int]]:
        members = [m for m in self.broker._members.get(self.group, []) if not m._closed]
        index = members.index(self) if self in members else 0
        everything = sorted((t, p) for t in self.topics for p in range(self.broker.partitions))
        return [tp for i, tp in enumerate(everything) if i % max(len(members), 1) == index]

    def poll(self, timeout: float) -> Record | None:
        deadline = time.monotonic() + timeout
        with self.broker._cond:
            while True:
                if self._closed:
                    return None
                assigned = self._assigned()
                for tp in list(self._position):
                    if tp not in assigned:
                        del self._position[tp]  # another member took this partition
                for tp in assigned:
                    if tp not in self._position:
                        committed = self.broker._committed.get((self.group, tp[0], tp[1]))
                        if committed is not None:
                            self._position[tp] = committed
                        else:
                            self._position[tp] = 0 if self.offset_reset == "earliest" else self._start_ends[tp]
                    entries = self.broker._log.get(tp, [])
                    if self._position[tp] < len(entries):
                        record = entries[self._position[tp]]
                        self._position[tp] += 1
                        return record
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None
                self.broker._cond.wait(min(remaining, 0.05))

    def commit(self, record: Record) -> None:
        with self.broker._cond:
            key = (self.group, record.topic, record.partition)
            self.broker._committed[key] = max(self.broker._committed.get(key, 0), record.offset + 1)

    def close(self) -> None:
        with self.broker._cond:
            self._closed = True
            self.broker._cond.notify_all()


class ConfluentTransport(Transport):
    """The real broker, through the confluent-kafka library (librdkafka)."""

    def __init__(self, bootstrap: str):
        from confluent_kafka import Producer  # imported here so tests need no broker library at import time

        self.bootstrap = bootstrap
        timeout_ms = int(env_float("KAFKA_SEND_TIMEOUT_SECONDS", 5.0) * 1000)
        self._send_timeout = timeout_ms / 1000 + 2
        self._producer = Producer(
            {
                "bootstrap.servers": bootstrap,
                "enable.idempotence": True,  # no duplicates from producer retries
                "acks": "all",
                "linger.ms": 0,
                "message.timeout.ms": timeout_ms,
                "socket.timeout.ms": min(timeout_ms, 10000),
            }
        )
        threading.Thread(target=self._serve_callbacks, name="kafka-producer-poll", daemon=True).start()

    def _serve_callbacks(self) -> None:
        while True:
            self._producer.poll(0.05)

    def produce(self, topic: str, key: str | None, value: bytes) -> None:
        done = threading.Event()
        outcome: dict[str, Any] = {}

        def delivered(error, _message) -> None:
            outcome["error"] = error
            done.set()

        try:
            self._producer.produce(topic, value=value, key=key, on_delivery=delivered)
        except BufferError as problem:
            raise KafkaUnavailable(f"send queue is full: {problem}") from problem
        except Exception as problem:  # noqa: BLE001
            raise KafkaUnavailable(str(problem)) from problem
        if not done.wait(self._send_timeout):
            raise KafkaUnavailable("timed out waiting for the broker to confirm the message")
        if outcome.get("error"):
            raise KafkaUnavailable(str(outcome["error"]))

    def consumer(self, topics: list[str], group: str, offset_reset: str = "earliest") -> TransportConsumer:
        from confluent_kafka import Consumer

        consumer = Consumer(
            {
                "bootstrap.servers": self.bootstrap,
                "group.id": group,
                "enable.auto.commit": False,  # we commit by hand, AFTER the database transaction
                "auto.offset.reset": offset_reset,
                "session.timeout.ms": 10000,
            }
        )
        consumer.subscribe(topics)
        return _ConfluentConsumer(consumer)


class _ConfluentConsumer(TransportConsumer):
    def __init__(self, consumer):
        self._consumer = consumer

    def poll(self, timeout: float) -> Record | None:
        message = self._consumer.poll(timeout)
        if message is None:
            return None
        if message.error():
            # A "partition end" or a temporary broker problem: not a message. Keep polling.
            log.warning("kafka consumer: %s", message.error())
            return None
        key = message.key().decode() if message.key() else None
        return Record(message.topic(), message.partition(), message.offset(), key, message.value())

    def commit(self, record: Record) -> None:
        from confluent_kafka import TopicPartition

        self._consumer.commit(offsets=[TopicPartition(record.topic, record.partition, record.offset + 1)], asynchronous=False)

    def close(self) -> None:
        self._consumer.close()


_transport: Transport | None = None
_transport_lock = threading.Lock()


def get_transport() -> Transport:
    """The process-wide transport: KAFKA_TRANSPORT=memory for tests, otherwise Kafka at KAFKA_BOOTSTRAP."""
    global _transport
    with _transport_lock:
        if _transport is None:
            if env_str("KAFKA_TRANSPORT", "kafka").lower() == "memory":
                _transport = MemoryTransport()
            else:
                _transport = ConfluentTransport(env_str("KAFKA_BOOTSTRAP", "localhost:9092"))
        return _transport


def set_transport(transport: Transport | None) -> None:
    global _transport
    with _transport_lock:
        _transport = transport


# ---------------------------------------------------------------------------------------------
# publish
# ---------------------------------------------------------------------------------------------
def publish(topic: str, envelope: dict[str, Any], key: str | None = None, transport: Transport | None = None) -> None:
    """Validate the envelope, then send it. Raises EnvelopeError (nothing sent) or KafkaUnavailable.

    `key` decides the partition: messages with the same key are read in order. Booking events use
    the property_id, AI events use the trace_id. Default: the entity id.
    """
    validate(envelope)  # BEFORE publishing (spec 6.2)
    chosen_key = key if key is not None else envelope["entity"]["entity_id"]
    (transport or get_transport()).produce(topic, chosen_key, json.dumps(envelope, separators=(",", ":")).encode())


def _trace_of(raw: Any) -> str | None:
    return raw["trace_id"] if isinstance(raw, dict) and isinstance(raw.get("trace_id"), str) and raw["trace_id"] else None


def dead_letter(
    transport: Transport,
    record: Record,
    reason: str,
    group: str,
    parsed: Any = None,
    invalid_fields: list[str] | None = None,
) -> None:
    """Publish a rejected message to `dead.letter`, keeping its ORIGINAL trace_id and the reason."""
    trace_id = _trace_of(parsed) or f"unknown-{uuid.uuid4()}"
    envelope = make_envelope(
        "dead.letter",
        trace_id,
        group,
        "message",
        f"{record.topic}:{record.partition}:{record.offset}",
        {
            "original_topic": record.topic,
            "partition": record.partition,
            "offset": record.offset,
            "reason": reason,
            "invalid_fields": invalid_fields or [],
            "consumer_group": group,
            "original_message": record.value.decode("utf-8", errors="replace")[:2000],
        },
        idempotency_key=f"dead:{group}:{record.topic}:{record.partition}:{record.offset}",
    )
    try:
        transport.produce("dead.letter", trace_id, json.dumps(envelope, separators=(",", ":")).encode())
    except KafkaUnavailable as problem:
        log.error("could not dead-letter %s:%s:%s (%s): %s", record.topic, record.partition, record.offset, reason, problem)
    else:
        log.warning("dead-lettered %s:%s:%s trace=%s: %s", record.topic, record.partition, record.offset, trace_id, reason)


# ---------------------------------------------------------------------------------------------
# consume
# ---------------------------------------------------------------------------------------------
# What a handler may return: nothing, one function, or a list of functions. They run AFTER the
# database transaction and the offset commit succeeded (e.g. "publish availability.blocked").
AfterCommit = Callable[[], None]
Handler = Callable[[dict[str, Any], Any], "AfterCommit | list[AfterCommit] | None"]


class _Duplicate(Exception):
    pass


class _SeenInMemory:
    """For consumers without a database: remember the last N idempotency keys."""

    def __init__(self, size: int = 20000):
        self._keys: OrderedDict[tuple[str, str], None] = OrderedDict()
        self._size = size
        self._lock = threading.Lock()

    def add(self, group: str, key: str) -> bool:
        """True if new, False if already seen."""
        with self._lock:
            if (group, key) in self._keys:
                return False
            self._keys[(group, key)] = None
            if len(self._keys) > self._size:
                self._keys.popitem(last=False)
            return True

    def forget(self, group: str, key: str) -> None:
        with self._lock:
            self._keys.pop((group, key), None)


_seen = _SeenInMemory()


def _backoff_seconds() -> list[float]:
    scale = env_float("RETRY_BACKOFF_SCALE", 1.0)  # tests set it to 0 so retries do not wait
    return [delay * scale for delay in RETRY_BACKOFF_SECONDS]


def process_record(
    record: Record,
    group: str,
    handler: Handler,
    service: str,
    db: Database | None = None,
    transport: Transport | None = None,
    commit: Callable[[Record], None] | None = None,
) -> str:
    """Handle ONE Kafka record. Returns 'processed', 'duplicate' or 'dead_lettered'.

    `commit` commits the Kafka offset; it is called only after the database transaction committed.
    """
    from .trace import emit_step

    transport = transport or get_transport()
    commit = commit or (lambda _record: None)

    # ---- 1. validate AFTER consuming (spec 6.2) ----
    parsed: Any = None
    try:
        parsed = json.loads(record.value)
        envelope = validate(parsed)
    except ValueError as problem:  # bad JSON, or EnvelopeError (a ValueError subclass)
        reason = problem.reason if isinstance(problem, EnvelopeError) else f"not valid JSON: {problem}"
        fields = problem.invalid_fields if isinstance(problem, EnvelopeError) else []
        dead_letter(transport, record, f"Rejected envelope: {reason}", group, parsed, fields)
        trace = _trace_of(parsed)
        if trace:
            emit_step(trace, record.topic, service, 0, "dead_lettered", f"Rejected envelope: {reason}")
        commit(record)
        return "dead_lettered"

    key = envelope["idempotency_key"]
    trace_id = envelope["trace_id"]
    delays = _backoff_seconds()
    attempt = 0
    while True:
        started = time.monotonic()
        try:
            after_commit: Any = None
            if db is not None:
                # ---- 2. the database change AND the idempotency record: ONE transaction ----
                with db.transaction() as conn:
                    try:
                        with conn.cursor() as cur:
                            cur.execute(
                                "INSERT INTO processed_events (consumer_group, idempotency_key, event_type, trace_id, processed_at) "
                                "VALUES (%s, %s, %s, %s, UTC_TIMESTAMP(3))",
                                (group, key, envelope["event_type"], trace_id),
                            )
                    except Exception as problem:  # noqa: BLE001
                        if is_duplicate_key(problem):
                            raise _Duplicate() from problem
                        raise
                    after_commit = handler(envelope, conn)
            else:
                if not _seen.add(group, key):
                    raise _Duplicate()
                try:
                    after_commit = handler(envelope, None)
                except BaseException:
                    _seen.forget(group, key)  # a failed attempt must not count as processed
                    raise
        except _Duplicate:
            log.info("skipping duplicate %s (%s) for group %s", key, envelope["event_type"], group)
            commit(record)
            return "duplicate"
        except Exception as problem:  # noqa: BLE001
            retryable = is_transient(problem) or isinstance(problem, (TransientError, KafkaUnavailable))
            elapsed = (time.monotonic() - started) * 1000
            if retryable and attempt < len(delays):
                emit_step(trace_id, envelope["event_type"], service, elapsed, "retried", f"{type(problem).__name__}: {problem}")
                log.warning("transient failure on %s (attempt %s), retrying in %ss: %s", key, attempt + 1, delays[attempt], problem)
                time.sleep(delays[attempt])
                attempt += 1
                continue
            reason = f"{'Gave up after retries' if retryable else 'Failed permanently'}: {type(problem).__name__}: {problem}"
            dead_letter(transport, record, reason, group, parsed)
            emit_step(trace_id, envelope["event_type"], service, elapsed, "dead_lettered", reason)
            commit(record)
            return "dead_lettered"

        # ---- 3. the transaction committed: NOW commit the offset, then run the follow-ups ----
        commit(record)
        for action in ([after_commit] if callable(after_commit) else (after_commit or [])):
            try:
                action()
            except Exception as problem:  # noqa: BLE001
                log.warning("follow-up action failed for %s: %s", key, problem)
        return "processed"


def run_consumer(
    topics: list[str],
    group: str,
    handler: Handler,
    service: str,
    db: Database | None = None,
    stop: threading.Event | None = None,
    transport: Transport | None = None,
    offset_reset: str = "earliest",
    poll_seconds: float = 1.0,
) -> None:
    """Consume `topics` as consumer group `group` until `stop` is set. Blocks; run it in a thread or a process.

    Consumer groups give scalability and fault tolerance: start several copies with the same
    `group` and Kafka shares the partitions between them; if one dies its partitions move to the others.
    """
    transport = transport or get_transport()
    stop = stop or threading.Event()
    consumer = transport.consumer(topics, group, offset_reset)
    log.info("consumer group '%s' started on %s", group, topics)
    try:
        while not stop.is_set():
            record = consumer.poll(poll_seconds)
            if record is None:
                continue
            try:
                process_record(record, group, handler, service, db, transport, consumer.commit)
            except Exception:  # noqa: BLE001
                # Never kill the loop. The offset was not committed, so the message comes again.
                log.exception("consumer '%s' failed on %s:%s:%s", group, record.topic, record.partition, record.offset)
                time.sleep(1)
    finally:
        consumer.close()
        log.info("consumer group '%s' stopped", group)


def start_consumer_thread(*args: Any, **kwargs: Any) -> tuple[threading.Thread, threading.Event]:
    """run_consumer() in a background thread. Returns (thread, stop_event); set the event to stop it."""
    stop = kwargs.pop("stop", None) or threading.Event()
    thread = threading.Thread(target=run_consumer, args=args, kwargs={**kwargs, "stop": stop}, name=f"consumer-{args[1] if len(args) > 1 else 'x'}", daemon=True)
    thread.start()
    return thread, stop
