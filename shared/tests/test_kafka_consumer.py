"""Spec 12 / guide step 2: a bad envelope goes to dead.letter, a duplicate key is skipped,
retries are bounded, and the offset is committed only after the database transaction (spec 13.2)."""
import json
import threading
import time

import pytest

from xenia_shared.envelope import make_envelope
from xenia_shared.kafka import MemoryTransport, PermanentError, Record, TransientError, process_record, publish, run_consumer


def envelope(key="k-1", trace="trace-1"):
    return make_envelope("booking.requested", trace, "g_001", "reservation", "r_065", {"n": 1}, key)


def record_of(value, topic="booking.requested", offset=0):
    raw = value if isinstance(value, bytes) else json.dumps(value).encode()
    return Record(topic, 0, offset, "r_065", raw)


def test_bad_envelope_goes_to_dead_letter_with_the_original_trace_id(kafka):
    seen = []
    bad = envelope(trace="trace-keep-me")
    del bad["idempotency_key"]
    committed = []
    outcome = process_record(record_of(bad), "g", lambda e, c: seen.append(e), "svc", transport=kafka, commit=committed.append)
    assert outcome == "dead_lettered" and seen == []          # the handler never saw it
    assert len(committed) == 1                                 # the offset moves on (it is not retried forever)
    dead = kafka.messages("dead.letter")
    assert len(dead) == 1
    assert dead[0]["trace_id"] == "trace-keep-me"
    assert "idempotency_key" in dead[0]["payload"]["reason"]
    assert dead[0]["payload"]["original_topic"] == "booking.requested"


def test_malformed_json_goes_to_dead_letter(kafka):
    outcome = process_record(record_of(b"{not json"), "g", lambda e, c: None, "svc", transport=kafka)
    assert outcome == "dead_lettered"
    assert kafka.messages("dead.letter")[0]["payload"]["reason"].startswith("Rejected envelope: not valid JSON")


def test_same_idempotency_key_is_handled_once_without_a_database(kafka):
    handled = []
    for offset in range(3):
        process_record(record_of(envelope("same-key"), offset=offset), "g-mem", lambda e, c: handled.append(1), "svc", transport=kafka)
    assert len(handled) == 1


def test_same_idempotency_key_is_handled_once_with_a_database(fresh_db, kafka):
    handled = []

    def handler(env, conn):
        handled.append(env["idempotency_key"])

    for offset in range(3):
        outcome = process_record(record_of(envelope("db-key"), offset=offset), "g-db", handler, "svc", db=fresh_db, transport=kafka)
    assert outcome == "duplicate" and handled == ["db-key"]
    with fresh_db.connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM processed_events WHERE consumer_group='g-db' AND idempotency_key='db-key'")
        assert cur.fetchone()["n"] == 1


def test_a_failing_handler_rolls_back_its_idempotency_record_and_is_dead_lettered(fresh_db, kafka):
    def handler(env, conn):
        raise PermanentError("this message can never work")

    outcome = process_record(record_of(envelope("bad-handler")), "g-db2", handler, "svc", db=fresh_db, transport=kafka)
    assert outcome == "dead_lettered"
    with fresh_db.connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM processed_events WHERE idempotency_key='bad-handler'")
        assert cur.fetchone()["n"] == 0                       # rolled back with the failed transaction


def test_transient_failures_are_retried_then_succeed(kafka):
    calls = []

    def handler(env, conn):
        calls.append(1)
        if len(calls) < 3:
            raise TransientError("database busy")

    assert process_record(record_of(envelope("retry-ok")), "g-r", handler, "svc", transport=kafka) == "processed"
    assert len(calls) == 3
    steps = [m["payload"] for m in kafka.messages("trace.steps")]
    assert [s["status"] for s in steps].count("retried") == 2   # each retry leaves a journey step


def test_retries_are_bounded_then_dead_lettered(kafka):
    calls = []

    def handler(env, conn):
        calls.append(1)
        raise TransientError("still down")

    assert process_record(record_of(envelope("retry-fail")), "g-r2", handler, "svc", transport=kafka) == "dead_lettered"
    assert len(calls) == 4                                     # first try + 3 retries (1 s, 2 s, 4 s in real life)
    assert "Gave up after retries" in kafka.messages("dead.letter")[0]["payload"]["reason"]


def test_offset_is_committed_only_after_the_handler_succeeded(kafka):
    order = []
    process_record(
        record_of(envelope("order")), "g-o", lambda e, c: order.append("handler"), "svc", transport=kafka,
        commit=lambda r: order.append("commit"),
    )
    assert order == ["handler", "commit"]


def test_follow_up_actions_run_after_the_commit(kafka):
    order = []
    process_record(
        record_of(envelope("after")), "g-a", lambda e, c: (lambda: order.append("follow-up")), "svc", transport=kafka,
        commit=lambda r: order.append("commit"),
    )
    assert order == ["commit", "follow-up"]


def test_consumer_group_redelivers_what_was_not_committed(kafka):
    """Spec 13.2 in miniature: a consumer that dies before committing leaves the message for the next one."""
    publish("booking.requested", envelope("redeliver"), key="p_001")
    first = kafka.consumer(["booking.requested"], "workers")
    record = first.poll(1)
    assert record is not None
    first.close()                                              # "crash": no commit
    assert kafka.lag("workers", "booking.requested") == 1      # Kafka still holds it
    second = kafka.consumer(["booking.requested"], "workers")
    again = second.poll(1)
    assert again is not None and again.offset == record.offset  # the restarted consumer gets it again
    second.commit(again)
    assert kafka.lag("workers", "booking.requested") == 0


def test_run_consumer_loop_end_to_end(kafka):
    handled = []
    stop = threading.Event()
    thread = threading.Thread(target=run_consumer, args=(["booking.requested"], "loop", lambda e, c: handled.append(e["idempotency_key"]), "svc"), kwargs={"stop": stop, "poll_seconds": 0.05}, daemon=True)
    thread.start()
    publish("booking.requested", envelope("loop-1"), key="p_001")
    bad = envelope("loop-bad")
    del bad["actor_id"]
    kafka.produce("booking.requested", "p_001", json.dumps(bad).encode())
    deadline = time.time() + 3
    while time.time() < deadline and (not handled or not kafka.messages("dead.letter")):
        time.sleep(0.02)
    stop.set()
    thread.join(2)
    assert handled == ["loop-1"]
    assert len(kafka.messages("dead.letter")) == 1
    assert kafka.lag("loop", "booking.requested") == 0


def test_same_key_goes_to_the_same_partition_and_unknown_topics_are_refused():
    broker = MemoryTransport()
    for _ in range(5):
        broker.produce("ai.requests", "trace-A", b"{}")
    populated = [p for p in range(3) if broker._log.get(("ai.requests", p))]
    assert len(populated) == 1                                 # all of one trace on one partition (spec 13.11)
    with pytest.raises(Exception):
        broker.produce("typo.topic", "k", b"{}")
