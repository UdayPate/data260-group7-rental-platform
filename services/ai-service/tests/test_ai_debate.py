"""End-to-end debates: API -> Kafka -> chair + agents -> MongoDB -> API / WebSocket.

Covers the guide's "Done when" lines for steps 2-10 and the mandatory features:
three concurrent debates without mixing (spec 13.11), agent timeout with partial results (13.10),
and rejecting invalid agent output (7.5.5).
"""
from __future__ import annotations

import json
import threading

from ai_service import llm, store
from ai_service.recompute import matches_stored

from ai_testkit import SPEC_REQUEST, token


def kinds(events):
    return [e["event_type"] for e in events]


def test_spec_request_full_debate(ai):
    started = ai.ask()
    body = ai.wait(started["task_id"])
    task, events = body["task"], body["events"]
    assert task["status"] == "waiting_for_approval"
    assert [e["seq"] for e in events] == list(range(1, len(events) + 1))  # no gaps, no doubles
    assert all(e["idempotency_key"] == f"{task['task_id']}:{e['seq']}" for e in events)
    assert all(e["trace_id"] == started["trace_id"] and e["entity"]["entity_id"] == task["task_id"] for e in events)
    assert all(len(e["timestamp"]) == 24 and e["timestamp"].endswith("Z") for e in events)  # UTC with milliseconds

    # step 3: parser + 7-step plan
    parsed = next(e for e in events if e["event_type"] == "requirements.parsed")["payload"]["requirements"]
    assert (parsed["location"], parsed["guest_count"], parsed["max_nightly_price"], parsed["min_rating"]) == ("San Jose", 2, 250, 4.5)
    assert parsed["amenities"] == ["parking", "kitchen"] and parsed["dates_assumed"] is True
    assert len(task["plan"]["steps"]) == 7 and all(s["status"] == "done" for s in task["plan"]["steps"])

    # step 4: three independent opinions, different #1, each with a reflection
    opinions = {e["actor_id"]: e["payload"] for e in events if e["event_type"] == "opinion.published"}
    assert set(opinions) == {"matcher", "risk", "fairness"}
    assert opinions["matcher"]["ranked"][0]["title"] == "Budget Studio near SJSU"
    assert opinions["risk"]["ranked"][0]["title"] == "Willow Glen Craftsman Cottage"
    assert {e["actor_id"] for e in events if e["event_type"] == "reflection.recorded"} == {"matcher", "risk", "fairness"}

    # step 6: disagreement, the Fairness challenge, answers, a vote with a reason from everyone
    disagreement = next(e for e in events if e["event_type"] == "disagreement.detected")["payload"]
    assert disagreement["score"] == 0.33
    challenges = [e["payload"] for e in events if e["event_type"] == "challenge.issued"]
    assert "fairness" in [c["to_agent"] for c in challenges]
    assert len([e for e in events if e["event_type"] == "challenge.answered"]) == len(challenges)
    votes = [e["payload"] for e in events if e["event_type"] == "vote.cast"]
    assert len(votes) == 3 and all(v["reason"] for v in votes)

    result = ai.result(task["task_id"])
    assert result["recommended"]["title"] == "Willow Glen Craftsman Cottage"
    assert result["consensus"] is True and result["missing_agents"] == []
    assert result["dissent"][0]["agent"] == "matcher" and result["dissent_note"]
    assert result["comparison"]["rejected_title"] == "Budget Studio near SJSU"
    assert len(result["ranked"]) == 5 and len(result["matcher_ranking"]) <= 10
    assert result["matcher_version"] == task["matcher_version"] == "matcher-v1"

    # step 7: measured evidence (every item has a source), generated rationale kept apart
    assert all(item["source"] for item in result["evidence"])
    assert all(item["fact"] not in result["rationale"] for item in result["evidence"])
    assert "Willow Glen Craftsman Cottage" in result["rationale"]

    # spec 13.5: the decision can be recomputed from the stored events alone
    same, again, stored = matches_stored(task["task_id"])
    assert same, (again, stored)


