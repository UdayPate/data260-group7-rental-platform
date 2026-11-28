"""Spec 13.3 evidence: two overlapping host blocks sent at the SAME instant. Pass = exactly one 201 and one 409 DATE_CONFLICT,
and MySQL holds the nights of ONE block only. Needs: User (8001) and Property (8002) running."""
import sys
import threading
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import PROPERTY_API, call, check, finish, free_window, login, rows, show  # noqa: E402

PROPERTY = "p_001"  # Maya's
token, user = login("maya.ortiz@example.com")
start, end = free_window(PROPERTY, 4)
print(f"Maya ({user['id']}) blocks {PROPERTY} twice at once: {start}..{end} and {start + timedelta(days=2)}..{end + timedelta(days=2)} (they overlap)")

barrier, answers = threading.Barrier(2), []


def block(a, b) -> None:
    barrier.wait()
    answers.append(call(PROPERTY_API, "/properties/availability", {"action": "block", "property_id": PROPERTY, "host_id": user["id"], "start_date": str(a), "end_date": str(b)}, token))


threads = [threading.Thread(target=block, args=(start, end)), threading.Thread(target=block, args=(start + timedelta(days=2), end + timedelta(days=2)))]
[t.start() for t in threads]
[t.join() for t in threads]
codes = sorted(a[0] for a in answers)
print("Answers:", codes)
check("exactly one 201 and one 409", codes == [201, 409])
winner = next((a[1] for a in answers if a[0] == 201), None)
loser = next((a[1] for a in answers if a[0] == 409), None)
if winner and loser:
    check("the 409 is DATE_CONFLICT", loser["error"]["code"] == "DATE_CONFLICT")
    check("the 409 names the block it clashed with", loser["error"]["details"]["availability_id"] == winner["availability_id"])
    show("availability_blocks in that window", rows("SELECT availability_id, start_date, end_date, status, source FROM availability_blocks WHERE property_id = %s AND start_date < %s AND end_date > %s", (PROPERTY, end + timedelta(days=2), start)))
    nights = rows("SELECT night_date, availability_id FROM availability_nights WHERE property_id = %s AND night_date >= %s AND night_date < %s ORDER BY night_date", (PROPERTY, start, end + timedelta(days=2)))
    show("availability_nights in that window", nights)
    check("only the winner's nights exist", {n["availability_id"] for n in nights} == {winner["availability_id"]})
    status, body, _ = call(PROPERTY_API, "/properties/availability", {"action": "unblock", "availability_id": winner["availability_id"], "host_id": user["id"]}, token)
    check("cleanup: Maya unblocks the winner", status == 200 and body.get("unblocked") is True)
finish("availability-conflict")
