#!/usr/bin/env python3
"""Fills the database with random but realistic data for the performance experiments (spec 9, slide 5:
"populate the database with at least 10,000 random data points").

Default: 300 hosts, 2,000 guests, 10,000 properties, 12,000 reservations (+ their held nights). Same seed = same data.

    python infra/seed/generate_large.py                       # into the database named by MYSQL_DATABASE (default xenia)
    MYSQL_DATABASE=xenia_eval python infra/seed/generate_large.py --properties 200 --reservations 0 --guests 50   # the evaluation pool

It ADDS to what is there (ids continue after the existing ones, e.g. p_031...). It does not touch the seed rows.
Settings come from the same MYSQL_* variables as the services (MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE).
Needs:  pip install pymysql
"""
from __future__ import annotations

import argparse
import json
import os
import random
import time
import uuid
from datetime import date, datetime, timedelta, timezone

import pymysql

CITIES = [
    ("San Jose", "CA", "95112", 37.3382, -121.8863), ("San Jose", "CA", "95125", 37.3009, -121.8964),
    ("Sunnyvale", "CA", "94086", 37.3688, -122.0363), ("Mountain View", "CA", "94041", 37.3894, -122.0819),
    ("Santa Clara", "CA", "95050", 37.3541, -121.9552), ("Palo Alto", "CA", "94301", 37.4419, -122.1430),
    ("Cupertino", "CA", "95014", 37.3230, -122.0322), ("Milpitas", "CA", "95035", 37.4323, -121.8996),
    ("Campbell", "CA", "95008", 37.2872, -121.9500), ("Los Gatos", "CA", "95030", 37.2358, -121.9624),
]
STREETS = ["Main St", "Santana Row", "Willow Glen Way", "Oak Ave", "Maple Dr", "Park Blvd", "Bascom Ave", "Lincoln Ave", "El Camino Real", "Almaden Rd", "First St", "Market St"]
TYPES = [("house", 0.25, (3, 8), 260), ("apartment", 0.30, (1, 4), 150), ("condo", 0.18, (2, 5), 190), ("townhouse", 0.12, (3, 6), 230), ("private_room", 0.08, (1, 2), 85), ("guest_suite", 0.07, (1, 3), 130)]
AMENITIES = ["wifi", "kitchen", "parking", "washer", "dryer", "air_conditioning", "heating", "workspace", "pool", "hot_tub", "ev_charger"]
ADJECTIVES = ["Sunny", "Cozy", "Modern", "Quiet", "Bright", "Charming", "Spacious", "Stylish", "Peaceful", "Elegant"]
NOUNS = {"house": "Family House", "apartment": "Apartment", "condo": "Condo", "townhouse": "Townhouse", "private_room": "Private Room", "guest_suite": "Guest Suite"}
FIRST = ["Alex", "Sam", "Emily", "Marcus", "Hannah", "Kenji", "Olivia", "Diego", "Fatima", "Liam", "Zoe", "Ravi", "Priya", "Noah", "Mia", "Ethan", "Ava", "Lucas", "Sofia", "Omar"]
LAST = ["Chen", "Rivera", "Novak", "Johnson", "Schmidt", "Watanabe", "Brooks", "Morales", "Yusuf", "O'Connor", "Martin", "Iyer", "Patel", "Kim", "Nguyen", "Garcia", "Lopez", "Singh", "Park", "Cohen"]


def connect() -> pymysql.connections.Connection:
    return pymysql.connect(
        host=os.environ.get("MYSQL_HOST", "127.0.0.1"), port=int(os.environ.get("MYSQL_PORT", "3306")),
        user=os.environ.get("MYSQL_USER", "xenia"), password=os.environ.get("MYSQL_PASSWORD", "xenia"),
        database=os.environ.get("MYSQL_DATABASE", "xenia"), charset="utf8mb4", autocommit=False,
    )