def test_invalid_agent_output_is_rejected_then_retried(ai):
    started = ai.ask(demo={"invalid_agent_output": True})
    events = ai.wait(started["task_id"])["events"]
    rejected = [e for e in events if e["event_type"] == "agent.output_rejected"]
    assert len(rejected) == 1
    p = rejected[0]["payload"]
    assert (p["agent"], p["round"], p["action"]) == ("matcher", 0, "retry")
    assert "ranked[0].property_id" in p["invalid_fields"] and "ranked[0].score" in p["invalid_fields"]
    # the retry is the valid output, published AFTER the rejection
    matcher_opinion = next(e for e in events if e["event_type"] == "opinion.published" and e["actor_id"] == "matcher")
    assert matcher_opinion["seq"] > rejected[0]["seq"] and matcher_opinion["payload"]["ranked"][0]["property_id"] != "p_999"
    result = ai.result(started["task_id"])
    assert result["missing_agents"] == []
    # the bad message went to dead.letter with the task's trace_id and the reason
    from xenia_shared.kafka import get_transport

    dead = [m for m in get_transport().messages("dead.letter") if m["trace_id"] == started["trace_id"]]
    assert dead and "p_999" in dead[0]["payload"]["reason"]


def test_delayed_risk_agent_times_out_and_the_debate_still_finishes(ai):
    started = ai.ask(demo={"delay_risk_agent": True})
    body = ai.wait(started["task_id"])
    assert body["task"]["status"] == "waiting_for_approval"
    timed_out = [e["payload"] for e in body["events"] if e["event_type"] == "agent.timed_out"]
    assert timed_out == [{**timed_out[0], "agent": "risk", "round": 2}]
    assert "risk" not in {e["actor_id"] for e in body["events"] if e["event_type"] == "vote.cast"}
    result = ai.result(started["task_id"])
    assert [m["agent"] for m in result["missing_agents"]] == ["risk"]
    assert "risk" in result["dissent_note"] and result["consensus"] is False and result["decision_rule"]
    same, again, stored = matches_stored(started["task_id"])
    assert same, (again, stored)
    # the late answer (sent ~2 s after the deadline) must not be counted for the closed round
    import time

    time.sleep(2.5)
    later = ai.client.get(f"/ai/tasks/{started['task_id']}", headers=token("g_001")).json()["events"]
    assert "risk" not in {e["actor_id"] for e in later if e["event_type"] in ("vote.cast", "challenge.answered")}


def test_three_debates_at_once_stay_isolated(ai):
    requests = [
        ("g_001", SPEC_REQUEST),
        ("g_002", "3 nights in Mountain View for 4, under $400, wifi and workspace"),
        ("g_003", "2 nights in Sunnyvale for 2 under $300 with a kitchen"),
    ]
    started: dict[str, dict] = {}

    def go(guest, text):
        started[guest] = ai.ask(guest, text)

    threads = [threading.Thread(target=go, args=r) for r in requests]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    cities = {"g_001": "San Jose", "g_002": "Mountain View", "g_003": "Sunnyvale"}
    for guest, info in started.items():
        body = ai.wait(info["task_id"], guest)
        assert body["task"]["status"] == "waiting_for_approval"
        assert {e["trace_id"] for e in body["events"]} == {info["trace_id"]}
        assert {e["entity"]["entity_id"] for e in body["events"]} == {info["task_id"]}
        assert body["task"]["requirements"]["location"] == cities[guest]
        result = ai.result(info["task_id"], guest)
        pool = next(e for e in body["events"] if e["event_type"] == "requirements.parsed")["payload"]["candidate_ids"]
        assert result["recommended"]["property_id"] in pool and result["recommended"]["city"] == cities[guest]
    # every AI message on Kafka was keyed by its trace_id, so one debate = one partition
    from xenia_shared.kafka import get_transport

    transport = get_transport()
    for topic in ("ai.requests", "debate.round.0", "debate.round.1", "debate.round.2", "ai.results"):
        for (t, partition), records in transport._log.items():
            if t != topic:
                continue
            for record in records:
                assert record.key == json.loads(record.value)["trace_id"]
    from ai_service.chair import chair

    assert chair.dropped_foreign == 0


