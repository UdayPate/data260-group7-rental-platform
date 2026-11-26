"""The daily job (contract section 5 rule 6): finished stays become `completed`, unanswered requests expire.

  approved, check_out <= today (UTC)  ->  completed  + booking.completed
  pending,  check_in  <  today (UTC)  ->  declined ("Expired: ...") + its nights released + booking.declined / availability.released
Each change is a conditional UPDATE (WHERE status = what we read), so two copies running at once cannot apply it twice.
Run by hand:  python -m booking_service.jobs
"""
from __future__ import annotations

import logging
import threading
from typing import Any

from xenia_shared.config import env_int, load_env
from xenia_shared.db import Database, fetch_all, get_db
from xenia_shared.timeutil import today_utc

from . import core, models, repository

log = logging.getLogger("xenia.booking.jobs")
ACTOR = "booking-job"


def run_daily_job(db: Database | None = None) -> dict[str, int]:
    db = db or get_db()
    today = today_utc()
    with db.connection() as conn:
        finished = [r["reservation_id"] for r in fetch_all(conn, "SELECT reservation_id FROM reservations WHERE status = 'approved' AND check_out <= %s ORDER BY reservation_id", (today,))]
        stale = [r["reservation_id"] for r in fetch_all(conn, "SELECT reservation_id FROM reservations WHERE status = 'pending' AND check_in < %s ORDER BY reservation_id", (today,))]
    completed = sum(_complete(db, rid) for rid in finished)
    expired = sum(_expire(db, rid) for rid in stale)
    if completed or expired:
        log.info("daily job: %s completed, %s expired", completed, expired)
    return {"completed": completed, "expired": expired}


def _complete(db: Database, reservation_id: str) -> int:
    with db.transaction() as conn:
        row = repository.get_reservation(conn, reservation_id, for_update=True)
        if row is None or row["status"] != "approved" or not repository.change_status(conn, row, "completed", ACTOR, None, None, "stay finished"):
            return 0
    core.booking_event("booking.completed", {**row, "status": "completed"}, ACTOR)
    return 1


def _expire(db: Database, reservation_id: str) -> int:
    with db.transaction() as conn:
        row = repository.get_reservation(conn, reservation_id, for_update=True)
        if row is None or row["status"] != "pending" or not repository.change_status(conn, row, "declined", ACTOR, models.EXPIRED_TEXT):
            return 0
        block = core.release(conn, row)
    declined = {**row, "status": "declined", "cancellation_reason": models.EXPIRED_TEXT}
    core.booking_event("booking.declined", declined, ACTOR)
    if block:
        core.availability_event("availability.released", block, "booking_declined", row["trace_id"])
    return 1


def start_daily_job(stop: threading.Event) -> threading.Thread:
    """Run the job now (so a demo does not wait for midnight) and then every DAILY_JOB_INTERVAL_SECONDS."""
    interval = env_int("DAILY_JOB_INTERVAL_SECONDS", 86400)

    def loop() -> None:
        while not stop.is_set():
            try:
                run_daily_job()
            except Exception:  # noqa: BLE001  (a database hiccup must not kill the worker; try again next time)
                log.exception("daily job failed")
            stop.wait(interval)

    thread = threading.Thread(target=loop, name="daily-job", daemon=True)
    thread.start()
    return thread


if __name__ == "__main__":
    load_env()
    logging.basicConfig(level=logging.INFO)
    print(run_daily_job())
