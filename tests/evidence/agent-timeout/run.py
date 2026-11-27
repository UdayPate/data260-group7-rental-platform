"""Spec 13.10 evidence: one agent is delayed; the chair continues safely and reports the partial result.

Runs the spec request twice as Alex: once normally (the baseline), once with demo.delay_risk_agent, which
makes the Risk agent answer only after its round 2 deadline.
Pass = the delayed run records `agent.timed_out` for risk in round 2, still finishes with a result,
lists risk in missing_agents and the dissent_note, and does not count the late answer.
Needs: User Service (8001), the AI service API (8007) and its agents.
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ai_common import SPEC_REQUEST, ai, check, finish, login, millis_between, show, start, wait_done  # noqa: E402

token, user = login("alex.chen@example.com")


def run(demo: dict) -> tuple[dict, dict, float]:
    info = start(token, user["id"], SPEC_REQUEST, demo)
    body = wait_done(token, info["task_id"])
    _status, result = ai("GET", f"/ai/results/{info['task_id']}", token)
    events = body["events"]
    published = next((e for e in events if e["event_type"] == "result.published"), None)
    latency = millis_between(events[0]["timestamp"], published["timestamp"]) if published else float("nan")
    return body, result, latency


normal_body, normal_result, normal_ms = run({})
print(f"Baseline {normal_body['task']['task_id']} (trace {normal_body['task']['trace_id']}): {normal_ms:.0f} ms to the result")
body, result, delayed_ms = run({"delay_risk_agent": True})
task, events = body["task"], body["events"]
print(f"Delayed  {task['task_id']} (trace {task['trace_id']}): {delayed_ms:.0f} ms to the result")

timeouts = [e for e in events if e["event_type"] == "agent.timed_out"]
show("agent.timed_out events", [{"seq": e["seq"], "timestamp": e["timestamp"], **{k: e["payload"][k] for k in ("agent", "round", "deadline_ms", "reason")}} for e in timeouts])
round2 = next(e for e in events if e["event_type"] == "round.started" and e["payload"]["round"] == 2)
check("risk timed out in round 2", [(e["payload"]["agent"], e["payload"]["round"]) for e in timeouts] == [("risk", 2)])
if timeouts:
    waited = millis_between(round2["timestamp"], timeouts[0]["timestamp"])
    check("the chair waited for the deadline, not forever", round2["payload"]["deadline_ms"] <= waited < round2["payload"]["deadline_ms"] + 2000, f"{waited:.0f} ms after round 2 started")
check("the debate still finished with a recommendation", task["status"] == "waiting_for_approval" and bool(result.get("recommended")), task["status"])
check("result.missing_agents lists risk", [m["agent"] for m in result.get("missing_agents", [])] == ["risk"], str(result.get("missing_agents")))
check("the dissent_note names the missing agent", "risk" in (result.get("dissent_note") or ""))
show("partial result", [{"recommended": result["recommended"]["title"], "consensus": result["consensus"], "decision_rule": result["decision_rule"]}])
print(f"\n  missing_agents: {result.get('missing_agents')}\n  dissent_note:   {result.get('dissent_note')}")

time.sleep(3)  # the Risk agent's late answer arrives ~2 s after the deadline
_, later = ai("GET", f"/ai/tasks/{task['task_id']}", token)
late = [e for e in later["events"] if e["actor_id"] == "risk" and e["event_type"] in ("vote.cast", "challenge.answered")]
check("the late risk answer was not counted for the closed round", not late)
show("latency (spec 13.10 asks for the effect)", [
    {"run": "normal", "task_id": normal_body["task"]["task_id"], "ms_to_result": round(normal_ms), "recommended": normal_result["recommended"]["title"], "consensus": normal_result["consensus"]},
    {"run": "risk delayed", "task_id": task["task_id"], "ms_to_result": round(delayed_ms), "recommended": result["recommended"]["title"], "consensus": result["consensus"]},
])
finish("agent-timeout")