def test_other_guests_and_roles_are_refused(ai):
    started = ai.ask()
    task_id = started["task_id"]
    assert ai.client.get(f"/ai/tasks/{task_id}", headers=token("g_002")).status_code == 403
    assert ai.client.get(f"/ai/tasks/{task_id}", headers=token("h_001", "host")).status_code == 403
    assert ai.client.get(f"/ai/tasks/{task_id}").status_code == 401
    assert ai.client.get("/ai/tasks/task_999", headers=token("g_001")).status_code == 404
    r = ai.client.post("/ai/requests", json={"guest_id": "g_002", "request_text": SPEC_REQUEST}, headers=token("g_001"))
    assert r.status_code == 403
    r = ai.client.post("/ai/requests", json={"guest_id": "g_001", "request_text": "short"}, headers=token("g_001"))
    assert r.status_code == 400 and r.json()["error"]["code"] == "VALIDATION_ERROR"
    assert ai.client.get("/ai/versions", headers=token("g_001")).status_code == 403
    ai.wait(task_id)


def test_result_is_409_while_running_and_approval_rules(ai):
    started = ai.ask()
    task_id = started["task_id"]
    early = ai.client.get(f"/ai/results/{task_id}", headers=token("g_001"))
    assert early.status_code == 409
    assert ai.client.post(f"/ai/tasks/{task_id}/approve", json={"guest_id": "g_001"}, headers=token("g_001")).status_code == 409
    ai.wait(task_id)
    assert ai.client.post(f"/ai/tasks/{task_id}/approve", json={"guest_id": "g_002"}, headers=token("g_002")).status_code == 403
    bad = ai.client.post(f"/ai/tasks/{task_id}/approve", json={"guest_id": "g_001", "edits": {"property_id": "p_030"}}, headers=token("g_001"))
    assert bad.status_code == 400
    result = ai.result(task_id)
    other = next(r["property_id"] for r in result["ranked"] if r["property_id"] != result["recommended"]["property_id"])
    edited = ai.client.post(f"/ai/tasks/{task_id}/approve", json={"guest_id": "g_001", "edits": {"property_id": other}}, headers=token("g_001"))
    assert edited.status_code == 200 and edited.json()["human_decision"]["decision"] == "edited"
    again = ai.client.post(f"/ai/tasks/{task_id}/approve", json={"guest_id": "g_001"}, headers=token("g_001"))
    assert again.status_code == 409
    body = ai.wait(task_id, until=("completed",))
    assert kinds(body["events"])[-2:] == ["decision.recorded", "task.status"]
    feedback = ai.client.get("/ai/feedback", headers=token("adm_001", "admin")).json()["items"]
    mine = [f for f in feedback if f["task_id"] == task_id]
    assert mine and mine[0]["trace_id"] == started["trace_id"] and mine[0]["decision"] == "edited"
    assert any(f["outcome"] == "led_to_version" for f in feedback) and any(f["outcome"] == "rejected" for f in feedback)


def test_approve_and_reject_book_nothing(ai, database):
    from xenia_shared.db import fetch_one

    with database.connection() as conn:
        before = fetch_one(conn, "SELECT COUNT(*) AS n FROM reservations")["n"]
    a, b = ai.ask(), ai.ask()
    ai.wait(a["task_id"]), ai.wait(b["task_id"])
    assert ai.client.post(f"/ai/tasks/{a['task_id']}/approve", json={"guest_id": "g_001"}, headers=token("g_001")).json()["human_decision"]["decision"] == "approved"
    assert ai.client.post(f"/ai/tasks/{b['task_id']}/reject", json={"guest_id": "g_001", "reason": " "}, headers=token("g_001")).status_code == 400
    assert ai.client.post(f"/ai/tasks/{b['task_id']}/reject", json={"guest_id": "g_001", "reason": "Too far"}, headers=token("g_001")).json()["human_decision"]["decision"] == "rejected"
    with database.connection() as conn:
        assert fetch_one(conn, "SELECT COUNT(*) AS n FROM reservations")["n"] == before


