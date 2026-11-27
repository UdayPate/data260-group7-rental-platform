"""Booking Assistant Chair + harness (spec 7.1, 7.2, 7.5.1, 7.5.2, 13.5, 13.10, 13.11).

    python -m ai_service.workers chair          (consumer group ai-chair; run more copies to scale)

The chair is the ONLY writer of a task's stream events: it validates every agent message,
gives it the next `seq`, stores it in MongoDB (store.append_event) and decides what happens next.
The API and the WebSocket only read what the chair stored.

Workflow state ("debate") is kept in the task document in MongoDB, never in a global variable, so:
  - three debates at once never mix (state is looked up by the message's task_id, and a message
    whose trace_id is not that task's trace_id is dropped and logged), and
  - if this chair process dies, another copy (same consumer group) takes over: Kafka gives it the
    partitions, and the deadline sweeper picks up tasks whose lease ran out.

Deadlines are real timers: a sweeper thread checks every 200 ms. When a round's deadline passes,
missing agents get `agent.timed_out` and the debate continues with the agents that answered.
A message that arrives after its round closed is ignored (it is never counted for a closed round).
"""
from __future__ import annotations

import logging
import os
import socket
import threading
import time
from collections import Counter, defaultdict
from typing import Any

from xenia_shared.config import env_float, env_str
from xenia_shared.envelope import make_envelope
from xenia_shared.kafka import publish as kafka_publish
from xenia_shared.timeutil import iso_millis, iso_seconds, utc_now
from xenia_shared.trace import emit_step

from . import explain, harness, listings, protocol, scoring, store

log = logging.getLogger("xenia.ai.chair")

ROUND_DEADLINE_MS = int(env_float("AI_ROUND_DEADLINE_MS", 8000))      # rounds 0 and 2 (contract 6.4 rule 3)
ROUND1_DEADLINE_MS = 5000                                             # round 1 is the chair's own (challenges)
STEP_DEADLINE_MS = int(env_float("AI_STEP_DEADLINE_MS", 10000))       # parser and explanation (they may call a model)
TASK_TIMEOUT_S = env_float("AI_TASK_TIMEOUT_SECONDS", 90)             # the whole debate, then status timed_out
LEASE_S = 30.0
ACTIVE_STAGES = ("parsing", "round0", "round2", "explaining")
AGENT_NAMES = {"matcher": "Matcher", "risk": "Risk agent", "fairness": "Fairness Auditor", "parser": "Request Parser", "explanation": "Explanation agent"}
TOPIC_OF = {"requirements.parsed": "ai.requests", "opinion.published": "debate.round.0", "challenge.answered": "debate.round.2",
            "vote.cast": "debate.round.2", "result.published": "ai.results"}
DECISION_RULE = ("No clear majority. Rule: a timed-out agent’s round 0 pick counts as half a vote; on a tie, "
                 "the listing with fewer risk flags wins, then the lower price.")


def chair_id() -> str:
    return os.environ.get("CHAIR_ID") or f"chair-{socket.gethostname()}-{os.getpid()}"


def make_plan(plan_id: str, trace_id: str) -> dict[str, Any]:
    """The 7 steps of spec 7.5.2: input, expected output, responsible agent and status for each."""
    rows = [
        ("Read the guest’s dates and requirements", "request text", "structured requirements", "parser"),
        ("Retrieve available properties", "requirements", "candidate property pool", "chair"),
        ("Ask independent agents to rank them", "candidate pool", "three ranked opinions (round 0)", "chair"),
        ("Identify disagreements", "round 0 opinions", "disagreement score and summary", "chair"),
        ("Request challenges and responses", "disagreement", "answers and votes (rounds 1-2)", "chair"),
        ("Verify availability again", "winning property and dates", "still available: yes/no", "chair"),
        ("Prepare a recommendation for human approval", "votes and evidence", "result with rationale, risks, dissent", "explanation"),
    ]
    return {
        "plan_id": plan_id, "trace_id": trace_id, "created_datetime": iso_millis(),
        "steps": [
            {"step_id": f"s{i}", "order": i, "title": t, "input": inp, "expected_output": out, "agent": agent, "status": "pending", "note": None}
            for i, (t, inp, out, agent) in enumerate(rows, start=1)
        ],
    }


