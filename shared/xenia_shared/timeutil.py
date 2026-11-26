"""Time helpers. Everything is UTC (contract section 1)."""
from __future__ import annotations

from datetime import date, datetime, timezone


def utc_now() -> datetime:
    """The current time as a timezone-aware UTC datetime."""
    return datetime.now(timezone.utc)


def today_utc() -> date:
    """Today's date in UTC. Used for every "before check-in day" rule."""
    return utc_now().date()


def iso_seconds(value: datetime) -> str:
    """'2026-11-23T18:05:09Z' (the format REST responses use)."""
    return value.replace(microsecond=0, tzinfo=None).isoformat() + "Z"


def iso_millis(value: datetime | None = None) -> str:
    """'2026-11-23T18:05:09.412Z' (the format Kafka envelopes use; latency is measured from it)."""
    value = value or utc_now()
    return value.replace(tzinfo=None).isoformat(timespec="milliseconds") + "Z"


def parse_iso(text: str) -> datetime:
    """Parse '2026-11-23T18:05:09Z' or '...+00:00' into an aware UTC datetime. Raises ValueError."""
    parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("timestamp has no timezone")
    return parsed.astimezone(timezone.utc)
