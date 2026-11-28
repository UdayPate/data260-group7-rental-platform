"""Calling another Xenia service on behalf of the user (added by Himja for Messaging and Review).

The caller's own `Authorization: Bearer <token>` is forwarded, so the other service applies its
normal rules to the SAME user: a guest can only read their own reservation, a host only their own
listing's bookings. No service has a "super token".

    call("BOOKING_API_BASE_URL", "/bookings/get", {"reservation_id": "r_012"}, token)
        -> (200, {...})  or  (404, {"error": {...}})

Raises ApiError(SERVICE_UNAVAILABLE) when the other service cannot be reached.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from .config import env_float, env_str
from .errors import ApiError

log = logging.getLogger("xenia.upstream")

DEFAULT_URLS = {
    "USER_API_BASE_URL": "http://localhost:8001",
    "PROPERTY_API_BASE_URL": "http://localhost:8002",
    "BOOKING_API_BASE_URL": "http://localhost:8003",
}

# Tests replace this with a function (base_env, path, body, token) -> (status, json).
_override: Any = None


def set_override(fn: Any) -> None:
    global _override
    _override = fn


def call(base_env: str, path: str, body: dict[str, Any], token: str | None) -> tuple[int, Any]:
    if _override is not None:
        return _override(base_env, path, body, token)
    url = env_str(base_env, DEFAULT_URLS.get(base_env, "")) + path
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    try:
        response = httpx.post(url, json=body, headers=headers, timeout=env_float("UPSTREAM_TIMEOUT_SECONDS", 5.0))
    except httpx.HTTPError as problem:
        log.warning("could not reach %s: %s", url, problem)
        raise ApiError("SERVICE_UNAVAILABLE", "A service this needs is temporarily unavailable. Please try again in a moment.") from problem
    try:
        data = response.json()
    except ValueError:
        data = None
    if response.status_code >= 500:
        raise ApiError("SERVICE_UNAVAILABLE", "A service this needs is temporarily unavailable. Please try again in a moment.")
    return response.status_code, data