class Chair:
    def __init__(self) -> None:
        self.me = chair_id()
        self._locks: defaultdict[str, threading.Lock] = defaultdict(threading.Lock)
        self._locks_guard = threading.Lock()
        self.dropped_foreign = 0  # messages whose trace_id did not match their task (must stay 0)

    def lock(self, task_id: str) -> threading.Lock:
        with self._locks_guard:
            return self._locks[task_id]

    # ============================================================== the consumer
    def handle(self, envelope: dict[str, Any], _conn: Any = None) -> None:
        """Called by run_consumer for every message on the chair's four topics."""
        if envelope["actor_id"] in ("chair", "harness"):
            return  # our own instructions, also on these topics
        task_id = protocol.task_of(envelope)
        with self.lock(task_id):
            task = store.get_task(task_id)
            if task is None:
                log.warning("message %s for unknown task %s ignored", envelope["event_type"], task_id)
                return
            problem = harness.check_trace(envelope, task)
            if problem:
                # Trace isolation (spec 13.11): never let another debate's message into this one.
                self.dropped_foreign += 1
                log.error("DROPPED %s from %s for %s: %s", envelope["event_type"], envelope["actor_id"], task_id, problem)
                self.dead_letter(envelope, f"Rejected by the chair: {problem}", ["trace_id"])
                return
            debate = task.get("debate")
            kind = envelope["event_type"]
            if kind == "ai.requests":
                if debate is None:
                    self.start(task, envelope)
                return
            if kind == "decision.recorded":
                self.on_decision(task, envelope)
                return
            if debate is None:
                return
            handler = {
                "requirements.parsed": self.on_parsed,
                "opinion.published": self.on_opinion,
                "challenge.answered": self.on_answer,
                "vote.cast": self.on_vote,
                "result.published": self.on_explanation,
            }.get(kind)
            if handler:
                handler(task, debate, envelope)

    # ============================================================== helpers
    def record(self, task: dict[str, Any], actor: str, event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
        return store.append_event(task["task_id"], task["trace_id"], actor, event_type, payload)

    def step(self, task: dict[str, Any], step_id: str, status: str, note: str | None = None) -> None:
        self.record(task, "harness", "plan.step_updated", {"step_id": step_id, "status": status, "note": note})

    def status(self, task: dict[str, Any], status: str, note: str | None = None) -> None:
        self.record(task, "harness", "task.status", {"status": status, "note": note})

    def save(self, task: dict[str, Any], debate: dict[str, Any], deadline_s: float | None = None) -> None:
        now = time.time()
        debate["owner"] = self.me
        debate["lease_until"] = now + LEASE_S
        debate["deadline_at"] = now + deadline_s if deadline_s is not None else None
        store.update_task(task["task_id"], {"debate": debate})
        task["debate"] = debate

    def instruct(self, topic: str, event_type: str, task: dict[str, Any], payload: dict[str, Any], key_suffix: str) -> None:
        protocol.send(topic, event_type, task["task_id"], task["trace_id"], "chair", payload, key_suffix)

    def dead_letter(self, envelope: dict[str, Any], reason: str, fields: list[str]) -> None:
        """A rejected agent output goes to dead.letter with its trace_id and the reason (the Platform dashboard counts these)."""
        try:
            kafka_publish("dead.letter", make_envelope(
                "dead.letter", envelope["trace_id"], "ai-chair", "message", f"{envelope['actor_id']}:{protocol.task_of(envelope)}",
                {"original_topic": TOPIC_OF.get(envelope["event_type"], "ai.requests"), "event_type": envelope["event_type"], "reason": reason, "invalid_fields": fields,
                 "consumer_group": protocol.GROUPS["chair"], "original_message": str(envelope)[:2000]},
            ), key=envelope["trace_id"])
        except Exception as problem:  # noqa: BLE001
            log.warning("could not dead-letter: %s", problem)

    def late(self, task: dict[str, Any], envelope: dict[str, Any], why: str) -> None:
        log.info("ignored late %s from %s for %s: %s", envelope["event_type"], envelope["actor_id"], task["task_id"], why)
        emit_step(task["trace_id"], envelope["event_type"], "ai-chair", 0, "timed_out", f"late message ignored ({why})")

    def reject(self, task, debate, envelope, agent: str, round_no: int, reason: str, fields: list[str]) -> bool:
        """agent.output_rejected + dead letter. Returns True if the agent gets its one retry."""
        attempts = debate["attempts"].get(agent, 0) + 1
        debate["attempts"][agent] = attempts
        retry = attempts <= 1
        name = AGENT_NAMES.get(agent, agent)
        text = f"Harness check failed: {reason}. " + (f"Asking the {name} to try again (retry 1 of 1)." if retry else f"Second invalid output, so the {name}’s answer is dropped.")
        self.record(task, "harness", "agent.output_rejected", {"agent": agent, "round": round_no, "reason": text, "invalid_fields": fields, "action": "retry" if retry else "dropped"})
        self.dead_letter(envelope, text, fields)
        emit_step(task["trace_id"], envelope["event_type"], "ai-chair", 0, "retried" if retry else "failed", text)
        return retry

    # ============================================================== step 1: the request
    def start(self, task: dict[str, Any], envelope: dict[str, Any]) -> None:
        mode = env_str("AI_MODE", "full").lower()
        if mode not in ("full", "matcher_only", "no_auditor"):
            mode = "full"
        debate = {
            "stage": "parsing", "mode": mode, "started_at": time.time(), "attempts": {}, "opinions": {}, "dropped": [],
            "missing": [], "answers": {}, "votes": {}, "notes": {},
        }
        self.status(task, "waiting", "Request received by the chair.")
        self.status(task, "planning", None)
        plan_number = task["task_id"].replace("task_", "")
        self.record(task, "chair", "plan.created", {"plan": make_plan(f"plan_{plan_number}", task["trace_id"])})
        self.step(task, "s1", "in_progress")
        self.ask_parser(task, attempt=0)
        self.save(task, debate, STEP_DEADLINE_MS / 1000)
        emit_step(task["trace_id"], "ai.requests", "ai-chair", 0, "ok", None, {"mode": mode})

    def ask_parser(self, task: dict[str, Any], attempt: int) -> None:
        self.instruct("ai.requests", "plan.step_updated", task,
                      {"step_id": "s1", "status": "in_progress", "note": None, "context": {"request_text": task["request_text"], "attempt": attempt}},
                      key_suffix=f"s1:{attempt}")

    def on_parsed(self, task, debate, envelope) -> None:
        if debate["stage"] != "parsing" or envelope["actor_id"] != "parser":
            return self.late(task, envelope, "parsing is over")
        snap = listings.load_snapshot()
        active_ids = {p["property_id"] for p in snap.properties if p["status"] == "active"}
        parsed, reason, fields = harness.check_parsed(envelope["payload"], active_ids)
        if parsed is None:
            if self.reject(task, debate, envelope, "parser", 0, reason, fields):
                self.ask_parser(task, attempt=1)
                return self.save(task, debate, STEP_DEADLINE_MS / 1000)
            self.step(task, "s1", "failed", "The parser’s output was invalid twice.")
            return self.fail(task, debate, "The request could not be read. Please rephrase it.")
        req = parsed["requirements"]
        self.record(task, "parser", "requirements.parsed", {"requirements": req, "candidate_ids": parsed["candidate_ids"]})
        self.step(task, "s1", "done", f"No dates in the request; assumed {req['check_in']} to {req['check_out']}." if req["dates_assumed"] else None)
        # Step 2 is the chair's own: retrieve the pool from the database (the parser's list must agree).
        self.step(task, "s2", "in_progress")
        pool = scoring.candidate_pool(snap, req)
        pool_ids = [p["property_id"] for p in pool]
        debate.update(requirements=req, candidate_ids=pool_ids)
        where = f" in {req['location']}" if req.get("location") else ""
        self.step(task, "s2", "done", f"{len(pool)} active listing(s){where}.")
        if not pool:
            for sid in ("s3", "s4", "s5", "s6"):
                self.step(task, sid, "skipped", "No candidate properties.")
            debate["nothing_matched"] = True
            return self.ask_explanation(task, debate, self.empty_result(task, snap, req), {"nothing_matched": True, "location": req.get("location")})
        agents = ["matcher"] if debate["mode"] == "matcher_only" else ["matcher", "risk"] if debate["mode"] == "no_auditor" else list(protocol.ANALYSIS_AGENTS)
        debate["round0_waiting"] = agents
        self.status(task, "in_debate", None)
        self.step(task, "s3", "in_progress")
        self.record(task, "chair", "round.started", {"round": 0, "deadline_ms": ROUND_DEADLINE_MS, "waiting_for": agents})
        self.ask_round0(task, debate, agents, attempt=0)
        debate["stage"] = "round0"
        self.save(task, debate, ROUND_DEADLINE_MS / 1000)

    def ask_round0(self, task, debate, agents: list[str], attempt: int, retry_agent: str | None = None) -> None:
        context = {
            "requirements": debate["requirements"], "candidate_ids": debate["candidate_ids"], "weights": task["weights"],
            "demo": task["demo"], "attempt": attempt, "retry_agent": retry_agent,
        }
        self.instruct("ai.requests", "round.started", task, {"round": 0, "deadline_ms": ROUND_DEADLINE_MS, "waiting_for": agents, "context": context},
                      key_suffix=f"r0:{attempt}:{retry_agent or 'all'}")

    # ============================================================== round 0
    def on_opinion(self, task, debate, envelope) -> None:
        agent = envelope["actor_id"]
        if debate["stage"] != "round0":
            return self.late(task, envelope, "round 0 is closed")
        if agent not in debate["round0_waiting"] or agent in debate["opinions"] or agent in debate["dropped"]:
            return self.late(task, envelope, "not expected from this agent")
        opinion, reason, fields = harness.check_opinion(envelope["payload"], set(debate["candidate_ids"]))
        if opinion is None:
            if self.reject(task, debate, envelope, agent, 0, reason, fields):
                self.ask_round0(task, debate, [agent], attempt=1, retry_agent=agent)
                debate["notes"][agent] = f"{AGENT_NAMES[agent]} output rejected once ({', '.join(fields)}); retry succeeded."
            else:
                debate["notes"][agent] = f"{AGENT_NAMES[agent]} output rejected twice; its opinion was dropped."
                debate["dropped"].append(agent)
                debate["missing"].append({"agent": agent, "round": 0, "reason": "Output rejected twice by the harness."})
            return self.after_round0_message(task, debate)
        reflections = opinion.pop("reflections")
        matcher_ranking = opinion.pop("matcher_ranking", None)
        if matcher_ranking is not None:
            debate["matcher_ranking"] = matcher_ranking
        self.record(task, agent, "opinion.published", opinion)
        for reflection in reflections:
            self.record(task, agent, "reflection.recorded", reflection)
        debate["opinions"][agent] = opinion
        self.after_round0_message(task, debate)

    def after_round0_message(self, task, debate) -> None:
        done = all(a in debate["opinions"] or a in debate["dropped"] for a in debate["round0_waiting"])
        if done:
            self.close_round0(task, debate)
        else:
            store.update_task(task["task_id"], {"debate": debate})

    def close_round0(self, task, debate) -> None:
        for agent in debate["round0_waiting"]:
            if agent not in debate["opinions"] and agent not in debate["dropped"]:
                self.record(task, "harness", "agent.timed_out", {
                    "agent": agent, "round": 0, "deadline_ms": ROUND_DEADLINE_MS,
                    "reason": "No opinion before the round 0 deadline.", "fallback": "Continuing with the agents that answered.",
                })
                debate["missing"].append({"agent": agent, "round": 0, "reason": "Timed out in round 0 (no opinion)."})
                emit_step(task["trace_id"], "agent.timed_out", "ai-chair", ROUND_DEADLINE_MS, "timed_out", f"{agent} missed round 0")
        publishers = [a for a in debate["round0_waiting"] if a in debate["opinions"]]
        if not publishers:
            self.step(task, "s3", "failed", "No agent published a valid opinion before the deadline.")
            return self.fail(task, debate, "None of the agents answered in time. Please try again.")
        self.step(task, "s3", "done", " ".join(debate["notes"].values()) or None)
        debate["picks"] = {a: debate["opinions"][a]["ranked"][0]["property_id"] for a in publishers}
        snap = listings.load_snapshot()
        if debate["mode"] == "matcher_only":
            self.step(task, "s4", "skipped", "AI_MODE=matcher_only: single-agent matching, no debate.")
            self.step(task, "s5", "skipped", "AI_MODE=matcher_only: no challenges or votes.")
            return self.finalize(task, debate, snap)

        # ---- step 4: disagreement (contract 6.4 rule 1) ----
        self.step(task, "s4", "in_progress")
        top_picks = [{"agent": a, "property_id": debate["picks"][a]} for a in publishers]
        counts = Counter(tp["property_id"] for tp in top_picks)
        score = scoring.round2(1 - max(counts.values()) / len(top_picks))
        title = lambda pid: (snap.property(pid) or {}).get("title", pid)  # noqa: E731
        summary = f"All agents rank {title(top_picks[0]['property_id'])} first." if score == 0 else " · ".join(f"{tp['agent']}: {title(tp['property_id'])}" for tp in top_picks)
        self.record(task, "chair", "disagreement.detected", {
            "round": 0, "score": score, "method": "1 - (agents agreeing with the most common #1 pick / agents that published)",
            "top_picks": top_picks, "summary": summary,
        })
        debate["disagreement"] = score
        self.step(task, "s4", "done", f"Disagreement {scoring.fmt(score)}.")

        # ---- step 5, round 1: challenges ----
        self.step(task, "s5", "in_progress")
        self.record(task, "chair", "round.started", {"round": 1, "deadline_ms": ROUND1_DEADLINE_MS, "waiting_for": ["chair"]})
        challenges = self.build_challenges(snap, debate)
        for c in challenges:
            payload = {"round": 1, "challenge_id": c["challenge_id"], "to_agent": c["to_agent"], "about_property_id": c["about_property_id"], "question": c["question"]}
            self.record(task, "chair", "challenge.issued", payload)
            self.instruct("debate.round.1", "challenge.issued", task, payload, key_suffix=c["challenge_id"])
        debate["challenges"] = challenges

        # ---- round 2: answers and votes ----
        debate["round2_waiting"] = publishers
        self.record(task, "chair", "round.started", {"round": 2, "deadline_ms": ROUND_DEADLINE_MS, "waiting_for": publishers})
        self.ask_round2(task, debate, publishers, attempt=0)
        debate["stage"] = "round2"
        self.save(task, debate, ROUND_DEADLINE_MS / 1000)

    def build_challenges(self, snap, debate) -> list[dict[str, Any]]:
        """Challenge when the picks differ; the Fairness Auditor is ALWAYS challenged (spec 7.2)."""
        picks = debate["picks"]
        challenges: list[dict[str, Any]] = []
        m = snap.property(picks["matcher"]) if "matcher" in picks else None
        r = snap.property(picks["risk"]) if "risk" in picks else None
        m_flags = scoring.risk_flags(snap, m) if m else []
        if m and r and m["property_id"] != r["property_id"]:
            challenges.append({"challenge_id": "c1", "to_agent": "matcher", "about_property_id": m["property_id"], "question": (
                f"Matcher, explain why “{m_flags[0]}” should not lower {m['title']}." if m_flags else f"Matcher, explain why {m['title']} beats {r['title']}.")})
            challenges.append({"challenge_id": "c2", "to_agent": "risk", "about_property_id": r["property_id"], "question": (
                f"Risk agent, show which evidence makes {r['title']} safer than {m['title']}, "
                f"given it costs ${scoring.fmt(r['nightly_price'] - m['nightly_price'])} more per night.")})
        if "fairness" in picks:
            question = "Fairness Auditor, was any good listing ranked lower because of popularity (review count) rather than fit?"
            if m_flags and m:
                question += f" And is the cancellation penalty on {m['title']} fair?"
            challenges.append({"challenge_id": f"c{len(challenges) + 1}", "to_agent": "fairness", "about_property_id": None, "question": question})
        return challenges

    def ask_round2(self, task, debate, agents: list[str], attempt: int, retry_agent: str | None = None) -> None:
        context = {
            "requirements": debate["requirements"], "candidate_ids": debate["candidate_ids"], "weights": task["weights"], "demo": task["demo"],
            "picks": debate["picks"], "opinions": debate["opinions"], "challenges": debate["challenges"],
            "deadline_ms": ROUND_DEADLINE_MS, "attempt": attempt, "retry_agent": retry_agent,
        }
        self.instruct("debate.round.1", "round.started", task, {"round": 2, "deadline_ms": ROUND_DEADLINE_MS, "waiting_for": agents, "context": context},
                      key_suffix=f"r2:{attempt}:{retry_agent or 'all'}")

    # ============================================================== round 2
    def round2_open_for(self, task, debate, envelope) -> bool:
        agent = envelope["actor_id"]
        if debate["stage"] != "round2":
            self.late(task, envelope, "round 2 is closed")
            return False
        if agent not in debate["round2_waiting"] or agent in debate["votes"] or agent in debate["dropped"]:
            self.late(task, envelope, "not expected from this agent")
            return False
        return True

    def on_answer(self, task, debate, envelope) -> None:
        if not self.round2_open_for(task, debate, envelope):
            return
        agent = envelope["actor_id"]
        mine = {c["challenge_id"] for c in debate["challenges"] if c["to_agent"] == agent}
        answer, reason, fields = harness.check_answer(envelope["payload"], mine)
        if answer is None:
            if self.reject(task, debate, envelope, agent, 2, reason, fields):
                self.ask_round2(task, debate, [agent], attempt=1, retry_agent=agent)
            store.update_task(task["task_id"], {"debate": debate})
            return
        if answer["challenge_id"] in debate["answers"]:
            return
        self.record(task, agent, "challenge.answered", answer)
        debate["answers"][answer["challenge_id"]] = {**answer, "agent": agent}
        store.update_task(task["task_id"], {"debate": debate})

    def on_vote(self, task, debate, envelope) -> None:
        if not self.round2_open_for(task, debate, envelope):
            return
        agent = envelope["actor_id"]
        vote, reason, fields = harness.check_vote(envelope["payload"], set(debate["candidate_ids"]))
        if vote is None:
            if self.reject(task, debate, envelope, agent, 2, reason, fields):
                self.ask_round2(task, debate, [agent], attempt=1, retry_agent=agent)
            else:
                debate["dropped"].append(agent)
                debate["missing"].append({"agent": agent, "round": 2, "reason": "Vote rejected twice by the harness."})
        else:
            self.record(task, agent, "vote.cast", vote)
            debate["votes"][agent] = vote
        if all(a in debate["votes"] or a in debate["dropped"] for a in debate["round2_waiting"]):
            self.close_round2(task, debate)
        else:
            store.update_task(task["task_id"], {"debate": debate})

    def close_round2(self, task, debate) -> None:
        snap = listings.load_snapshot()
        for agent in debate["round2_waiting"]:
            if agent not in debate["votes"] and agent not in debate["dropped"]:
                pick = snap.property(debate["picks"][agent])
                self.record(task, "harness", "agent.timed_out", {
                    "agent": agent, "round": 2, "deadline_ms": ROUND_DEADLINE_MS,
                    "reason": "No answer or vote before the round 2 deadline.",
                    "fallback": f"Continuing without it; its round 0 pick ({pick['title'] if pick else debate['picks'][agent]}) counts as half a vote.",
                })
                debate["missing"].append({"agent": agent, "round": 2, "reason": "Timed out in round 2 (no answer, no vote).", "half_vote": True})
                emit_step(task["trace_id"], "agent.timed_out", "ai-chair", ROUND_DEADLINE_MS, "timed_out", f"{agent} missed the round 2 deadline")
        self.finalize(task, debate, snap)

    # ============================================================== tally, re-check, result
    def finalize(self, task, debate, snap) -> None:
        req, pool = debate["requirements"], [snap.property(pid) for pid in debate["candidate_ids"]]
        pool = [p for p in pool if p is not None]
        by_id = {p["property_id"]: p for p in pool}
        weights = task["weights"]
        matcher = scoring.rank_matcher(snap, pool, req, weights)

        # ---- the votes (contract 6.4 rule 4) ----
        votes: list[dict[str, Any]] = []
        if debate["mode"] == "matcher_only":
            votes.append({"agent": "matcher", "property_id": debate["picks"]["matcher"], "weight": 1, "reason": "single-agent mode"})
        else:
            for agent, v in debate["votes"].items():
                if v["vote"] != "abstain":
                    votes.append({"agent": agent, "property_id": v["property_id"], "weight": 1, "reason": v["reason"]})
            for m in debate["missing"]:
                if m.get("half_vote"):
                    votes.append({"agent": m["agent"], "property_id": debate["picks"][m["agent"]], "weight": 0.5, "reason": "round 0 position (timed out)"})
        if not votes:  # everyone abstained: fall back to the Matcher's order
            votes.append({"agent": "chair", "property_id": matcher[0]["p"]["property_id"], "weight": 0.5, "reason": "no votes; Matcher order"})
        tally: dict[str, float] = defaultdict(float)
        for v in votes:
            tally[v["property_id"]] += v["weight"]
        # Ties: fewer risk flags wins, then the lower price (the written decision rule).
        ordered = sorted(tally.items(), key=lambda kv: (-kv[1], len(scoring.risk_flags(snap, by_id[kv[0]])), by_id[kv[0]]["nightly_price"]))
        if debate["mode"] != "matcher_only":
            self.step(task, "s5", "done")

        # ---- step 6: re-check availability (a listing booked during the debate must not win) ----
        self.step(task, "s6", "in_progress")
        candidates = [pid for pid, _ in ordered] + [s["p"]["property_id"] for s in matcher if s["p"]["property_id"] not in tally]
        winner_id, skipped = None, []
        for pid in candidates:
            if listings.is_still_free(pid, req.get("check_in"), req.get("check_out")):
                winner_id = pid
                break
            skipped.append(by_id[pid]["title"])
        if winner_id is None:
            self.step(task, "s6", "failed", "None of the candidates is still free on these dates.")
            debate["nothing_matched"] = True
            return self.ask_explanation(task, debate, self.empty_result(task, snap, req, booked_meanwhile=True),
                                        {"nothing_matched": True, "location": req.get("location")})
        winner = by_id[winner_id]
        note = f"{winner['title']} is still free {req['check_in']} to {req['check_out']}."
        if skipped:
            note = f"{', '.join(skipped)} NO LONGER free (booked during the debate); " + note
        self.step(task, "s6", "done", note)

        # ---- the measured result (evidence, risks) ----
        full_votes = [v for v in votes if v["weight"] == 1]
        winner_full = len([v for v in full_votes if v["property_id"] == winner_id])
        consensus = debate["mode"] != "matcher_only" and not debate["missing"] and winner_full >= 2 and not skipped
        decision_rule = None
        if debate["mode"] == "matcher_only":
            decision_rule = "Single-agent mode (AI_MODE=matcher_only): the Matcher’s first choice."
        elif skipped:
            decision_rule = "The vote winner was booked during the debate, so the next listing in the vote order that is still free was chosen."
        elif not consensus:
            decision_rule = DECISION_RULE
        dissent = [{"agent": v["agent"], "preferred_property_id": v["property_id"], "reason": v["reason"]} for v in full_votes if v["property_id"] != winner_id]
        runner_up_id = next((pid for pid, _ in ordered if pid != winner_id), None)
        if runner_up_id is None and debate["picks"].get("matcher") not in (None, winner_id):
            runner_up_id = debate["picks"]["matcher"]
        runner = by_id.get(runner_up_id) if runner_up_id else None
        fit = scoring.fit_of(snap, winner, req)
        host = snap.hosts.get(winner["host_id"], {})
        score_of = {s["p"]["property_id"]: s for s in matcher}

        def result_property(pid: str) -> dict[str, Any]:
            return {**scoring.to_ranked(score_of[pid]), "nightly_price": by_id[pid]["nightly_price"], "city": by_id[pid]["city"]}

        top5 = [winner_id] + [s["p"]["property_id"] for s in matcher if s["p"]["property_id"] != winner_id]
        nights = scoring.nights_between(req["check_in"], req["check_out"]) if req.get("check_in") and req.get("check_out") else None
        fairness_answer = next((a for a in debate["answers"].values() if a["agent"] == "fairness"), None)
        popularity_flagged = bool(fairness_answer) and fairness_answer["evidence"] != ["no rank changes"]
        total_weight = sum(v["weight"] for v in votes)
        result = {
            "task_id": task["task_id"], "trace_id": task["trace_id"],
            "recommended": result_property(winner_id),
            "ranked": [result_property(pid) for pid in top5[:5]],
            "confidence": scoring.round2(scoring.clamp(tally.get(winner_id, 0) / total_weight * 0.9, 0.4, 0.95)),
            "rationale": "",  # written by the Explanation agent (generated text)
            "evidence": [  # measured: built here from records, each with its source
                {"fact": f"nightly_price ${scoring.fmt(winner['nightly_price'])}" + (f" ≤ ${scoring.fmt(req['max_nightly_price'])}" if req.get("max_nightly_price") else ""), "source": f"property {winner_id}"},
                {"fact": f"rating {scoring.fmt(winner['rating'])} ({winner['review_count']} reviews)", "source": f"property {winner_id}"},
                {"fact": f"amenities: {', '.join(winner['amenities'])}", "source": f"property {winner_id}"},
                {"fact": f"free {req['check_in']} to {req['check_out']}" + (f" ({nights} nights)" if nights else ""), "source": "availability re-check (plan step 6)"},
                {"fact": f"host response rate {host.get('response_rate')}%", "source": f"host {winner['host_id']}"},
            ],
            "risks": (
                [{"severity": "high", "text": t, "source_agent": "risk"} for t in scoring.risk_flags(snap, winner)]
                + [{"severity": "medium", "text": f"Does not meet: {f}", "source_agent": "matcher"} for f in fit["failed"]]
                + ([{"severity": "medium", "text": f"No dates in the request; assumed {req['check_in']} to {req['check_out']}.", "source_agent": "parser"}] if req.get("dates_assumed") else [])
                + ([{"severity": "low", "text": "Matcher score uses review count (popularity); flagged for matcher-v2.", "source_agent": "fairness"}] if popularity_flagged else [])
            ),
            "consensus": consensus, "decision_rule": decision_rule, "dissent": dissent, "dissent_note": None,
            "missing_agents": [{"agent": m["agent"], "round": m["round"], "reason": m["reason"]} for m in debate["missing"]],
            "comparison": {
                "rejected_property_id": runner["property_id"], "rejected_title": runner["title"],
                "why_lower": (f"Cheaper or similar on fit, but {'; '.join(scoring.risk_flags(snap, runner))}." if scoring.risk_flags(snap, runner)
                              else f"Fewer votes in round 2 ({scoring.fmt(tally.get(runner['property_id'], 0))} vs {scoring.fmt(tally.get(winner_id, 0))})."),
            } if runner else None,
            "suggestions": [],
            "check_in": req.get("check_in"), "check_out": req.get("check_out"), "guest_count": req.get("guest_count"),
            "human_decision": None, "matcher_version": task["matcher_version"], "weights": weights, "parent_task_id": task.get("parent_task_id"),
            "matcher_ranking": debate.get("matcher_ranking") or [scoring.to_rank_entry(s, i) for i, s in enumerate(matcher[:10])],
            "created_datetime": None,
        }
        flags = scoring.risk_flags(snap, runner) if runner else []
        facts = {
            "nothing_matched": False,
            "winner": {"title": winner["title"], "city": winner["city"], "nightly_price": winner["nightly_price"], "rating": winner["rating"],
                       "review_count": winner["review_count"], "host_response_rate": host.get("response_rate"),
                       "passed": len(fit["passed"]), "total": len(fit["passed"]) + len(fit["failed"])},
            "runner_up": {"title": runner["title"], "nightly_price": runner["nightly_price"], "first_flag": flags[0] if flags else None} if runner else None,
            "evidence": result["evidence"], "risks": result["risks"],
        }
        debate["titles"] = {p["property_id"]: p["title"] for p in pool}
        self.ask_explanation(task, debate, result, facts)

    def empty_result(self, task, snap, req, booked_meanwhile: bool = False) -> dict[str, Any]:
        """Nothing to recommend: say why and give travel-coach suggestions (never continue silently)."""
        others = [c for c in snap.cities() if c != req.get("location")]
        suggestions = []
        if booked_meanwhile:
            suggestions.append("Every matching listing was booked during the debate: try nearby dates.")
        if others:
            suggestions.append(f"Try {', '.join(others[:-1])} or {others[-1]}." if len(others) > 1 else f"Try {others[0]}.")
        suggestions.append("Remove a requirement or raise the budget.")
        where = f" in {req['location']}" if req.get("location") else ""
        return {
            "task_id": task["task_id"], "trace_id": task["trace_id"], "recommended": None, "ranked": [], "confidence": 0,
            "rationale": "", "evidence": [{"fact": f"0 active listings{where}" if not booked_meanwhile else "0 candidates still free", "source": "property search" if not booked_meanwhile else "availability re-check (plan step 6)"}],
            "risks": [], "consensus": True, "decision_rule": None, "dissent": [], "dissent_note": None, "missing_agents": [],
            "comparison": None, "suggestions": suggestions,
            "check_in": req.get("check_in"), "check_out": req.get("check_out"), "guest_count": req.get("guest_count"),
            "human_decision": None, "matcher_version": task["matcher_version"], "weights": task["weights"],
            "parent_task_id": task.get("parent_task_id"), "matcher_ranking": [], "created_datetime": None,
        }

    # ============================================================== step 7: explanation
    def ask_explanation(self, task, debate, draft: dict[str, Any], facts: dict[str, Any]) -> None:
        self.step(task, "s7", "in_progress")
        debate["draft"], debate["facts"] = draft, facts
        context = {"facts": facts, "dissent": draft["dissent"], "missing": debate["missing"], "titles": debate.get("titles", {})}
        self.instruct("ai.results", "plan.step_updated", task, {"step_id": "s7", "status": "in_progress", "note": None, "context": context}, key_suffix="s7")
        debate["stage"] = "explaining"
        self.save(task, debate, STEP_DEADLINE_MS / 1000)

    def on_explanation(self, task, debate, envelope) -> None:
        if envelope["actor_id"] != "explanation":
            return
        if debate["stage"] != "explaining":
            return self.late(task, envelope, "the result is already published")
        title = (debate["draft"].get("recommended") or {}).get("title")
        text, reason, fields = harness.check_explanation(envelope["payload"], title)
        note = None
        if text is None:
            self.record(task, "harness", "agent.output_rejected", {"agent": "explanation", "round": 2, "reason": f"Harness check failed: {reason}. Using the template explanation instead.", "invalid_fields": fields, "action": "dropped"})
            self.dead_letter(envelope, reason, fields)
            text, note = self.fallback_text(debate), "Explanation agent output rejected; template rationale used."
        self.publish_result(task, debate, text, note)

    def fallback_text(self, debate) -> dict[str, Any]:
        return {"rationale": explain.template_rationale(debate["facts"]),
                "dissent_note": explain.dissent_note(debate["draft"]["dissent"], debate["missing"], debate.get("titles", {}))}

    def publish_result(self, task, debate, text: dict[str, Any], note: str | None = None) -> None:
        result = {**debate["draft"], "rationale": text["rationale"], "dissent_note": text.get("dissent_note"), "created_datetime": iso_seconds(utc_now())}
        store.save_result(result)
        self.record(task, "chair", "result.published", {"result": result})
        try:
            self.instruct("ai.results", "result.published", task, {"result": result}, key_suffix="final")
        except Exception as problem:  # noqa: BLE001  (the result is stored; the topic copy is for other consumers)
            log.warning("could not publish the result to ai.results: %s", problem)
        self.step(task, "s7", "done", note)
        latency = (time.time() - debate["started_at"]) * 1000
        if debate.get("nothing_matched"):
            self.status(task, "completed", "No candidates; nothing to approve.")
            debate["stage"] = "done"
        else:
            self.status(task, "waiting_for_approval", None)
            debate["stage"] = "waiting_for_approval"
        debate["latency_ms"] = round(latency)
        self.save(task, debate, None)
        emit_step(task["trace_id"], "result.published", "ai-chair", latency, "ok", None,
                  {"missing_agents": [m["agent"] for m in debate["missing"]], "consensus": result["consensus"]})

    # ============================================================== human decision, failures
    def on_decision(self, task, envelope) -> None:
        debate = task.get("debate") or {}
        if debate.get("stage") != "waiting_for_approval":
            return
        decision = envelope["payload"]["decision"]
        self.record(task, decision["guest_id"], "decision.recorded", {"decision": decision})
        self.status(task, "completed", f"Guest {decision['decision']} the recommendation.")
        debate["stage"] = "done"
        self.save(task, debate, None)
        emit_step(task["trace_id"], "decision.recorded", "ai-chair", 0, "ok", None, {"decision": decision["decision"]})

    def fail(self, task, debate, message: str) -> None:
        self.status(task, "failed", message)
        store.update_task(task["task_id"], {"error": message})
        debate["stage"] = "done"
        self.save(task, debate, None)
        emit_step(task["trace_id"], "task.status", "ai-chair", 0, "failed", message)

    # ============================================================== the deadline sweeper
    def on_deadline(self, task_id: str) -> None:
        with self.lock(task_id):
            task = store.get_task(task_id)
            debate = (task or {}).get("debate")
            if not debate or debate["stage"] not in ACTIVE_STAGES:
                return
            now = time.time()
            if now - debate["started_at"] > TASK_TIMEOUT_S:
                message = f"The debate took longer than {int(TASK_TIMEOUT_S)} seconds and was stopped."
                self.status(task, "timed_out", message)
                store.update_task(task_id, {"error": message})
                debate["stage"] = "done"
                self.save(task, debate, None)
                emit_step(task["trace_id"], "task.status", "ai-chair", TASK_TIMEOUT_S * 1000, "timed_out", message)
                return
            if debate.get("deadline_at") is None or debate["deadline_at"] > now:
                return
            stage = debate["stage"]
            if stage == "parsing":
                self.record(task, "harness", "agent.timed_out", {"agent": "parser", "round": 0, "deadline_ms": STEP_DEADLINE_MS,
                                                                  "reason": "The parser did not answer in time.", "fallback": "Stopping safely."})
                self.step(task, "s1", "failed", "The parser did not answer before the deadline.")
                self.fail(task, debate, "The request could not be read in time. Please try again.")
            elif stage == "round0":
                self.close_round0(task, debate)
            elif stage == "round2":
                self.close_round2(task, debate)
            elif stage == "explaining":
                self.record(task, "harness", "agent.timed_out", {"agent": "explanation", "round": 2, "deadline_ms": STEP_DEADLINE_MS,
                                                                  "reason": "The explanation agent did not answer in time.", "fallback": "Using the template explanation."})
                self.publish_result(task, debate, self.fallback_text(debate), "Explanation agent timed out; template rationale used.")

    def sweep_once(self) -> None:
        now = time.time()
        d = store.db()
        due = d.ai_tasks.find({
            "debate.stage": {"$in": list(ACTIVE_STAGES)},
            "$and": [
                {"$or": [{"debate.deadline_at": {"$lte": now}}, {"debate.started_at": {"$lte": now - TASK_TIMEOUT_S}}]},
                {"$or": [{"debate.owner": self.me}, {"debate.lease_until": {"$lt": now}}]},  # mine, or an abandoned one
            ],
        }, {"task_id": 1})
        for row in list(due):
            try:
                self.on_deadline(row["task_id"])
            except Exception:  # noqa: BLE001
                log.exception("deadline handling failed for %s", row["task_id"])
        d.ai_tasks.update_many({"debate.owner": self.me, "debate.stage": {"$in": list(ACTIVE_STAGES)}}, {"$set": {"debate.lease_until": now + LEASE_S}})

    def run_sweeper(self, stop: threading.Event, every_seconds: float = 0.2) -> None:
        while not stop.is_set():
            try:
                self.sweep_once()
            except Exception:  # noqa: BLE001
                log.exception("sweeper failed")
            stop.wait(every_seconds)


chair = Chair()
