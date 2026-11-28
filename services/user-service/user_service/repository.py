"""The User Service's data access layer: every SQL statement for accounts, guests and hosts."""
from __future__ import annotations

from typing import Any

from xenia_shared.db import Database, execute, fetch_all, fetch_one

GUEST_SELECT = """
SELECT g.*,
       (SELECT COUNT(*) FROM saved_properties s WHERE s.guest_id = g.guest_id) AS saved_properties_count,
       (SELECT COUNT(*) FROM reservations r WHERE r.guest_id = g.guest_id)      AS booking_count
FROM guests g
"""


def like_pattern(text: str) -> str:
    """'%text%' for a contains-match, with the user's own % and _ made harmless."""
    escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


# ---------- accounts ----------
def find_account(conn, email: str) -> dict[str, Any] | None:
    # The email column is case-insensitive (utf8mb4_unicode_ci), so 'ALEX@x.com' finds 'alex@x.com'.
    return fetch_one(conn, "SELECT * FROM accounts WHERE email = %s", (email,))


def email_taken(conn, email: str, except_user_id: str | None = None) -> bool:
    row = fetch_one(conn, "SELECT user_id FROM accounts WHERE email = %s", (email,))
    return row is not None and row["user_id"] != except_user_id


def insert_account(conn, email: str, password_hash: str, role: str, user_id: str) -> None:
    execute(conn, "INSERT INTO accounts (email, password_hash, role, user_id) VALUES (%s, %s, %s, %s)", (email, password_hash, role, user_id))


def update_account_email(conn, user_id: str, email: str) -> None:
    execute(conn, "UPDATE accounts SET email = %s WHERE user_id = %s", (email, user_id))


def delete_account(conn, user_id: str) -> None:
    execute(conn, "DELETE FROM accounts WHERE user_id = %s", (user_id,))


# ---------- guests ----------
def get_guest(conn, guest_id: str) -> dict[str, Any] | None:
    return fetch_one(conn, GUEST_SELECT + " WHERE g.guest_id = %s", (guest_id,))


def insert_guest(conn, db: Database, body: dict[str, Any], preferences_json: str) -> str:
    guest_id = db.next_id("g")
    execute(
        conn,
        "INSERT INTO guests (guest_id, first_name, last_name, email, phone, location, profile_photo_url, preferences, profile_created_datetime) "
        "VALUES (%s, %s, %s, %s, %s, %s, %s, %s, UTC_TIMESTAMP(3))",
        (guest_id, body["first_name"], body["last_name"], body["email"], body.get("phone") or "", body.get("location") or "", body.get("profile_photo_url") or "", preferences_json),
    )
    return guest_id


def update_guest(conn, guest_id: str, changes: dict[str, Any]) -> None:
    if not changes:
        return
    columns = ", ".join(f"{name} = %s" for name in changes)
    execute(conn, f"UPDATE guests SET {columns} WHERE guest_id = %s", (*changes.values(), guest_id))


def upcoming_reservation_ids_for_guest(conn, guest_id: str) -> list[str]:
    # processing counts too: it is about to become a pending reservation for this guest.
    rows = fetch_all(
        conn,
        "SELECT reservation_id FROM reservations WHERE guest_id = %s AND status IN ('processing','pending','approved') "
        "AND check_out > UTC_DATE() ORDER BY reservation_id",
        (guest_id,),
    )
    return [r["reservation_id"] for r in rows]


def delete_guest(conn, guest_id: str) -> None:
    # saved_properties rows go too (ON DELETE CASCADE); reservations stay as history.
    execute(conn, "DELETE FROM guests WHERE guest_id = %s", (guest_id,))


def search_guests(conn, query: str | None, location: str | None, page: int, page_size: int) -> tuple[list[dict[str, Any]], int]:
    where, params = ["1=1"], []
    if query:
        where.append("(CONCAT(g.first_name, ' ', g.last_name) LIKE %s OR g.email LIKE %s)")
        params += [like_pattern(query), like_pattern(query)]
    if location:
        where.append("g.location LIKE %s")
        params.append(like_pattern(location))
    clause = " AND ".join(where)
    total = fetch_one(conn, f"SELECT COUNT(*) AS n FROM guests g WHERE {clause}", params)["n"]
    rows = fetch_all(conn, f"{GUEST_SELECT} WHERE {clause} ORDER BY g.guest_id LIMIT %s OFFSET %s", (*params, page_size, (page - 1) * page_size))
    return rows, int(total)


def host_has_guest(conn, host_id: str, guest_id: str) -> bool:
    """Does this guest have (or had) a reservation at one of this host's listings?"""
    row = fetch_one(
        conn,
        "SELECT 1 AS ok FROM reservations r JOIN properties p ON p.property_id = r.property_id "
        "WHERE r.guest_id = %s AND p.host_id = %s LIMIT 1",
        (guest_id, host_id),
    )
    return row is not None


# ---------- hosts ----------
def get_host(conn, host_id: str) -> dict[str, Any] | None:
    return fetch_one(conn, "SELECT * FROM hosts WHERE host_id = %s", (host_id,))


def insert_host(conn, db: Database, body: dict[str, Any]) -> str:
    host_id = db.next_id("h")
    execute(
        conn,
        "INSERT INTO hosts (host_id, name, email, phone, profile_photo_url, verification_status, response_rate, response_time, host_since, access_level) "
        "VALUES (%s, %s, %s, %s, %s, 'unverified', 0, 0, UTC_DATE(), 'standard')",
        (host_id, body["name"], body["email"], body.get("phone") or "", body.get("profile_photo_url") or ""),
    )
    return host_id


def update_host(conn, host_id: str, changes: dict[str, Any]) -> None:
    if not changes:
        return
    columns = ", ".join(f"{name} = %s" for name in changes)
    execute(conn, f"UPDATE hosts SET {columns} WHERE host_id = %s", (*changes.values(), host_id))
