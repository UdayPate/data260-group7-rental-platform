"""Redis cache for property search results and availability (spec 13.9, mandatory).

How invalidation works (the whole idea in four lines):
  * every cache key contains a VERSION number:  search:<version>:<hash of the filters>
  * any change that could alter a search result (listing created / edited / deleted, price or status
    changed, availability changed, a new review changing the rating) does ONE cheap operation:
    INCR search:version
  * the old keys are now unreachable (nobody asks for the old version), so stale data cannot be
    returned; Redis deletes them later by their TTL
  * availability responses use a per-property version the same way (avail:<property_id>:v)

If Redis is down the cache is skipped: every call falls back to MySQL, the API never fails because of it.
"""
from __future__ import annotations

import hashlib
import json
import logging
import threading
import time
from typing import Any

from .config import env_flag, env_int, env_str

log = logging.getLogger("xenia.cache")

SEARCH_VERSION_KEY = "search:version"
RETRY_REDIS_AFTER_SECONDS = 2.0  # after a failure, do not wait on a dead Redis for every request


class SearchCache:
    def __init__(self, url: str | None = None):
        self._url = url
        self._client = None
        self._down_until = 0.0
        self._missed_bump = False  # a bump that could not be sent while Redis was down
        self._lock = threading.Lock()
        self.stats = {"hits": 0, "misses": 0, "errors": 0, "bumps": 0}

    # ---- switches ----
    @staticmethod
    def enabled() -> bool:
        """SEARCH_CACHE=on|off (the cache comparison for the performance report, spec 9)."""
        return env_flag("SEARCH_CACHE", True)

    @staticmethod
    def ttl() -> int:
        return env_int("SEARCH_CACHE_TTL_SECONDS", 600)

    # ---- plumbing ----
    def _redis(self):
        import redis

        if self._client is None:
            self._client = redis.Redis.from_url(
                self._url or env_str("REDIS_URL", "redis://localhost:6379/0"),
                decode_responses=True,
                socket_connect_timeout=0.25,
                socket_timeout=0.25,
            )
        return self._client

    def _call(self, operation, default: Any = None) -> Any:
        """Run one Redis operation; on any Redis problem log it, remember it, and return `default`."""
        if time.monotonic() < self._down_until:
            return default
        try:
            result = operation(self._redis())
            return result
        except Exception as problem:  # noqa: BLE001  (redis.RedisError, OSError, timeouts...)
            self.stats["errors"] += 1
            self._down_until = time.monotonic() + RETRY_REDIS_AFTER_SECONDS
            log.warning("Redis unavailable, serving from MySQL: %s", problem)
            return default

    def _flush_missed_bump(self) -> None:
        if self._missed_bump:
            if self._call(lambda r: r.incr(SEARCH_VERSION_KEY)) is not None:
                self._missed_bump = False

    # ---- search results ----
    @staticmethod
    def _hash(filters: dict[str, Any]) -> str:
        return hashlib.sha1(json.dumps(filters, sort_keys=True, separators=(",", ":")).encode()).hexdigest()[:20]

    def _search_key(self, filters: dict[str, Any]) -> str | None:
        self._flush_missed_bump()
        version = self._call(lambda r: r.get(SEARCH_VERSION_KEY))
        if version is None and time.monotonic() < self._down_until:
            return None
        return f"search:{version or 0}:{self._hash(filters)}"

    def get_search(self, filters: dict[str, Any]) -> dict[str, Any] | None:
        """The cached page for these filters, or None (a miss, or Redis is down)."""
        if not self.enabled():
            return None
        key = self._search_key(filters)
        raw = self._call(lambda r: r.get(key)) if key else None
        if raw is None:
            self.stats["misses"] += 1
            return None
        self.stats["hits"] += 1
        return json.loads(raw)

    def set_search(self, filters: dict[str, Any], value: dict[str, Any]) -> None:
        if not self.enabled():
            return
        key = self._search_key(filters)
        if key:
            self._call(lambda r: r.set(key, json.dumps(value, separators=(",", ":")), ex=self.ttl()))

    # ---- availability of one property ----
    def _avail_key(self, property_id: str, start: str, end: str) -> str | None:
        version = self._call(lambda r: r.get(f"avail:{property_id}:v"))
        if version is None and time.monotonic() < self._down_until:
            return None
        return f"avail:{property_id}:{version or 0}:{start}:{end}"

    def get_availability(self, property_id: str, start: str, end: str) -> list[dict[str, Any]] | None:
        if not self.enabled():
            return None
        key = self._avail_key(property_id, start, end)
        raw = self._call(lambda r: r.get(key)) if key else None
        if raw is None:
            self.stats["misses"] += 1
            return None
        self.stats["hits"] += 1
        return json.loads(raw)

    def set_availability(self, property_id: str, start: str, end: str, items: list[dict[str, Any]]) -> None:
        if not self.enabled():
            return
        key = self._avail_key(property_id, start, end)
        if key:
            self._call(lambda r: r.set(key, json.dumps(items, separators=(",", ":")), ex=self.ttl()))

    # ---- invalidation ----
    def invalidate_search(self) -> float:
        """A listing or its rating changed. Returns how long the invalidation took, in milliseconds."""
        started = time.perf_counter()
        sent = self._call(lambda r: r.incr(SEARCH_VERSION_KEY))
        if sent is None:
            self._missed_bump = True  # do it as soon as Redis is back
        else:
            self.stats["bumps"] += 1
        return (time.perf_counter() - started) * 1000

    def invalidate_availability(self, property_id: str) -> float:
        """The nights of one property changed: its availability answers AND every search result change."""
        started = time.perf_counter()
        self._call(lambda r: r.incr(f"avail:{property_id}:v"))
        self.invalidate_search()
        return (time.perf_counter() - started) * 1000


_cache = SearchCache()


def get_cache() -> SearchCache:
    return _cache
