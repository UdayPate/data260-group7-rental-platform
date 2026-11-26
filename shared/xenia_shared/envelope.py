"""The shared Kafka envelope (spec 6.2). EVERY Kafka message in the project uses it.

    {
      "event_type": "booking.requested",          matches the topic name, or is derivable from it
      "trace_id": "6f1c2a9e-...",                 never changes across one whole workflow
      "timestamp": "2026-11-23T18:05:09.412Z",    UTC creation time
      "actor_id": "g_001",                        guest, host, service or system that caused it
      "entity": { "entity_type": "reservation", "entity_id": "r_065" },
      "payload": { ... },                         domain-specific fields
      "idempotency_key": "..."                    consumers use it to skip duplicates on retries
    }

validate() is called BEFORE publishing and AFTER consuming. A message that fails goes to the
`dead.letter` topic (see kafka.py); it is never accepted.
"""
from __future__ import annotations

import uuid
from typing import Any

from pydantic import BaseModel, ConfigDict, StrictStr, ValidationError, field_validator

from .timeutil import iso_millis, parse_iso

# Every event_type the platform knows. An unknown type is rejected on purpose (a typo would
# otherwise travel unnoticed). Add a name here when a new kind of event is introduced.
KNOWN_EVENT_TYPES: frozenset[str] = frozenset(
    {
        # Booking (Booking API and worker)
        "booking.requested", "booking.approved", "booking.declined", "booking.cancelled", "booking.completed",
        # Availability (booking worker, Property Service)
        "availability.blocked", "availability.released", "availability.notified",
        # Property activity
        "property.viewed", "property.saved", "search.performed",
        # Review and messaging services
        "review.created", "message.sent",
        # AI service: the topics themselves ...
        "ai.requests", "ai.results", "debate.round.0", "debate.round.1", "debate.round.2",
        # ... and the stream events of the contract (section 6.3)
        "task.status", "plan.created", "plan.step_updated", "requirements.parsed", "round.started",
        "opinion.published", "agent.output_rejected", "reflection.recorded", "disagreement.detected",
        "challenge.issued", "challenge.answered", "vote.cast", "agent.timed_out", "result.published",
        "decision.recorded",
        # Platform
        "trace.step", "dead.letter",
        # Payments (named in spec 6.1; not used yet)
        "payment.completed",
    }
)


class EnvelopeError(ValueError):
    """The message is not a valid envelope. `reason` is readable; `invalid_fields` lists the names."""

    def __init__(self, reason: str, invalid_fields: list[str] | None = None):
        super().__init__(reason)
        self.reason = reason
        self.invalid_fields = invalid_fields or []


class Entity(BaseModel):
    model_config = ConfigDict(extra="allow")
    entity_type: StrictStr
    entity_id: StrictStr

    @field_validator("entity_type", "entity_id")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be empty")
        return value


class Envelope(BaseModel):
    # extra="allow": the AI stream events add a `seq` field to the envelope (contract 6.3).
    model_config = ConfigDict(extra="allow")

    event_type: StrictStr
    trace_id: StrictStr
    timestamp: StrictStr
    actor_id: StrictStr
    entity: Entity
    payload: dict[str, Any]
    idempotency_key: StrictStr

    @field_validator("event_type")
    @classmethod
    def _known_event_type(cls, value: str) -> str:
        if value not in KNOWN_EVENT_TYPES:
            raise ValueError(f"unknown event_type '{value}'")
        return value

    @field_validator("trace_id", "actor_id", "idempotency_key")
    @classmethod
    def _not_blank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("must not be empty")
        return value

    @field_validator("timestamp")
    @classmethod
    def _utc_timestamp(cls, value: str) -> str:
        try:
            parsed = parse_iso(value)
        except ValueError as problem:
            raise ValueError(f"must be an ISO 8601 UTC time ({problem})") from problem
        if parsed.utcoffset().total_seconds() != 0 or not (value.endswith("Z") or value.endswith("+00:00")):
            raise ValueError("must be in UTC (end with Z)")
        return value


def validate(message: Any) -> dict[str, Any]:
    """Check one message. Returns it as a plain dict, or raises EnvelopeError with a readable reason."""
    if not isinstance(message, dict):
        raise EnvelopeError("the message is not a JSON object")
    try:
        Envelope.model_validate(message)
    except ValidationError as problem:
        fields: list[str] = []
        parts: list[str] = []
        for item in problem.errors():
            name = ".".join(str(p) for p in item["loc"]) or "message"
            fields.append(name)
            if item["type"] == "missing":
                parts.append(f"{name} is missing")
            else:
                parts.append(f"{name}: {item['msg'].removeprefix('Value error, ')}")
        raise EnvelopeError("; ".join(parts), fields) from problem
    return message


def make_envelope(
    event_type: str,
    trace_id: str,
    actor_id: str,
    entity_type: str,
    entity_id: str,
    payload: dict[str, Any],
    idempotency_key: str | None = None,
    timestamp: str | None = None,
) -> dict[str, Any]:
    """Build a valid envelope. The idempotency_key defaults to a fresh UUID (a unique event).

    Pass a stable key (e.g. "<trace_id>:booking.requested") when the SAME logical event could be
    created twice, so consumers recognise the repeat.
    """
    return {
        "event_type": event_type,
        "trace_id": trace_id,
        "timestamp": timestamp or iso_millis(),
        "actor_id": actor_id,
        "entity": {"entity_type": entity_type, "entity_id": entity_id},
        "payload": payload,
        "idempotency_key": idempotency_key or str(uuid.uuid4()),
    }
