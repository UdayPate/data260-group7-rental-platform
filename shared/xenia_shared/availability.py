"""Holding and releasing nights. Used by the Property Service (host blocks) AND the Booking worker
(reservation holds), so there is ONE implementation of the rule that protects against double booking.

THE RULE (spec 13.1 / 13.3): table `availability_nights` has PRIMARY KEY (property_id, night_date).
A block inserts one row per night. If any of those nights is already taken, MySQL refuses the insert
with a duplicate-key error (1062). Two requests arriving at the same instant cannot both pass, because
the database, not our code, decides who inserts first.
"""
from __future__ import annotations

from datetime import date, timedelta
from typing import Any

from .db import execute, fetch_all, fetch_one, is_duplicate_key, jsonable
from .timeutil import iso_millis


def nights_between(start: date, end: date) -> list[date]:
    """Every night of a stay. `end` is the check-out day and is NOT a night: 12-04..12-06 = [12-04, 12-05]."""
    return [start + timedelta(days=i) for i in range((end - start).days)]


def insert_block(
    conn,
    availability_id: str,
    property_id: str,
    start: date,
    end: date,
    status: str,
    source: str,
    reservation_id: str | None = None,
) -> None:
    """Write the block and ALL its nights. Raises pymysql IntegrityError (1062) if any night is taken.

    The caller decides what to do with the failure: the Property Service rolls the whole transaction
    back and answers 409; the booking worker rolls back to a savepoint and records a failed booking.
    """
    execute(
        conn,
        "INSERT INTO availability_blocks (availability_id, property_id, start_date, end_date, status, source, reservation_id, updated_datetime) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, UTC_TIMESTAMP(3))",
        (availability_id, property_id, start, end, status, source, reservation_id),
    )
    nights = nights_between(start, end)
    placeholders = ", ".join(["(%s, %s, %s)"] * len(nights))
    params: list[Any] = []
    for night in nights:  # ascending order: two overlapping writers lock nights in the same order (no deadlock cycle)
        params += [property_id, night, availability_id]
    execute(conn, f"INSERT INTO availability_nights (property_id, night_date, availability_id) VALUES {placeholders}", params)


def try_insert_block(conn, availability_id: str, property_id: str, start: date, end: date, status: str, source: str, reservation_id: str | None = None) -> bool:
    """insert_block() that undoes ONLY itself on a clash and returns False, leaving the rest of the
    transaction usable (a SAVEPOINT is a bookmark inside the transaction you can roll back to)."""
    execute(conn, "SAVEPOINT hold_nights")
    try:
        insert_block(conn, availability_id, property_id, start, end, status, source, reservation_id)
    except Exception as problem:  # noqa: BLE001
        if is_duplicate_key(problem):
            execute(conn, "ROLLBACK TO SAVEPOINT hold_nights")
            return False
        raise
    execute(conn, "RELEASE SAVEPOINT hold_nights")
    return True


def find_clash(conn, property_id: str, start: date, end: date) -> dict[str, Any] | None:
    """The first existing block that covers any night of [start, end), to name it in the 409 error."""
    return fetch_one(
        conn,
        "SELECT b.* FROM availability_blocks b WHERE b.property_id = %s AND b.status <> 'available' "
        "AND b.start_date < %s AND b.end_date > %s ORDER BY b.start_date, b.availability_id LIMIT 1",
        (property_id, end, start),
    )


def delete_block(conn, availability_id: str) -> None:
    execute(conn, "DELETE FROM availability_nights WHERE availability_id = %s", (availability_id,))
    execute(conn, "DELETE FROM availability_blocks WHERE availability_id = %s", (availability_id,))


def get_block(conn, availability_id: str, for_update: bool = False) -> dict[str, Any] | None:
    return fetch_one(conn, "SELECT * FROM availability_blocks WHERE availability_id = %s" + (" FOR UPDATE" if for_update else ""), (availability_id,))


def blocks_overlapping(conn, property_id: str, start: date, end: date) -> list[dict[str, Any]]:
    return fetch_all(
        conn,
        "SELECT * FROM availability_blocks WHERE property_id = %s AND start_date < %s AND end_date > %s ORDER BY start_date, availability_id",
        (property_id, end, start),
    )


def block_json(row: dict[str, Any]) -> dict[str, Any]:
    """An AvailabilityBlock exactly as the contract describes it."""
    return {
        "availability_id": row["availability_id"],
        "property_id": row["property_id"],
        "start_date": jsonable(row["start_date"]),
        "end_date": jsonable(row["end_date"]),
        "status": row["status"],
        "source": row["source"],
        "updated_datetime": jsonable(row["updated_datetime"]),
    }


def availability_envelope(event_type: str, block_row: dict[str, Any], reason: str, trace_id: str, actor_id: str) -> dict[str, Any]:
    """The live-update message of contract "WebSocket .../availability/stream" (it is the shared envelope).

    `timestamp` is when the block was WRITTEN (the page measures notification latency from it), and
    actor_id is the service, never a guest id, because every viewer of the property receives it.
    """
    from .envelope import make_envelope

    written = block_row["updated_datetime"]
    return make_envelope(
        event_type,
        trace_id,
        actor_id,
        "property",
        block_row["property_id"],
        {"block": block_json(block_row), "reason": reason},
        idempotency_key=f"{trace_id}:{block_row['availability_id']}:{event_type}",
        timestamp=iso_millis(written.replace(tzinfo=None)) if hasattr(written, "replace") else None,
    )
