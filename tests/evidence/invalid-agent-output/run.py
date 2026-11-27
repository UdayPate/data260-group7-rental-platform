"""Spec 7.5.5 evidence: an invalid agent output is rejected by the harness, then retried.

Runs the spec request as Alex with demo.invalid_agent_output: the Matcher's first round-0 output names
property p_999 (not a candidate) with score 1.7 (outside 0-1).
Pass = `agent.output_rejected` (matcher, round 0, action retry) naming both fields, then a valid Matcher
opinion AFTER it, and a normal result with nobody missing. The rejected message also goes to `dead.letter`.
Needs: User Service (8001), the AI service API (8007) and its agents.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from ai_common import SPEC_REQUEST, ai, check, finish, login, show, start, wait_done  # noqa: E402

token, user = login("alex.chen@example.com")
info = start(token, user["id"], SPEC_REQUEST, {"invalid_agent_output": True})
body = wait_done(token, info["task_id"])
events = body["events"]
print(f"Task {info['task_id']}, trace {info['trace_id']}")

rejected = [e for e in events if e["event_type"] == "agent.output_rejected"]
show("agent.output_rejected", [{"seq": e["seq"], **{k: e["payload"][k] for k in ("agent", "round", "action", "invalid_fields")}} for e in rejected])
if rejected:
    print(f"  reason: {rejected[0]['payload']['reason']}")
check("exactly one rejection: matcher, round 0, retry", [(e["payload"]["agent"], e["payload"]["round"], e["payload"]["action"]) for e in rejected] == [("matcher", 0, "retry")])
fields = rejected[0]["payload"]["invalid_fields"] if rejected else []
check("it names the unknown property id and the out-of-range score", "ranked[0].property_id" in fields and "ranked[0].score" in fields, str(fields))
opinion = next((e for e in events if e["event_type"] == "opinion.published" and e["actor_id"] == "matcher"), None)
check("a valid Matcher opinion follows the rejection", bool(opinion and rejected and opinion["seq"] > rejected[0]["seq"] and opinion["payload"]["ranked"][0]["property_id"] != "p_999"))
step3 = next(s for s in body["task"]["plan"]["steps"] if s["step_id"] == "s3")
print(f"  plan step s3 note: {step3['note']}")
_, result = ai("GET", f"/ai/results/{info['task_id']}", token)
check("the debate finished normally with nobody missing", body["task"]["status"] == "waiting_for_approval" and result.get("missing_agents") == [])
print("\n  The rejected message is on the dead.letter topic with this trace_id:")
print("  docker exec xenia-kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic dead.letter --from-beginning | grep " + info["trace_id"])
finish("invalid-agent-output")
