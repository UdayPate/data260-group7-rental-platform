"""The Booking Service's SQL. Every status change goes through change_status(), which also writes the history row."""
from __future__ import annotations

from datetime import date
from typing import Any

from xenia_shared.db import Database, execute, fetch_all, fetch_one

from . import models


def get_reservation(conn, reservation_id: str, for_update: bool = False) -> dict[str, Any] | None:
    return fetch_one(conn, "SELECT * FROM reservations WHERE reservation_id = %s" + (" FOR UPDATE" if for_update else ""), (reservation_id,))


def get_property(conn, property_id: str) -> dict[str, Any] | None:
    return fetch_one(conn, "SELECT property_id, host_id, status, capacity, nightly_price, cleaning_fee FROM properties WHERE property_id = %s", (property_id,))


def host_of_property(conn, property_id: str) -> str | None:
    row = fetch_one(conn, "SELECT host_id FROM properties WHERE property_id = %s", (property_id,))
    return row["host_id"] if row else None


def guest_exists(conn, guest_id: str) -> bool:
    return fetch_one(conn, "SELECT 1 AS ok FROM guests WHERE guest_id = %s", (guest_id,)) is not None


# ---------- idempotency (API layer) ----------
def reservation_for_key(conn, key: str) -> dict[str, Any] | None:
    return fetch_one(
        conn,
        "SELECT r.* FROM idempotency_keys k JOIN reservations r ON r.reservation_id = k.reservation_id WHERE k.idempotency_key = %s",
        (key,),
    )


def remember_key(conn, key: str, scope: str, reservation_id: str) -> None:
    """Raises a duplicate-key error if the key was already used (two identical requests at the same instant)."""
    execute(conn, "INSERT INTO idempotency_keys (idempotency_key, scope, reservation_id, created_at) VALUES (%s, %s, %s, UTC_TIMESTAMP(3))", (key, scope, reservation_id))


# ---------- writes ----------
def insert_processing(conn, db: Database, trace_id: str, prop: dict[str, Any], body: dict[str, Any], nights: int) -> str:
    reservation_id = db.next_id("r")
    price = models.price_breakdown(prop["nightly_price"], prop["cleaning_fee"], nights)
    execute(
        conn,
        "INSERT INTO reservations (reservation_id, trace_id, property_id, guest_id, check_in, check_out, guest_count, nights, nightly_price, subtotal, "
        "cleaning_fee, total, booking_datetime, status, cancellation_reason, failure_code, guest_message, updated_datetime) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,UTC_TIMESTAMP(3),'processing',NULL,NULL,%s,UTC_TIMESTAMP(3))",
        (
            reservation_id, trace_id, body["property_id"], body["guest_id"], body["check_in"], body["check_out"], body["guest_count"], nights,
            price["nightly_price"], price["subtotal"], price["cleaning_fee"], price["total"], body.get("guest_message") or None,
        ),
    )
    add_history(conn, reservation_id, None, "processing", body["guest_id"], trace_id, "request accepted")
    return reservation_id


def add_history(conn, reservation_id: str, old: str | None, new: str, actor_id: str, trace_id: str, note: str | None = None) -> None:
    execute(
        conn,
        "INSERT INTO reservation_status_history (reservation_id, old_status, new_status, actor_id, trace_id, note, changed_at) VALUES (%s,%s,%s,%s,%s,%s,UTC_TIMESTAMP(3))",
        (reservation_id, old, new, actor_id, trace_id, (note or None) and note[:500]),
    )


def change_status(conn, row: dict[str, Any], new_status: str, actor_id: str, reason: str | None = None, failure_code: str | None = None, note: str | None = None) -> bool:
    """Move a reservation from the status in `row` to `new_status` + write its history row, in the caller's transaction.

    The UPDATE only matches while the status is still what the caller read, so two jobs (or a job and a click) at the same moment
    cannot both apply: the second one changes 0 rows and gets False.
    """
    changed = execute(
        conn,
        "UPDATE reservations SET status = %s, cancellation_reason = %s, failure_code = %s, updated_datetime = UTC_TIMESTAMP(3) WHERE reservation_id = %s AND status = %s",
        (new_status, reason, failure_code, row["reservation_id"], row["status"]),
    )
    if changed:
        add_history(conn, row["reservation_id"], row["status"], new_status, actor_id, row["trace_id"], note or reason)
    return bool(changed)


def duplicate_request(conn, row: dict[str, Any]) -> dict[str, Any] | None:
    """Same guest, same property, overlapping dates, already pending or approved."""
    return fetch_one(
        conn,
        "SELECT reservation_id FROM reservations WHERE guest_id = %s AND property_id = %s AND reservation_id <> %s "
        "AND status IN ('pending','approved') AND check_in < %s AND check_out > %s ORDER BY reservation_id LIMIT 1",
        (row["guest_id"], row["property_id"], row["reservation_id"], row["check_out"], row["check_in"]),
    )


# ---------- reads ----------
def list_for_guest(conn, guest_id: str, status: str | None) -> list[dict[str, Any]]:
    sql = "SELECT * FROM reservations WHERE guest_id = %s" + (" AND status = %s" if status else "") + " ORDER BY reservation_id"
    return fetch_all(conn, sql, (guest_id, status) if status else (guest_id,))


def list_for_property(conn, property_id: str, status: str | None) -> list[dict[str, Any]]:
    """The host never sees `processing` or `failed` requests (contract)."""
    sql = "SELECT * FROM reservations WHERE property_id = %s AND status NOT IN ('processing','failed')" + (" AND status = %s" if status else "") + " ORDER BY reservation_id"
    return fetch_all(conn, sql, (property_id, status) if status else (property_id,))


def history(conn, reservation_id: str) -> list[dict[str, Any]]:
    return fetch_all(conn, "SELECT * FROM reservation_status_history WHERE reservation_id = %s ORDER BY history_id", (reservation_id,))


def booking_block(conn, reservation_id: str) -> dict[str, Any] | None:
    return fetch_one(conn, "SELECT * FROM availability_blocks WHERE reservation_id = %s FOR UPDATE", (reservation_id,))


def booking_count(conn, guest_id: str) -> int:
    return int(fetch_one(conn, "SELECT COUNT(*) AS n FROM reservations WHERE guest_id = %s", (guest_id,))["n"])


def as_date(value: Any) -> date:
    return value if isinstance(value, date) else date.fromisoformat(str(value))
