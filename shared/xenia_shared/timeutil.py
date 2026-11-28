"""Time helpers. Timestamps are UTC (contract section 1). Calendar dates ("today", check-in and
check-out rules, the cancel cutoff, the daily job) are judged in America/Los_Angeles, where the
platform runs, so that the backend's "today" is the same day the guest sees in their browser.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from zoneinfo import ZoneInfo

# The one timezone for calendar dates (contract section 1).
LOCAL_TZ = ZoneInfo("America/Los_Angeles")


def utc_now() -> datetime:
    """The current time as a timezone-aware UTC datetime."""
    return datetime.now(timezone.utc)


def today_local() -> date:
    """Today's calendar date in America/Los_Angeles. Used for every "today" rule
    (check-in not in the past, the cancel cutoff, the daily job). At 6 pm Pacific this is still
    today, even though in UTC it is already tomorrow."""
    return utc_now().astimezone(LOCAL_TZ).date()


def seconds_until_local_midnight() -> float:
    """How long until the next calendar day starts in America/Los_Angeles (for the daily job)."""
    now = utc_now().astimezone(LOCAL_TZ)
    next_midnight = datetime.combine(now.date() + timedelta(days=1), datetime.min.time(), tzinfo=LOCAL_TZ)
    return max((next_midnight - now).total_seconds(), 1.0)


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