def next_ids(cur, prefix: str, how_many: int) -> int:
    """Reserve `how_many` ids of a prefix; returns the first number. (Same counter table the services use.)"""
    cur.execute("SELECT next_value FROM id_counters WHERE prefix = %s FOR UPDATE", (prefix,))
    first = cur.fetchone()[0]
    cur.execute("UPDATE id_counters SET next_value = %s WHERE prefix = %s", (first + how_many, prefix))
    return first


def insert_batches(cur, sql: str, rows: list[tuple], size: int = 1000) -> None:
    for i in range(0, len(rows), size):
        cur.executemany(sql, rows[i : i + size])


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--hosts", type=int, default=300)
    ap.add_argument("--guests", type=int, default=2000)
    ap.add_argument("--properties", type=int, default=10000)
    ap.add_argument("--reservations", type=int, default=12000)
    ap.add_argument("--seed", type=int, default=260)
    args = ap.parse_args()
    rng = random.Random(args.seed)
    started = time.time()
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    today = now.date()
    conn = connect()
    cur = conn.cursor()

    # ---- hosts and guests (the extra people the data needs) ----
    host_first = next_ids(cur, "h", args.hosts)
    hosts = [f"h_{host_first + i:03d}" for i in range(args.hosts)]
    insert_batches(cur, "INSERT INTO hosts (host_id, name, email, phone, profile_photo_url, verification_status, response_rate, response_time, host_since, access_level) VALUES (%s,%s,%s,%s,'',%s,%s,%s,%s,%s)", [
        (h, f"{rng.choice(FIRST)} {rng.choice(LAST)}", f"{h}@load.example.com", f"555-{rng.randint(1000, 9999)}", rng.choice(["verified", "verified", "pending"]),
         rng.randint(60, 100), rng.randint(5, 240), today - timedelta(days=rng.randint(30, 2000)), rng.choice(["standard", "standard", "superhost"])) for h in hosts])
    guest_first = next_ids(cur, "g", args.guests)
    guests = [f"g_{guest_first + i:03d}" for i in range(args.guests)]
    insert_batches(cur, "INSERT INTO guests (guest_id, first_name, last_name, email, phone, location, profile_photo_url, preferences, profile_created_datetime) VALUES (%s,%s,%s,%s,%s,%s,'',%s,%s)", [
        (g, rng.choice(FIRST), rng.choice(LAST), f"{g}@load.example.com", f"555-{rng.randint(1000, 9999)}", "San Jose, CA",
         json.dumps({"preferred_locations": [], "max_nightly_price": None, "property_types": [], "amenities": []}), now - timedelta(days=rng.randint(1, 700))) for g in guests])

    # ---- properties ----
    all_hosts = hosts or [f"h_{n:03d}" for n in range(1, 9)]
    prop_first = next_ids(cur, "p", args.properties)
    props, rows = [], []
    weights = [t[1] for t in TYPES]
    for i in range(args.properties):
        pid = f"p_{prop_first + i:03d}"
        kind, _, (cap_lo, cap_hi), base = rng.choices(TYPES, weights)[0]
        city, state, zip_code, lat, lng = rng.choice(CITIES)
        capacity = rng.randint(cap_lo, cap_hi)
        price = round(max(35, rng.gauss(base, base * 0.25)))
        amenities = rng.sample(AMENITIES, rng.randint(3, 9))
        reviews = rng.choice([0, 0, rng.randint(1, 120)])
        rating = round(rng.uniform(4.0, 5.0), 2) if reviews else 0
        status = "active" if rng.random() < 0.93 else "inactive"
        props.append((pid, price, round(price * 0.2), capacity, status))
        rows.append((pid, rng.choice(all_hosts), f"{rng.choice(ADJECTIVES)} {NOUNS[kind]} in {city}", "Generated listing for load testing.", kind,
                     f"{rng.randint(1, 2999)} {rng.choice(STREETS)}", city, state, zip_code, round(lat + rng.uniform(-0.03, 0.03), 6), round(lng + rng.uniform(-0.03, 0.03), 6),
                     capacity, max(1, capacity // 2) if kind != "private_room" else 1, rng.choice([1, 1.5, 2, 2.5]), json.dumps(amenities), price, round(price * 0.2), status,
                     rating, reviews, now - timedelta(days=rng.randint(1, 900)), ""))
    insert_batches(cur, "INSERT INTO properties (property_id, host_id, title, description, property_type, address, city, state, zip_code, latitude, longitude, capacity, bedrooms, bathrooms, amenities, nightly_price, cleaning_fee, status, rating, review_count, created_datetime, photo_url) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)", rows)
    active = [p for p in props if p[4] == "active"] or props

    # ---- reservations (+ held nights for pending/approved; those never overlap on a property) ----
    res_first = next_ids(cur, "r", args.reservations)
    avail_first = next_ids(cur, "a", args.reservations)
    held: dict[str, list[tuple[date, date]]] = {}
    res_rows, hist_rows, block_rows, night_rows = [], [], [], []
    made = 0
    attempts = 0
    while made < args.reservations and attempts < args.reservations * 6:
        attempts += 1
        pid, price, fee, capacity, _ = rng.choice(active)
        status = rng.choices(["completed", "approved", "pending", "cancelled", "declined", "failed"], [40, 20, 15, 12, 8, 5])[0]
        nights = rng.randint(1, 7)
        if status == "completed":
            check_in = today - timedelta(days=rng.randint(nights + 1, 400))
        else:
            check_in = today + timedelta(days=rng.randint(1, 300))
        check_out = check_in + timedelta(days=nights)
        if status in ("pending", "approved"):
            if any(check_in < e and check_out > s for s, e in held.get(pid, [])):
                continue
            held.setdefault(pid, []).append((check_in, check_out))
        rid = f"r_{res_first + made:03d}"
        trace = str(uuid.uuid4())
        guest = rng.choice(guests or [f"g_{n:03d}" for n in range(1, 13)])
        subtotal = price * nights
        failure = "DATE_CONFLICT" if status == "failed" else None
        reason = "Some of these dates are no longer available. Please pick other dates." if status == "failed" else None
        booked_at = now - timedelta(days=rng.randint(0, 30), hours=rng.randint(0, 23))
        res_rows.append((rid, trace, pid, guest, check_in, check_out, rng.randint(1, capacity), nights, price, subtotal, fee, subtotal + fee, booked_at, status, reason, failure, None, booked_at))
        hist_rows.append((rid, None, status, guest, trace, "generated", booked_at))
        if status in ("pending", "approved"):
            aid = f"a_{avail_first + made:03d}"
            block_rows.append((aid, pid, check_in, check_out, "booked", "booking", rid, booked_at))
            night_rows += [(pid, check_in + timedelta(days=d), aid) for d in range(nights)]
        made += 1
    insert_batches(cur, "INSERT INTO reservations (reservation_id, trace_id, property_id, guest_id, check_in, check_out, guest_count, nights, nightly_price, subtotal, cleaning_fee, total, booking_datetime, status, cancellation_reason, failure_code, guest_message, updated_datetime) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)", res_rows)
    insert_batches(cur, "INSERT INTO reservation_status_history (reservation_id, old_status, new_status, actor_id, trace_id, note, changed_at) VALUES (%s,%s,%s,%s,%s,%s,%s)", hist_rows)
    insert_batches(cur, "INSERT INTO availability_blocks (availability_id, property_id, start_date, end_date, status, source, reservation_id, updated_datetime) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)", block_rows)
    insert_batches(cur, "INSERT INTO availability_nights (property_id, night_date, availability_id) VALUES (%s,%s,%s)", night_rows, 2000)
    conn.commit()
    conn.close()
    total = args.hosts + args.guests + args.properties + made + len(block_rows) + len(night_rows)
    print(f"database {os.environ.get('MYSQL_DATABASE', 'xenia')}: added {args.hosts} hosts, {args.guests} guests, {args.properties} properties, {made} reservations, "
          f"{len(block_rows)} blocks, {len(night_rows)} held nights = {total} rows in {time.time() - started:.1f}s")


if __name__ == "__main__":
    main()
