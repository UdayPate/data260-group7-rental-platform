"""Fixtures for the AI service tests.

The whole debate runs for real: the API, the chair and the five agents as separate consumer threads
talking ONLY through the shared in-memory Kafka (MemoryTransport: 3 partitions per topic, keys,
consumer groups, committed offsets), MongoDB through mongomock, and the listing data from the
MySQL test database (Tanya's `database` fixture: schema + the mock seed).
"""
from __future__ import annotations

import mongomock
import pytest
from fastapi.testclient import TestClient

from xenia_shared import kafka as kafka_module
from xenia_shared.mongo import set_mongo_client

from ai_testkit import AiHarness


@pytest.fixture()
def ai(database, kafka, monkeypatch):
    from ai_service import chair as chair_module
    from ai_service import llm, store, workers
    from ai_service.main import app

    set_mongo_client(mongomock.MongoClient())
    store.reset_for_tests()
    kafka_module._seen = kafka_module._SeenInMemory()  # the same task ids start again in every test
    llm.set_client(None)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(chair_module, "ROUND_DEADLINE_MS", 2500)  # shorter rounds so the timeout tests are quick
    monkeypatch.setattr(chair_module, "STEP_DEADLINE_MS", 4000)
    threads = workers.start_in_threads()
    with TestClient(app) as client:
        yield AiHarness(client)
    for _thread, stop in threads:
        stop.set()
    set_mongo_client(None)
