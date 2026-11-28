"""Journey steps for the dashboards (spec section 8: "Persist trace_id, event_type, service name,
timestamp, latency, status, and error details for every important workflow step").

emit_step() publishes one `trace.steps` message. The Analytics service stores it, so a whole
booking or recommendation can be shown by filtering on its trace_id.

The envelope payload is exactly the contract's TraceStep, minus the fields the envelope already has:
    { "service": "booking-service", "step_event_type": "booking.requested",
      "latency_ms": 12, "status": "ok", "error": null }
  status is one of: ok | retried | failed | timed_out | dead_lettered
"""
from __future__ import annotations

import logging
from typing import Any

from .envelope import make_envelope

log = logging.getLogger("xenia.trace")

STATUSES = {"ok", "retried", "failed", "timed_out", "dead_lettered"}


def emit_step(
    trace_id: str,
    event_type: str,
    service: str,
    latency_ms: float = 0,
    status: str = "ok",
    error: str | None = None,
    extra: dict[str, Any] | None = None,
) -> None:
    """Publish one journey step. Never raises: a broken dashboard must not break a booking."""
    from .kafka import publish  # imported here to avoid a circular import

    if status not in STATUSES:
        raise ValueError(f"status must be one of {sorted(STATUSES)}")
    payload = {"service": service, "step_event_type": event_type, "latency_ms": round(latency_ms, 1), "status": status, "error": error}
    if extra:
        payload["extra"] = extra
    try:
        publish("trace.steps", make_envelope("trace.step", trace_id, service, "trace", trace_id, payload), key=trace_id)
    except Exception as problem:  # noqa: BLE001
        log.warning("could not publish trace step %s for %s: %s", event_type, trace_id, problem)
