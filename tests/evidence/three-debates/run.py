"""Spec 13.11 evidence: three recommendation debates at the same time, and no debate sees another's messages.

Pass = all three finish; every stored event of a task carries that task's trace_id and task_id; each
recommendation comes from that request's OWN candidate pool; on Kafka every AI message's key is its
trace_id, so each debate's messages sit on one partition per topic.
Needs: User Service (8001), the AI service API (8007) and its agents (python -m ai_service.workers ...).
"""
import sys
import threading
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ai_common import SPEC_REQUEST, ai, check, finish, kafka_partitions, login, round_of, show, start, wait_done  # noqa: E402

REQUESTS = [
    ("alex.chen@example.com", SPEC_REQUEST),
    ("sam.rivera@example.com", "3 nights in Mountain View for 4, under $400, wifi and workspace"),
    ("emily.novak@example.com", "2 nights in Sunnyvale for 2 under $300 with a kitchen"),
]

guests = [(login(email), text) for email, text in REQUESTS]
print("Logged in: " + ", ".join(f"{user['name']} ({user['id']})" for (_token, user), _text in guests))

barrier, started = threading.Barrier(len(guests)), {}


def go(token: str, user: dict, text: str) -> None:
    barrier.wait()  # all three requests leave at the same instant
    started[user["id"]] = start(token, user["id"], text)


threads = [threading.Thread(target=go, args=(token, user, text)) for (token, user), text in guests]
[t.start() for t in threads]
[t.join() for t in threads]
show("debates started together", [{"guest": g, "task_id": s["task_id"], "trace_id": s["trace_id"]} for g, s in started.items()])
spread = max(s["started"] for s in started.values()) - min(s["started"] for s in started.values())
check("the three requests were sent within one second", spread < 1, f"{spread * 1000:.0f} ms apart")

summary, all_traces = [], {s["trace_id"]: s["task_id"] for s in started.values()}
for (token, user), _text in guests:
    info = started[user["id"]]
    body = wait_done(token, info["task_id"])
    task, events = body["task"], body["events"]
    check(f"{info['task_id']} finished", task["status"] in ("waiting_for_approval", "completed"), task["status"])
    foreign = [e for e in events if e["trace_id"] != info["trace_id"] or e["entity"]["entity_id"] != info["task_id"]]
    check(f"{info['task_id']}: every one of its {len(events)} events has its own trace_id and task_id", not foreign, f"{len(foreign)} foreign")
    check(f"{info['task_id']}: seq is 1..{len(events)} with no gaps or doubles", [e["seq"] for e in events] == list(range(1, len(events) + 1)))
    per_round = Counter(round_of(e) for e in events)
    pool = next((e["payload"]["candidate_ids"] for e in events if e["event_type"] == "requirements.parsed"), [])
    _status, result = ai("GET", f"/ai/results/{info['task_id']}", token)
    recommended = (result.get("recommended") or {})
    check(f"{info['task_id']}: the recommendation {recommended.get('property_id')} is in its own pool", recommended.get("property_id") in pool)
    summary.append({
        "task_id": info["task_id"], "trace_id": info["trace_id"][:8] + "…", "city": task["requirements"]["location"],
        "events": len(events), **{k: per_round.get(k, 0) for k in ("setup / result", "round 0", "round 1", "round 2")},
        "pool": len(pool), "recommended": f"{recommended.get('property_id')} {recommended.get('title')}",
    })
show("per-task event counts (from ai_events) and results", summary)

partitions = kafka_partitions(list(all_traces))
if partitions is None:
    print("\n  [SKIPPED] Kafka partitions: Kafka is not reachable from here (KAFKA_BOOTSTRAP). Run with the docker-compose stack to include them.")
else:
    keys_ok = bool(partitions.pop("__keys_equal_trace_id__"))
    check("every AI message on Kafka has key = trace_id", keys_ok)
    rows = []
    for trace, places in partitions.items():
        topics = sorted({topic for topic, _p in places})
        parts = sorted({p for _t, p in places})
        rows.append({"task_id": all_traces[trace], "trace_id": trace[:8] + "…", "topics": len(topics), "partition(s)": parts})
        check(f"{all_traces[trace]}: one partition for all its messages", len(parts) == 1, str(parts))
    show("Kafka: where each debate's key went", rows)
finish("three-debates")
