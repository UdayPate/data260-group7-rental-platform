"""Spec 13.1 evidence: 20 guests request the SAME nights of the SAME property at the SAME instant.

Pass = all 20 get 202 "processing"; after the worker has run, exactly 1 is "pending" and 19 are "failed" with DATE_CONFLICT;
MySQL holds ONE set of nights for that stay. Needs: User (8001), Booking (8003) and the booking worker running.
"""
import sys
import threading
import time
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import BOOKING_API, call, check, finish, free_window, rows, show, signup_guest, wait_until  # noqa: E402

PROPERTY = "p_005"
run_id = uuid.uuid4().hex[:8]
start, end = free_window(PROPERTY)
print(f"Evidence run {run_id}: 20 guests, property {PROPERTY}, nights {start} to {end} (check-out day excluded)")

guests = [signup_guest(n, run_id) for n in range(1, 21)]
print(f"Created {len(guests)} guests through /auth/signup")

barrier, answers = threading.Barrier(20), {}


def ask(token: str, guest_id: str) -> None:
    barrier.wait()  # everybody sends at the same instant
    answers[guest_id] = call(BOOKING_API, "/bookings/request", {"property_id": PROPERTY, "guest_id": guest_id, "check_in": str(start), "check_out": str(end), "guest_count": 1, "idempotency_key": str(uuid.uuid4())}, token)


threads = [threading.Thread(target=ask, args=g) for g in guests]
[t.start() for t in threads]
[t.join() for t in threads]
check("all 20 requests were accepted with 202", all(a[0] == 202 for a in answers.values()), str(sorted({a[0] for a in answers.values()})))
check("all 20 started as 'processing'", all(a[1].get("status") == "processing" for a in answers.values()))
ids = {g: a[1]["reservation_id"] for g, a in answers.items() if a[0] == 202}

mark = ",".join(["%s"] * len(ids))
undecided = lambda: rows(f"SELECT COUNT(*) AS n FROM reservations WHERE reservation_id IN ({mark}) AND status = 'processing'", tuple(ids.values()))[0]["n"] == 0  # noqa: E731
began = time.time()
check("the worker decided every request within 60 seconds", wait_until(undecided, 60), f"{time.time() - began:.1f}s")

result = rows(f"SELECT reservation_id, guest_id, status, failure_code, trace_id FROM reservations WHERE reservation_id IN ({mark}) ORDER BY reservation_id", tuple(ids.values()))
show("reservations of this run", result)
pending = [r for r in result if r["status"] == "pending"]
failed = [r for r in result if r["status"] == "failed"]
check("exactly 1 reservation is pending", len(pending) == 1, f"{len(pending)}")
check("exactly 19 reservations are failed", len(failed) == 19, f"{len(failed)}")
check("every failure is DATE_CONFLICT", all(r["failure_code"] == "DATE_CONFLICT" for r in failed))

nights = rows("SELECT n.property_id, n.night_date, n.availability_id, b.reservation_id FROM availability_nights n JOIN availability_blocks b USING (availability_id) WHERE n.property_id = %s AND n.night_date >= %s AND n.night_date < %s ORDER BY n.night_date", (PROPERTY, start, end))
show("availability_nights for those dates (one set, belonging to the winner)", nights)
check("MySQL holds exactly one set of nights", len(nights) == (end - start).days and len({n["reservation_id"] for n in nights}) == 1)
if pending and failed:
    check("the held nights belong to the pending reservation", nights[0]["reservation_id"] == pending[0]["reservation_id"])
    print(f"\nWinner trace_id: {pending[0]['trace_id']}  ({pending[0]['reservation_id']})")
    print(f"Loser  trace_id: {failed[0]['trace_id']}  ({failed[0]['reservation_id']})")
    show("status history of the winner", rows("SELECT old_status, new_status, actor_id, trace_id FROM reservation_status_history WHERE reservation_id = %s ORDER BY history_id", (pending[0]["reservation_id"],)))
finish("double-booking")
