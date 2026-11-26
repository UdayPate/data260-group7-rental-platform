"""Spec 13.2 evidence: stop the booking worker after Kafka has the event, restart it, nothing is lost or doubled.

This script starts and stops the worker ITSELF (so do not run the worker in another terminal). Needs: docker compose up (Kafka, MySQL),
User (8001) and Booking (8003) APIs running, and the repo's Python (the one with the services installed). Writes worker.log next to it.
"""
import os
import re
import shutil
import signal
import subprocess
import sys
import time
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE.parent))
from common import BOOKING_API, call, check, finish, free_window, login, rows, show, wait_until  # noqa: E402

GROUP, TOPIC = "booking-workers", "booking.requested"
if not shutil.which("docker"):
    sys.exit("This script reads Kafka's offsets with `docker exec xenia-kafka kafka-consumer-groups.sh`, so it needs docker.")


def lag() -> tuple[int, str]:
    out = subprocess.run(["docker", "exec", "xenia-kafka", "/opt/kafka/bin/kafka-consumer-groups.sh", "--bootstrap-server", "localhost:9092", "--describe", "--group", GROUP], capture_output=True, text=True).stdout
    total = 0
    for line in out.splitlines():
        parts = line.split()
        if len(parts) >= 6 and parts[1] == TOPIC and parts[5].isdigit():
            total += int(parts[5])
    return total, out


log = open(HERE / "worker.log", "ab")
worker: subprocess.Popen | None = None


def start_worker() -> None:
    global worker
    worker = subprocess.Popen([os.environ.get("PYTHON", sys.executable), "-m", "booking_service.worker"], cwd=ROOT / "services" / "booking-service", stdout=log, stderr=log)


def stop_worker() -> None:
    global worker
    if worker:
        worker.send_signal(signal.SIGTERM)
        worker.wait(20)
        worker = None


def request(token: str, guest: str, start, end) -> dict:
    status, body, _ = call(BOOKING_API, "/bookings/request", {"property_id": "p_005", "guest_id": guest, "check_in": str(start), "check_out": str(end), "guest_count": 1, "idempotency_key": str(uuid.uuid4())}, token)
    assert status == 202, (status, body)
    return body


def state(reservation_id: str, trace_id: str) -> dict:
    return {
        "reservations": rows("SELECT COUNT(*) AS n FROM reservations WHERE trace_id = %s", (trace_id,))[0]["n"],
        "held_nights": rows("SELECT COUNT(*) AS n FROM availability_nights n JOIN availability_blocks b USING (availability_id) WHERE b.reservation_id = %s", (reservation_id,))[0]["n"],
        "processed_events": rows("SELECT COUNT(*) AS n FROM processed_events WHERE consumer_group = %s AND trace_id = %s", (GROUP, trace_id))[0]["n"],
    }


token, alex = login("alex.chen@example.com")
try:
    print("0. warm-up: start the worker, send one request, stop the worker (so Kafka knows the consumer group)")
    start_worker()
    time.sleep(6)
    start, end = free_window("p_005", 2)
    warm = request(token, alex["id"], start, end)
    check("   warm-up request became pending", wait_until(lambda: rows("SELECT status FROM reservations WHERE reservation_id = %s", (warm["reservation_id"],))[0]["status"] == "pending", 30))
    stop_worker()

    print("\n1. worker is STOPPED. Alex sends a booking request")
    start, end = free_window("p_005", 2)
    reservation = request(token, alex["id"], start, end)
    rid, trace = reservation["reservation_id"], reservation["trace_id"]
    time.sleep(2)
    check("2. the API answered 202 and the reservation stays 'processing'", rows("SELECT status FROM reservations WHERE reservation_id = %s", (rid,))[0]["status"] == "processing", f"{rid}, trace {trace}")
    behind, out = lag()
    print("\n3. kafka-consumer-groups --describe --group booking-workers:\n" + out)
    check("   the event waits in Kafka: lag is 1", behind == 1, f"lag {behind}")
    before = state(rid, trace)

    print("\n4. START the worker")
    start_worker()
    check("   the reservation becomes 'pending'", wait_until(lambda: rows("SELECT status FROM reservations WHERE reservation_id = %s", (rid,))[0]["status"] == "pending", 30))
    check("5. lag goes to 0", wait_until(lambda: lag()[0] == 0, 20, 1))
    print("\n   " + lag()[1].replace("\n", "\n   "))

    after = state(rid, trace)
    show("6. database after recovery", [after])
    check("   exactly one reservation for this trace_id", after["reservations"] == 1)
    check("   one set of held nights", after["held_nights"] == (end - start).days)
    check("   one processed-event record", after["processed_events"] == 1)
    show("   reservation_status_history", rows("SELECT old_status, new_status, actor_id, trace_id FROM reservation_status_history WHERE reservation_id = %s ORDER BY history_id", (rid,)))

    print("\n7. send the SAME event again (same idempotency_key)")
    sys.path.insert(0, str(ROOT / "shared"))
    from xenia_shared.envelope import make_envelope  # noqa: PLC0415
    from xenia_shared.kafka import publish  # noqa: PLC0415

    os.environ.setdefault("KAFKA_BOOTSTRAP", "localhost:9092")
    publish(TOPIC, make_envelope("booking.requested", trace, alex["id"], "reservation", rid, {"reservation_id": rid}, idempotency_key=f"{trace}:booking.requested"), key="p_005")
    check("   the worker consumed it (lag back to 0)", wait_until(lambda: lag()[0] == 0, 20, 1))
    time.sleep(2)
    again = state(rid, trace)
    check("   nothing changed: still one reservation, one set of nights, one processed-event record", again == after, str(again))
finally:
    stop_worker()
print("\nWorker output is in", HERE / "worker.log")
finish("consumer-recovery")
