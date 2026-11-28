"""The Property Service's data access layer: every SQL statement for listings, search and saves."""
from __future__ import annotations

import json
from datetime import date
from typing import Any

from xenia_shared.db import Database, execute, fetch_all, fetch_one

from .models import EDITABLE


def get_property(conn, property_id: str, for_update: bool = False) -> dict[str, Any] | None:
    return fetch_one(conn, "SELECT * FROM properties WHERE property_id = %s" + (" FOR UPDATE" if for_update else ""), (property_id,))


def host_exists(conn, host_id: str) -> bool:
    return fetch_one(conn, "SELECT 1 AS ok FROM hosts WHERE host_id = %s", (host_id,)) is not None


def guest_exists(conn, guest_id: str) -> bool:
    return fetch_one(conn, "SELECT 1 AS ok FROM guests WHERE guest_id = %s", (guest_id,)) is not None


def insert_property(conn, db: Database, body: dict[str, Any]) -> str:
    property_id = db.next_id("p")
    execute(
        conn,
        "INSERT INTO properties (property_id, host_id, title, description, property_type, address, city, state, zip_code, latitude, longitude, "
        "capacity, bedrooms, bathrooms, amenities, nightly_price, cleaning_fee, status, rating, review_count, created_datetime, photo_url) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,0,0,UTC_TIMESTAMP(3),%s)",
        (
            property_id, body["host_id"], body["title"], body.get("description") or "", body["property_type"], body["address"],
            body["city"], body["state"], body["zip_code"], body.get("latitude") or 0, body.get("longitude") or 0,
            body["capacity"], body["bedrooms"], body["bathrooms"], json.dumps(body.get("amenities") or []),
            body["nightly_price"], body["cleaning_fee"], body.get("status") or "active", body.get("photo_url") or "",
        ),
    )
    return property_id


def update_property(conn, property_id: str, changes: dict[str, Any]) -> None:
    changes = {k: (json.dumps(v) if k == "amenities" else v) for k, v in changes.items() if k in EDITABLE}
    if not changes:
        return
    columns = ", ".join(f"{name} = %s" for name in changes)
    execute(conn, f"UPDATE properties SET {columns} WHERE property_id = %s", (*changes.values(), property_id))


def upcoming_reservation_ids_for_property(conn, property_id: str) -> list[str]:
    rows = fetch_all(
        conn,
        "SELECT reservation_id FROM reservations WHERE property_id = %s AND status IN ('processing','pending','approved') "
        "AND check_out > UTC_DATE() ORDER BY reservation_id",
        (property_id,),
    )
    return [r["reservation_id"] for r in rows]


def delete_property(conn, property_id: str) -> None:
    # availability blocks, nights and saves go with it (ON DELETE CASCADE); reservations stay as history.
    execute(conn, "DELETE FROM properties WHERE property_id = %s", (property_id,))


# ---------- search ----------
def _like(text: str) -> str:
    return "%" + text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"


def search_properties(conn, f: dict[str, Any]) -> tuple[list[dict[str, Any]], int]:
    """One page of listings for the normalised filters `f` (see main.normalise_search), and the total count.

    Every filter is optional. "amenities" means has ALL of them; "property_types" means ANY of them.
    """
    where: list[str] = []
    params: list[Any] = []
    if f.get("host_id"):
        where.append("p.host_id = %s")  # a host looking at their own listings also sees inactive ones
        params.append(f["host_id"])
    else:
        where.append("p.status = 'active'")  # guests only ever see active listings
    if f.get("status"):
        where.append("p.status = %s")
        params.append(f["status"])
    if f.get("location"):
        where.append("(p.city LIKE %s OR p.address LIKE %s)")  # contains-match, case-insensitive (collation)
        params += [_like(f["location"]), _like(f["location"])]
    if f.get("guest_count") is not None:
        where.append("p.capacity >= %s")
        params.append(f["guest_count"])
    if f.get("min_price") is not None:
        where.append("p.nightly_price >= %s")
        params.append(f["min_price"])
    if f.get("max_price") is not None:
        where.append("p.nightly_price <= %s")
        params.append(f["max_price"])
    if f.get("property_types"):
        where.append("p.property_type IN (" + ", ".join(["%s"] * len(f["property_types"])) + ")")
        params += f["property_types"]
    for amenity in f.get("amenities") or []:
        where.append("JSON_CONTAINS(p.amenities, %s)")
        params.append(json.dumps(amenity))
    if f.get("min_rating") is not None:
        where.append("p.rating >= %s")
        params.append(f["min_rating"])
    if f.get("available_only"):
        # No taken night inside the stay. A stay's nights are check_in .. check_out - 1.
        where.append("NOT EXISTS (SELECT 1 FROM availability_nights n WHERE n.property_id = p.property_id AND n.night_date >= %s AND n.night_date < %s)")
        params += [f["check_in"], f["check_out"]]
    clause = " AND ".join(where)
    total = fetch_one(conn, f"SELECT COUNT(*) AS n FROM properties p WHERE {clause}", params)["n"]
    rows = fetch_all(
        conn,
        f"SELECT p.* FROM properties p WHERE {clause} ORDER BY p.property_id LIMIT %s OFFSET %s",
        (*params, f["page_size"], (f["page"] - 1) * f["page_size"]),
    )
    return rows, int(total)


# ---------- saves ----------
def saved_ids(conn, guest_id: str, property_ids: list[str]) -> set[str]:
    if not property_ids:
        return set()
    rows = fetch_all(
        conn,
        "SELECT property_id FROM saved_properties WHERE guest_id = %s AND property_id IN (" + ", ".join(["%s"] * len(property_ids)) + ")",
        (guest_id, *property_ids),
    )
    return {r["property_id"] for r in rows}


def set_saved(conn, guest_id: str, property_id: str, saved: bool) -> bool:
    """Save or unsave. Returns True if something actually changed (saving twice changes nothing)."""
    if saved:
        return execute(conn, "INSERT IGNORE INTO saved_properties (guest_id, property_id, saved_datetime) VALUES (%s, %s, UTC_TIMESTAMP(3))", (guest_id, property_id)) == 1
    return execute(conn, "DELETE FROM saved_properties WHERE guest_id = %s AND property_id = %s", (guest_id, property_id)) == 1


def saved_count(conn, guest_id: str) -> int:
    return int(fetch_one(conn, "SELECT COUNT(*) AS n FROM saved_properties WHERE guest_id = %s", (guest_id,))["n"])


def as_date(value: str) -> date:
    return date.fromisoformat(value)
