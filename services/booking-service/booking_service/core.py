"""The booking rules that BOTH the worker (Kafka path) and the API baseline (USE_KAFKA=off) use, so there is one copy.

decide()   "can this processing request hold its nights?"  ->  pending (nights held) or failed.
release()  free the nights of a reservation (decline, cancel, expiry).
Both run inside the caller's database transaction. Events go out AFTER the commit (see the *_after_commit helpers).
"""
from __future__ import annotations

import logging
import uuid
from typing import Any, Callable

from xenia_shared import availability as avail
from xenia_shared.cache import get_cache
from xenia_shared.db import Database
from xenia_shared.envelope import make_envelope
from xenia_shared.kafka import KafkaUnavailable, publish
from xenia_shared.timeutil import utc_now

from . import models, repository

log = logging.getLogger("xenia.booking")
SERVICE = "booking-service"
WORKER = "booking-worker"


def decide(conn, db: Database, row: dict[str, Any], actor: str = WORKER) -> tuple[str, dict[str, Any] | None]:
    """Hold the nights of `row` (status 'processing') or record why not. Returns ('pending', block) or ('failed', None).

    THE double-booking guard is the PRIMARY KEY (property_id, night_date) of availability_nights:
    insert_block writes one row per night, and MySQL refuses the second writer of any night (error 1062).
    The reservation is `row`, locked by the caller (SELECT ... FOR UPDATE), so it is decided exactly once.
    """
    duplicate = repository.duplicate_request(conn, row)
    if duplicate:
        message = f"You already have a request for these dates at this place ({duplicate['reservation_id']})."
        repository.change_status(conn, row, "failed", actor, message, "DUPLICATE_BOOKING")
        return "failed", None
    availability_id = db.next_id("a")
    held = avail.try_insert_block(
        conn, availability_id, row["property_id"], repository.as_date(row["check_in"]), repository.as_date(row["check_out"]), "booked", "booking", row["reservation_id"]
    )
    if not held:  # some night was already taken: only OUR insert was undone (savepoint), the transaction goes on
        repository.change_status(conn, row, "failed", actor, models.DATE_CONFLICT_TEXT, "DATE_CONFLICT")
        return "failed", None
    repository.change_status(conn, row, "pending", actor, None, None, "dates held")
    return "pending", avail.get_block(conn, availability_id)


def release(conn, row: dict[str, Any]) -> dict[str, Any] | None:
    """Free the nights held by this reservation. Returns the block as it was (to announce it), or None if it held none."""
    block = repository.booking_block(conn, row["reservation_id"])
    if block is not None:
        avail.delete_block(conn, block["availability_id"])
    return block


# ---------- events (call these AFTER the transaction committed) ----------
def _send(topic: str, envelope: dict[str, Any]) -> bool:
    try:
        publish(topic, envelope)
        return True
    except KafkaUnavailable as problem:
        log.warning("Kafka unavailable, %s not published: %s", envelope["event_type"], problem)
        return False


def availability_event(event_type: str, block: dict[str, Any], reason: str, trace_id: str) -> None:
    """availability.blocked / .released for the live calendar. Also drops the cache here, in case Kafka is down."""
    get_cache().invalidate_availability(block["property_id"])
    if event_type == "availability.released":
        block = {**block, "updated_datetime": utc_now().replace(tzinfo=None)}  # when it was removed; the block is as it was
    _send(event_type, avail.availability_envelope(event_type, block, reason, trace_id, SERVICE))


def booking_event(event_type: str, row: dict[str, Any], actor_id: str, extra: dict[str, Any] | None = None) -> bool:
    """booking.requested / approved / declined / cancelled / completed, carrying the reservation's own trace_id."""
    payload = {**models.reservation_json(row), **(extra or {})}
    envelope = make_envelope(
        event_type, row["trace_id"], actor_id, "reservation", row["reservation_id"], payload,
        idempotency_key=f"{row['trace_id']}:{event_type}",
    )
    return _send(event_type, envelope)


def after_hold(row: dict[str, Any], outcome: str, block: dict[str, Any] | None) -> list[Callable[[], None]]:
    """What to do once a decision is committed: announce the held dates (nothing for a failed request)."""
    if outcome == "pending" and block is not None:
        return [lambda: availability_event("availability.blocked", block, "booking_requested", row["trace_id"])]
    return []


def new_trace_id() -> str:
    return str(uuid.uuid4())
