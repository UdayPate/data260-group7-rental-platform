"""Small helpers shared by the evidence scripts (plain Python + pymysql; they talk to the RUNNING services over HTTP).

Settings (environment variables, defaults in brackets):
  USER_API [http://localhost:8001]  PROPERTY_API [http://localhost:8002]  BOOKING_API [http://localhost:8003]
  MYSQL_HOST [127.0.0.1] MYSQL_PORT [3306] MYSQL_USER [xenia] MYSQL_PASSWORD [xenia] MYSQL_DATABASE [xenia]
"""
from __future__ import annotations

import json
import os
import random
import sys
import time
import urllib.error
import urllib.request
from datetime import date, timedelta

import pymysql

USER_API = os.environ.get("USER_API", "http://localhost:8001")
PROPERTY_API = os.environ.get("PROPERTY_API", "http://localhost:8002")
BOOKING_API = os.environ.get("BOOKING_API", "http://localhost:8003")
_failures: list[str] = []


def call(base: str, path: str, body: dict | None = None, token: str | None = None) -> tuple[int, dict, dict]:
    """POST JSON, return (status, json, headers). Never raises on a 4xx/5xx: the status IS the answer we want to see."""
    request = urllib.request.Request(base + path, data=json.dumps(body or {}).encode(), method="POST", headers={"Content-Type": "application/json", **({"Authorization": f"Bearer {token}"} if token else {})})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return response.status, json.loads(response.read() or b"{}"), {k.lower(): v for k, v in response.headers.items()}
    except urllib.error.HTTPError as problem:
        return problem.code, json.loads(problem.read() or b"{}"), {k.lower(): v for k, v in problem.headers.items()}


def login(email: str, password: str = "demo1234") -> tuple[str, dict]:
    status, body, _ = call(USER_API, "/auth/login", {"email": email, "password": password})
    if status != 200:
        sys.exit(f"Could not log in as {email}: {status} {body}. Is the User Service running on {USER_API} and the database seeded?")
    return body["token"], body["user"]


def signup_guest(n: int, run_id: str) -> tuple[str, str]:
    status, body, _ = call(USER_API, "/auth/signup", {"role": "guest", "email": f"evidence.{run_id}.{n}@example.com", "password": "evidence123", "first_name": "Evidence", "last_name": f"Guest{n}", "phone": "555-0100", "location": "San Jose, CA"})
    if status != 201:
        sys.exit(f"Could not create guest {n}: {status} {body}")
    return body["token"], body["user"]["id"]


def db() -> pymysql.connections.Connection:
    return pymysql.connect(
        host=os.environ.get("MYSQL_HOST", "127.0.0.1"), port=int(os.environ.get("MYSQL_PORT", "3306")), user=os.environ.get("MYSQL_USER", "xenia"),
        password=os.environ.get("MYSQL_PASSWORD", "xenia"), database=os.environ.get("MYSQL_DATABASE", "xenia"), charset="utf8mb4", autocommit=True,
        cursorclass=pymysql.cursors.DictCursor,
    )


def rows(sql: str, params: tuple = ()) -> list[dict]:
    conn = db()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            return list(cur.fetchall())
    finally:
        conn.close()


def show(title: str, data: list[dict]) -> None:
    """Print rows as a small table (this is what goes into the report)."""
    print(f"\n-- {title} ({len(data)} row{'s' if len(data) != 1 else ''})")
    if not data:
        return
    keys = list(data[0])
    widths = [max(len(k), *(len(str(r[k])) for r in data)) for k in keys]
    print("  " + "  ".join(k.ljust(w) for k, w in zip(keys, widths)))
    for r in data:
        print("  " + "  ".join(str(r[k]).ljust(w) for k, w in zip(keys, widths)))


def free_window(property_id: str, nights: int = 3) -> tuple[date, date]:
    """Some nights far in the future that nothing holds yet, so the script can be run again and again."""
    for _ in range(200):
        start = date.today() + timedelta(days=random.randint(60, 700))
        end = start + timedelta(days=nights)
        taken = rows("SELECT COUNT(*) AS n FROM availability_nights WHERE property_id = %s AND night_date >= %s AND night_date < %s", (property_id, start, end))[0]["n"]
        if not taken:
            return start, end
    sys.exit("Could not find free nights; clean the evidence rows or use another property.")


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}" + (f"  ({detail})" if detail else ""))
    if not ok:
        _failures.append(label)


def finish(name: str) -> None:
    print()
    if _failures:
        print(f"RESULT: FAIL ({name}): {len(_failures)} check(s) failed: " + "; ".join(_failures))
        sys.exit(1)
    print(f"RESULT: PASS ({name})")


def wait_until(condition, seconds: float, step: float = 0.25) -> bool:
    end = time.time() + seconds
    while time.time() < end:
        if condition():
            return True
        time.sleep(step)
    return condition()
