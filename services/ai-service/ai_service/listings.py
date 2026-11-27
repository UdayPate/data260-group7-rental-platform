"""Read-only listing data for the agents (guide step 1).

The AI service connects to MySQL as `ai_reader` (infra/mysql/02_users.sql), a user that has
SELECT and nothing else. So even a buggy agent cannot book, change availability or edit a listing:
the database refuses (spec 7.5.1 "prevents an agent from ... changing availability").

A Snapshot is everything one agent needs for one debate, read once: active and inactive
listings, their hosts, the held date ranges and each host's host-caused cancellations.
The database NAME comes from MYSQL_DATABASE, so Rohini and Shashank can point the service at
their 200-property evaluation pool (xenia_eval).
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from xenia_shared.db import fetch_all, get_db, json_column, jsonable


@dataclass
class Snapshot:
    properties: list[dict[str, Any]]
    hosts: dict[str, dict[str, Any]]
    blocks: list[dict[str, Any]]  # every block that holds nights (status blocked or booked)
    host_cancellations: dict[str, list[dict[str, Any]]] = field(default_factory=dict)

    def property(self, property_id: str) -> dict[str, Any] | None:
        return next((p for p in self.properties if p["property_id"] == property_id), None)

    def cities(self) -> list[str]:
        return sorted({p["city"] for p in self.properties})


def _property_json(row: dict[str, Any]) -> dict[str, Any]:
    out = {key: jsonable(value) for key, value in row.items()}
    out["amenities"] = json_column(row["amenities"])
    return out


def load_snapshot() -> Snapshot:
    """One read of the listing data (a handful of SELECTs; 30 listings in the demo, 200 in the evaluation pool)."""
    with get_db().connection() as conn:
        properties = [
            _property_json(r)
            for r in fetch_all(
                conn,
                "SELECT property_id, host_id, title, property_type, city, state, capacity, bedrooms, bathrooms, "
                "amenities, nightly_price, cleaning_fee, status, rating, review_count FROM properties ORDER BY property_id",
            )
        ]
        hosts = {
            r["host_id"]: {k: jsonable(v) for k, v in r.items()}
            for r in fetch_all(conn, "SELECT host_id, name, verification_status, response_rate, response_time, access_level FROM hosts")
        }
        blocks = [
            {k: jsonable(v) for k, v in r.items()}
            for r in fetch_all(
                conn,
                "SELECT availability_id, property_id, start_date, end_date, status FROM availability_blocks WHERE status <> 'available'",
            )
        ]
        # Cancellations the HOST caused (the seed reasons start with "Host cancelled"). The Risk agent's evidence.
        cancelled = fetch_all(
            conn,
            "SELECT r.reservation_id, r.cancellation_reason, p.host_id FROM reservations r "
            "JOIN properties p ON p.property_id = r.property_id "
            "WHERE r.status = 'cancelled' AND r.cancellation_reason LIKE 'Host cancelled%%' ORDER BY r.reservation_id",
        )
    by_host: dict[str, list[dict[str, Any]]] = {}
    for row in cancelled:
        by_host.setdefault(row["host_id"], []).append({"reservation_id": row["reservation_id"], "cancellation_reason": row["cancellation_reason"]})
    return Snapshot(properties, hosts, blocks, by_host)


def is_still_free(property_id: str, check_in: str | None, check_out: str | None) -> bool:
    """The availability re-check of plan step 6: a fresh read, not the snapshot (dates may have been booked meanwhile)."""
    if not check_in or not check_out:
        return True
    with get_db().connection() as conn:
        rows = fetch_all(
            conn,
            "SELECT 1 FROM availability_blocks WHERE property_id = %s AND status <> 'available' "
            "AND start_date < %s AND %s < end_date LIMIT 1",
            (property_id, check_out, check_in),
        )
    return not rows
