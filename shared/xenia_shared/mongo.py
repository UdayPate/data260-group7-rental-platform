"""MongoDB access for the services that keep flexible documents (spec 3.2): reviews, messages,
AI tasks and debate events (Himja), events and traces (Rohini and Shashank).

    MONGO_URL        mongodb://localhost:27017   (the docker-compose Mongo)
                     mongomock://                an in-memory stand-in, for tests and for a laptop
                                                 without Docker (data is lost when the process stops,
                                                 and two processes do NOT share it)
    MONGO_DATABASE   xenia

get_mongo() returns the pymongo Database. Every service makes its own indexes at start-up
(ensure_indexes), so a fresh database always has the unique keys the rules depend on.
"""
from __future__ import annotations

import threading
from typing import Any

from .config import env_str

_client: Any = None
_lock = threading.Lock()


def _make_client(url: str) -> Any:
    if url.startswith("mongomock://"):
        import mongomock  # only needed for tests / no-Docker runs

        return mongomock.MongoClient(tz_aware=False)
    from pymongo import MongoClient

    # Short timeouts: a Mongo that is down must answer 503 quickly, not hang the request.
    return MongoClient(url, serverSelectionTimeoutMS=3000, connectTimeoutMS=3000)


def get_mongo() -> Any:
    """The process-wide database (pymongo Database object)."""
    global _client
    with _lock:
        if _client is None:
            _client = _make_client(env_str("MONGO_URL", "mongodb://localhost:27017"))
        return _client[env_str("MONGO_DATABASE", "xenia")]


def set_mongo_client(client: Any) -> None:
    """Replace the client (tests pass a fresh mongomock.MongoClient(), or None to reset)."""
    global _client
    with _lock:
        _client = client


def is_duplicate(error: BaseException) -> bool:
    """True for a unique-index violation (pymongo DuplicateKeyError, also raised by mongomock)."""
    return type(error).__name__ == "DuplicateKeyError"


def load_seed(name: str, millis: bool = True) -> list[dict[str, Any]]:
    """One list from infra/mongo/seed.json (made by infra/seed/export-mongo-seed.mjs), with every
    {"$dt": n} marker turned into the UTC datetime n days ago, so seed dates stay relative to today.
    millis=True gives '...T18:05:09.412Z' (messages), False gives '...T18:05:09Z' (reviews)."""
    import json
    from datetime import timedelta
    from pathlib import Path

    from .timeutil import iso_millis, iso_seconds, utc_now

    path = Path(__file__).resolve().parents[2] / "infra" / "mongo" / "seed.json"
    now = utc_now()

    def resolve(value: Any) -> Any:
        if isinstance(value, dict) and set(value) == {"$dt"}:
            moment = now - timedelta(days=value["$dt"])
            return iso_millis(moment) if millis else iso_seconds(moment)
        if isinstance(value, dict):
            return {k: resolve(v) for k, v in value.items()}
        if isinstance(value, list):
            return [resolve(v) for v in value]
        return value

    return resolve(json.loads(path.read_text())[name])


def clean(document: dict[str, Any] | None) -> dict[str, Any] | None:
    """Drop Mongo's internal _id so the document can be returned as JSON."""
    if document is None:
        return None
    document = dict(document)
    document.pop("_id", None)
    return document