def test_stream_replays_after_seq_then_live_and_closes(ai):
    started = ai.ask()
    task_id = started["task_id"]
    ai.wait(task_id)
    url = f"/ai/tasks/{task_id}/stream?after_seq=5&token={token('g_001')['Authorization'][7:]}"
    received = []
    with ai.client.websocket_connect(url) as ws:
        total = len(store.all_events(task_id))
        while len(received) < total - 5:
            received.append(ws.receive_json())
        assert [e["seq"] for e in received] == list(range(6, total + 1))
        # still open in waiting_for_approval: the decision arrives live
        ai.client.post(f"/ai/tasks/{task_id}/reject", json={"guest_id": "g_001", "reason": "Not for me"}, headers=token("g_001"))
        live = [ws.receive_json(), ws.receive_json()]
        assert [e["event_type"] for e in live] == ["decision.recorded", "task.status"]
    # close codes: no token 4401, someone else's task 4403, unknown task 4404
    for path, code in (
        (f"/ai/tasks/{task_id}/stream", 4401),
        (f"/ai/tasks/{task_id}/stream?token={token('g_002')['Authorization'][7:]}", 4403),
        (f"/ai/tasks/task_404/stream?token={token('g_001')['Authorization'][7:]}", 4404),
    ):
        with ai.client.websocket_connect(path) as ws:
            try:
                ws.receive_json()
                raise AssertionError("expected a close")
            except Exception as closed:  # starlette raises WebSocketDisconnect with the code
                assert getattr(closed, "code", None) == code


def test_nothing_matches_gives_suggestions(ai):
    started = ai.ask(text="1 night in Fresno under $20 for 2 guests")
    body = ai.wait(started["task_id"])
    assert body["task"]["status"] == "completed"
    steps = {s["step_id"]: s for s in body["task"]["plan"]["steps"]}
    assert all(steps[s]["status"] == "skipped" and steps[s]["note"] for s in ("s3", "s4", "s5", "s6"))
    result = ai.result(started["task_id"])
    assert result["recommended"] is None and result["suggestions"]


def test_versions_promote_rollback_and_weight_rerun(ai):
    admin = token("adm_001", "admin")
    versions = ai.client.get("/ai/versions", headers=admin).json()
    assert versions["active_version_id"] == "matcher-v1" and [v["version_id"] for v in versions["versions"]] == ["matcher-v1", "matcher-v2"]
    assert ai.client.post("/ai/versions/matcher-v1/promote", json={}, headers=admin).status_code == 409
    assert ai.client.post("/ai/versions/matcher-v3/promote", json={}, headers=admin).status_code == 404
    promoted = ai.client.post("/ai/versions/matcher-v2/promote", json={}, headers=admin).json()
    assert promoted["active_version_id"] == "matcher-v2" and promoted["history"][-1]["by_name"] == "Platform Admin"
    v2_task = ai.ask()
    assert ai.wait(v2_task["task_id"])["task"]["matcher_version"] == "matcher-v2"
    assert ai.client.post("/ai/versions/matcher-v2/rollback", json={}, headers=admin).status_code == 409
    assert ai.client.post("/ai/versions/matcher-v1/rollback", json={}, headers=admin).json()["active_version_id"] == "matcher-v1"

    # rerun with risk penalty 0.40: the Matcher's #1 moves from Budget Studio to Willow Glen
    first = ai.ask()
    ai.wait(first["task_id"])
    weights = {"amenity_fit": 0.6, "price": 0.35, "rating": 0.1, "risk_penalty": 0.4, "review_count": 0.1}
    assert ai.client.post("/ai/requests", json={"guest_id": "g_001", "request_text": "different text here", "weights": weights,
                                                "parent_task_id": first["task_id"]}, headers=token("g_001")).status_code == 400
    assert ai.client.post("/ai/requests", json={"guest_id": "g_002", "request_text": SPEC_REQUEST, "weights": weights,
                                                "parent_task_id": first["task_id"]}, headers=token("g_002")).status_code == 403
    assert ai.client.post("/ai/requests", json={"guest_id": "g_001", "request_text": SPEC_REQUEST, "weights": {**weights, "price": 2}},
                          headers=token("g_001")).status_code == 400
    rerun = ai.ask(weights=weights, parent_task_id=first["task_id"])
    assert rerun["trace_id"] != first["trace_id"]
    ai.wait(rerun["task_id"])
    before, after = ai.result(first["task_id"]), ai.result(rerun["task_id"])
    assert before["matcher_ranking"][0]["title"] == "Budget Studio near SJSU"
    assert after["matcher_ranking"][0]["title"] == "Willow Glen Craftsman Cottage"
    assert after["parent_task_id"] == first["task_id"] and after["weights"]["risk_penalty"] == 0.4


