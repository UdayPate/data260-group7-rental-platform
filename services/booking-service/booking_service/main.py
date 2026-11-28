"""Xenia Booking Service API (port 8003). The WORKER is a separate process (python -m booking_service.worker).

    POST /bookings/request /get /byProperty /byGuest /approve /decline /cancel

Rules: docs/api/data-contract.md ("Booking Service" and section 5). Reference: frontend/src/mocks/handlers/bookings.ts.
Run:   uvicorn booking_service.main:app --port 8003
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import Depends
from fastapi.responses import JSONResponse

from xenia_shared.app import create_app
from xenia_shared.auth import Claims, require
from xenia_shared.cache import get_cache
from xenia_shared.config import env_flag, load_env
from xenia_shared.db import execute, get_db, is_duplicate_key
from xenia_shared.errors import ApiError
from xenia_shared.kafka import KafkaUnavailable
from xenia_shared.timeutil import today_local
from xenia_shared.validation import is_int, is_valid_date, json_body, require_fields, to_date

from . import core, models, repository

load_env()
log = logging.getLogger("xenia.booking.api")
app = create_app("booking-service")


def reservation_not_found(reservation_id: Any) -> ApiError:
    return ApiError("NOT_FOUND", f"No reservation found with id {reservation_id}.")


def replay(key: Any) -> JSONResponse | None:
    """Rule 5: a key we have seen returns the first result, 200, and nothing else happens."""
    with get_db().connection() as conn:
        row = repository.reservation_for_key(conn, str(key))
    return JSONResponse(models.reservation_json(row), status_code=200) if row else None


def check_text(value: Any, name: str) -> str:
    if not isinstance(value, str):
        raise ApiError("VALIDATION_ERROR", f"{name} must be text.")
    return value.strip()


# ------------------------------------------------------------------ request
@app.post("/bookings/request")
def bookings_request(_claims=Depends(require(["guest"], own=["guest_id"])), body: dict[str, Any] = Depends(json_body)):
    # Contract section 5 rule 2: the checks run in exactly this order.
    require_fields(body, ["property_id", "guest_id", "check_in", "check_out", "guest_count", "idempotency_key"])
    again = replay(body["idempotency_key"])
    if again:
        return again
    if not is_valid_date(body["check_in"]) or not is_valid_date(body["check_out"]):
        raise ApiError("VALIDATION_ERROR", "Dates must be real dates in YYYY-MM-DD format.")
    if body["check_in"] < today_local().isoformat():
        raise ApiError("VALIDATION_ERROR", "Check-in can’t be in the past.")
    if body["check_out"] <= body["check_in"]:
        raise ApiError("VALIDATION_ERROR", "Check-out must be after check-in.")
    if not is_int(body["guest_count"]) or body["guest_count"] < 1:
        raise ApiError("VALIDATION_ERROR", "Number of guests must be a whole number of at least 1.")
    message = body.get("guest_message")
    if message is not None and not isinstance(message, str):
        raise ApiError("VALIDATION_ERROR", "guest_message must be text.")
    db = get_db()
    with db.connection() as conn:
        prop = repository.get_property(conn, body["property_id"])
        if prop is None:
            raise ApiError("NOT_FOUND", f"No property found with id {body['property_id']}.")
        if prop["status"] != "active":
            raise ApiError("INVALID_STATUS", "This listing isn’t taking bookings right now.")
        if not repository.guest_exists(conn, body["guest_id"]):
            raise ApiError("NOT_FOUND", f"No guest found with id {body['guest_id']}.")
        if body["guest_count"] > prop["capacity"]:
            raise ApiError("VALIDATION_ERROR", f"This place fits at most {prop['capacity']} guest(s).")

    nights = (to_date(body["check_out"]) - to_date(body["check_in"])).days
    trace_id = core.new_trace_id()  # starts this booking's journey; every later event and log line carries it
    use_kafka = env_flag("USE_KAFKA", True)
    try:
        with db.transaction() as conn:
            reservation_id = repository.insert_processing(conn, db, trace_id, prop, body, nights)
            repository.remember_key(conn, str(body["idempotency_key"]), "request", reservation_id)
            row = repository.get_reservation(conn, reservation_id, for_update=True)
            block = None
            if not use_kafka:
                # Baseline "B": no Kafka, no worker. The SAME decision, in the SAME transaction, with the SAME constraint.
                outcome, block = core.decide(conn, db, row, core.SERVICE)
                row = repository.get_reservation(conn, reservation_id)
    except Exception as problem:  # noqa: BLE001
        if is_duplicate_key(problem):  # the same key arrived twice at the same instant: the other one won
            again = replay(body["idempotency_key"])
            if again:
                return again
        raise

    if use_kafka:
        # Publish only AFTER the commit (the worker must be able to see the row). If Kafka is down, undo the row: no `processing`
        # reservation may exist without an event behind it (it would wait forever).
        if not core.booking_event("booking.requested", row, body["guest_id"]):
            _undo_request(db, row, str(body["idempotency_key"]))
            raise ApiError("SERVICE_UNAVAILABLE", "Booking is temporarily unavailable. Please try again in a moment.")
    elif block is not None:
        get_cache().invalidate_availability(row["property_id"])
    return JSONResponse(models.reservation_json(row), status_code=202)


def _undo_request(db, row: dict[str, Any], key: str) -> None:
    with db.transaction() as conn:
        for sql in (
            "DELETE FROM idempotency_keys WHERE idempotency_key = %s",
            "DELETE FROM reservation_status_history WHERE reservation_id = %s",
            "DELETE FROM reservations WHERE reservation_id = %s AND status = 'processing'",
        ):
            execute(conn, sql, (key,) if "idempotency" in sql else (row["reservation_id"],))


# ------------------------------------------------------------------ reads
def _may_read_reservation(claims: Claims, body: dict[str, Any], _request) -> str | None:
    with get_db().connection() as conn:
        row = repository.get_reservation(conn, str(body.get("reservation_id")))
        if row is None:
            return None  # the endpoint answers 404
        if claims.role == "guest":
            return None if row["guest_id"] == claims.sub else "You can only see your own reservations."
        if row["status"] in models.HIDDEN_FROM_HOST:
            return None  # the endpoint answers 404: to a host, a processing or failed request doesn't exist
        return None if repository.host_of_property(conn, row["property_id"]) == claims.sub else "Only the host of this listing can see this reservation."


def _owns_listing(claims: Claims, body: dict[str, Any], _request) -> str | None:
    with get_db().connection() as conn:
        host = repository.host_of_property(conn, str(body.get("property_id")))
    return None if host is None or host == claims.sub else "Only the host of this listing can see its reservations."


def _status_filter(body: dict[str, Any]) -> str | None:
    status = body.get("status")
    if status is not None and status not in models.STATUSES:
        raise ApiError("VALIDATION_ERROR", f"status must be one of: {', '.join(models.STATUSES)}.")
    return status


@app.post("/bookings/get")
def bookings_get(claims: Claims = Depends(require(["guest", "host"], check=_may_read_reservation)), body: dict[str, Any] = Depends(json_body)):
    require_fields(body, ["reservation_id"])
    with get_db().connection() as conn:
        row = repository.get_reservation(conn, body["reservation_id"])
    # The host never sees `processing` or `failed` requests (contract), not even by id: same 404 as an unknown id.
    if row is None or (claims.role == "host" and row["status"] in models.HIDDEN_FROM_HOST):
        raise reservation_not_found(body["reservation_id"])
    return models.reservation_json(row)


@app.post("/bookings/byProperty")
def bookings_by_property(_claims=Depends(require(["host"], check=_owns_listing)), body: dict[str, Any] = Depends(json_body)):
    require_fields(body, ["property_id"])
    status = _status_filter(body)
    with get_db().connection() as conn:
        if repository.host_of_property(conn, body["property_id"]) is None:
            raise ApiError("NOT_FOUND", f"No property found with id {body['property_id']}.")
        rows = repository.list_for_property(conn, body["property_id"], status)
    return {"items": [models.reservation_json(r) for r in rows]}


@app.post("/bookings/byGuest")
def bookings_by_guest(_claims=Depends(require(["guest"], own=["guest_id"])), body: dict[str, Any] = Depends(json_body)):
    require_fields(body, ["guest_id"])
    status = _status_filter(body)
    with get_db().connection() as conn:
        if not repository.guest_exists(conn, body["guest_id"]):
            raise ApiError("NOT_FOUND", f"No guest found with id {body['guest_id']}.")
        rows = repository.list_for_guest(conn, body["guest_id"], status)
    return {"items": [models.reservation_json(r) for r in rows]}


# ------------------------------------------------------------------ approve / decline / cancel
def _act(body: dict[str, Any], scope: str, apply) -> Any:
    """Run one status change in ONE transaction: lock the row, check the rules (`apply`), change status + history + idempotency key.

    `apply(conn, row)` returns (new_row, events) and raises ApiError for a rule that is broken.
    """
    db = get_db()
    try:
        with db.transaction() as conn:
            row = repository.get_reservation(conn, body["reservation_id"], for_update=True)
            if row is None:
                raise reservation_not_found(body["reservation_id"])
            events = apply(conn, row)
            repository.remember_key(conn, str(body["idempotency_key"]), scope, row["reservation_id"])
            updated = repository.get_reservation(conn, row["reservation_id"])
    except Exception as problem:  # noqa: BLE001
        if is_duplicate_key(problem):
            again = replay(body["idempotency_key"])
            if again:
                return again
        raise
    for send in events(updated):  # after the commit
        send()
    return models.reservation_json(updated)


def _released(block: dict[str, Any] | None, reason: str, trace_id: str):
    return (lambda: core.availability_event("availability.released", block, reason, trace_id)) if block else (lambda: None)


@app.post("/bookings/approve")
def bookings_approve(_claims=Depends(require(["host"], own=["host_id"])), body: dict[str, Any] = Depends(json_body)):
    require_fields(body, ["reservation_id", "host_id", "idempotency_key"])
    again = replay(body["idempotency_key"])
    if again:
        return again

    def apply(conn, row):
        if repository.host_of_property(conn, row["property_id"]) != body["host_id"]:
            raise ApiError("UNAUTHORIZED", "Only the host of this listing can approve this request.")
        if row["status"] != "pending":
            raise ApiError("INVALID_STATUS", f"This reservation is already {row['status']}, so it can’t be approved.")
        repository.change_status(conn, row, "approved", body["host_id"])  # the dates stay held
        return lambda updated: [lambda: core.booking_event("booking.approved", updated, body["host_id"])]

    return _act(body, "approve", apply)


@app.post("/bookings/decline")
def bookings_decline(_claims=Depends(require(["host"], own=["host_id"])), body: dict[str, Any] = Depends(json_body)):
    require_fields(body, ["reservation_id", "host_id", "idempotency_key"])
    again = replay(body["idempotency_key"])
    if again:
        return again
    reason = body.get("reason")
    reason = reason.strip() if isinstance(reason, str) and reason.strip() else None

    def apply(conn, row):
        if repository.host_of_property(conn, row["property_id"]) != body["host_id"]:
            raise ApiError("UNAUTHORIZED", "Only the host of this listing can decline this request.")
        if row["status"] != "pending":
            raise ApiError("INVALID_STATUS", f"This reservation is already {row['status']}, so it can’t be declined.")
        repository.change_status(conn, row, "declined", body["host_id"], reason)
        block = core.release(conn, row)
        return lambda updated: [lambda: core.booking_event("booking.declined", updated, body["host_id"]), _released(block, "booking_declined", row["trace_id"])]

    return _act(body, "decline", apply)


@app.post("/bookings/cancel")
def bookings_cancel(_claims=Depends(require(["guest", "host"], own=["guest_id", "host_id"])), body: dict[str, Any] = Depends(json_body)):
    require_fields(body, ["reservation_id", "idempotency_key"])
    again = replay(body["idempotency_key"])
    if again:
        return again
    by_guest, by_host = body.get("guest_id") is not None, body.get("host_id") is not None
    if by_guest == by_host:
        raise ApiError("VALIDATION_ERROR", "Send exactly one of guest_id or host_id to say who is cancelling.")
    reason = body.get("cancellation_reason")
    reason = reason.strip() if isinstance(reason, str) else ""

    def apply(conn, row):
        if by_guest:
            if row["guest_id"] != body["guest_id"]:
                raise ApiError("UNAUTHORIZED", "You can only cancel your own reservations.")
            if row["status"] == "processing":
                raise ApiError("INVALID_STATUS", "This request is still being processed. Try again in a moment.")
            if row["status"] not in models.HOLDING:
                raise ApiError("INVALID_STATUS", f"This reservation is already {row['status']}, so it can’t be cancelled.")
            actor = body["guest_id"]
        else:
            if repository.host_of_property(conn, row["property_id"]) != body["host_id"]:
                raise ApiError("UNAUTHORIZED", "Only the host of this listing can cancel this reservation.")
            if row["status"] != "approved":
                raise ApiError("INVALID_STATUS", "Hosts can only cancel approved reservations. Decline pending requests instead.")
            if reason == "":
                raise ApiError("VALIDATION_ERROR", "Please give the guest a reason for cancelling.")
            actor = body["host_id"]
        if repository.as_date(row["check_in"]) <= today_local():  # "before the check-in day", judged in America/Los_Angeles
            raise ApiError("INVALID_STATUS", "Reservations can only be cancelled before the check-in day.")
        repository.change_status(conn, row, "cancelled", actor, reason or None)
        block = core.release(conn, row)
        return lambda updated: [lambda: core.booking_event("booking.cancelled", updated, actor), _released(block, "booking_cancelled", row["trace_id"])]

    return _act(body, "cancel", apply)
