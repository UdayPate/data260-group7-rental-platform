"""The booking WORKER (spec 3.1): consumes booking.requested and holds the dates. Run:  python -m booking_service.worker

Per message, ONE database transaction (shared/kafka.py opens it and writes the processed_events row in it):
  lock the reservation -> skip unless 'processing' -> duplicate check -> hold the nights (or record the failure)
  -> status change + history row -> commit -> only THEN commit the Kafka offset -> only THEN publish availability.blocked.
Start several copies with the same group to share the partitions (scalability, fault tolerance).
"""
from __future__ import annotations

import logging
import os
import signal
import threading
import time
from typing import Any

from xenia_shared.config import env_int, load_env
from xenia_shared.db import get_db
from xenia_shared.kafka import PermanentError, TransientError, run_consumer
from xenia_shared.trace import emit_step

from . import core, jobs, repository

log = logging.getLogger("xenia.booking.worker")
GROUP = "booking-workers"
TOPICS = ["booking.requested"]


def handle_booking_requested(envelope: dict[str, Any], conn: Any):
    started = time.monotonic()
    reservation_id = envelope["payload"].get("reservation_id") or envelope["entity"]["entity_id"]
    row = repository.get_reservation(conn, reservation_id, for_update=True)
    if row is None:
        raise TransientError(f"reservation {reservation_id} is not visible yet")  # the API commits before it publishes; retry shortly, then dead-letter
    if row["status"] != "processing":  # a redelivered event, or already decided: nothing to do
        return None
    outcome, block = core.decide(conn, get_db(), row)
    latency = (time.monotonic() - started) * 1000
    actions = core.after_hold(row, outcome, block)
    actions.append(lambda: emit_step(row["trace_id"], "booking.requested", core.WORKER, latency, "ok" if outcome == "pending" else "failed", None if outcome == "pending" else "dates not held"))
    return actions


def main() -> None:
    load_env()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    stop = threading.Event()
    for sig in (signal.SIGINT, signal.SIGTERM):
        signal.signal(sig, lambda *_: stop.set())
    jobs.start_daily_job(stop)  # once now, then every DAILY_JOB_INTERVAL_SECONDS
    log.info("booking worker started (group %s)", GROUP)
    run_consumer(TOPICS, GROUP, handle_booking_requested, core.WORKER, db=get_db(), stop=stop)


if __name__ == "__main__":
    main()