def test_evaluation_modes(ai, monkeypatch):
    monkeypatch.setenv("AI_MODE", "matcher_only")
    only = ai.ask()
    body = ai.wait(only["task_id"])
    assert {e["actor_id"] for e in body["events"] if e["event_type"] == "opinion.published"} == {"matcher"}
    assert "challenge.issued" not in kinds(body["events"])
    assert ai.result(only["task_id"])["recommended"]["title"] == "Budget Studio near SJSU"
    monkeypatch.setenv("AI_MODE", "no_auditor")
    no_auditor = ai.ask()
    body = ai.wait(no_auditor["task_id"])
    assert {e["actor_id"] for e in body["events"] if e["event_type"] == "opinion.published"} == {"matcher", "risk"}
    assert "fairness" not in [e["payload"]["to_agent"] for e in body["events"] if e["event_type"] == "challenge.issued"]


def test_model_routing_and_semantic_cache(ai, monkeypatch):
    calls = []

    def fake_model(model, system, prompt):
        calls.append(model)
        if "Request:" in prompt:
            return '{"location": "San Jose", "guest_count": 2, "amenities": ["parking", "kitchen"], "property_types": ["castle"], "min_rating": 9}', 120, 40
        return json.dumps({"rationale": "Willow Glen Craftsman Cottage is the safest good fit for your two nights in San Jose."}), 200, 30

    llm.set_client(fake_model)
    first = ai.ask()
    ai.wait(first["task_id"])
    # a near-identical request (extra spaces and a trailing word) hits the cache: no second parser call
    second = ai.ask(text=SPEC_REQUEST.replace(",", " ,") + " please")
    ai.wait(second["task_id"])
    llm.set_client(None)
    parse_calls = list(store.db().model_calls.find({"purpose": "parse"}))
    assert [c["cached"] for c in parse_calls] == [False, True]
    assert parse_calls[0]["tier"] == "small" and parse_calls[0]["cost_estimate"] > 0
    stats = list(store.db().semantic_cache_stats.find({}))
    assert [s["hit"] for s in stats] == [False, True]
    # the model's invalid values were dropped ("castle", rating 9); what the rules read stayed as it was
    requirements = ai.wait(first["task_id"])["task"]["requirements"]
    assert requirements["property_types"] == [] and requirements["min_rating"] == 4.5
    from ai_service.parser_agent import model_fields

    assert model_fields({"property_types": ["condo", "castle"], "guest_count": "two", "max_nightly_price": 180}) == {"property_types": ["condo"], "max_nightly_price": 180}
    # the explanation came from the model and passed the check; evidence stayed measured
    result = ai.result(first["task_id"])
    assert result["rationale"].startswith("Willow Glen Craftsman Cottage is the safest")
    assert llm.route("2 nights in San Jose for 2 under $250", 3) == "small"
    assert llm.route("something nice next weekend near the bay for my family, we like quiet places and good coffee nearby", 1) == "frontier"
