"""Helpers for the AI evidence scripts (Himja). They talk to the RUNNING services:

  USER_API [http://localhost:8001]   for real logins (demo accounts, password demo1234)
  AI_API   [http://localhost:8007]   the AI service, with its agents running (python -m ai_service.workers ...)
  KAFKA_BOOTSTRAP [localhost:9092]   to show which partition each debate's key went to (skipped if unreachable)

Everything printed comes from the real system: the events are what the chair stored in MongoDB
(ai_events, returned by GET /ai/tasks/{id}), the partitions are read back from Kafka.
"""
from __future__ import annotations

import json
import os
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import USER_API, check, finish, login, show  # noqa: E402,F401

AI_API = os.environ.get("AI_API", "http://localhost:8007")
SPEC_REQUEST = "2 nights in San Jose for 2, under $250, parking, kitchen, rating ≥ 4.5"
AI_TOPICS = ["ai.requests", "debate.round.0", "debate.round.1", "debate.round.2", "ai.results"]


def ai(method: str, path: str, token: str, body: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(AI_API + path, data=data, method=method, headers={"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read() or b"{}")
    except urllib.error.HTTPError as problem:
        return problem.code, json.loads(problem.read() or b"{}")
    except urllib.error.URLError as problem:
        sys.exit(f"Could not reach the AI service at {AI_API}: {problem}. Start it (see services/ai-service/README.md).")


def start(token: str, guest_id: str, text: str, demo: dict | None = None) -> dict:
    status, body = ai("POST", "/ai/requests", token, {"guest_id": guest_id, "request_text": text, "demo": demo or {}})
    if status != 202:
        sys.exit(f"POST /ai/requests failed: {status} {body}")
    body["started"] = time.time()
    return body


def wait_done(token: str, task_id: str, seconds: float = 90) -> dict:
    end = time.time() + seconds
    while time.time() < end:
        _, body = ai("GET", f"/ai/tasks/{task_id}", token)
        if body.get("task", {}).get("status") in ("waiting_for_approval", "completed", "failed", "timed_out"):
            return body
        time.sleep(0.25)
    return body


def millis_between(a: str, b: str) -> float:
    parse = lambda t: datetime.fromisoformat(t.replace("Z", "+00:00"))  # noqa: E731
    return (parse(b) - parse(a)).total_seconds() * 1000


def round_of(event: dict) -> str:
    r = event["payload"].get("round")
    return f"round {r}" if r is not None else "setup / result"


def kafka_partitions(trace_ids: list[str], seconds: float = 8) -> dict[str, set[tuple[str, int]]] | None:
    """{trace_id: {(topic, partition)}} read back from Kafka, or None when Kafka can't be reached.
    The CLI equivalent: kafka-console-consumer.sh --topic debate.round.0 --from-beginning --property print.key=true --property print.partition=true"""
    try:
        from confluent_kafka import Consumer
    except ImportError:
        return None
    consumer = Consumer({"bootstrap.servers": os.environ.get("KAFKA_BOOTSTRAP", "localhost:9092"), "group.id": f"evidence-{time.time()}",
                         "auto.offset.reset": "earliest", "enable.auto.commit": False, "socket.timeout.ms": 3000})
    try:
        if not consumer.list_topics(timeout=3).topics:
            return None
    except Exception:  # noqa: BLE001
        return None
    consumer.subscribe(AI_TOPICS)
    found: dict[str, set[tuple[str, int]]] = {t: set() for t in trace_ids}
    keys_ok = True
    end = time.time() + seconds
    while time.time() < end:
        message = consumer.poll(0.5)
        if message is None or message.error():
            continue
        key = message.key().decode() if message.key() else None
        try:
            trace = json.loads(message.value())["trace_id"]
        except ValueError:
            continue
        if trace in found:
            found[trace].add((message.topic(), message.partition()))
            keys_ok = keys_ok and key == trace
    consumer.close()
    found["__keys_equal_trace_id__"] = {("ok", 1)} if keys_ok else set()
    return found
