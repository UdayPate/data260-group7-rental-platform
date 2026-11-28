"""What the three analysis agents (Matcher, Risk, Fairness Auditor) have in common.

Each agent is a stateless Kafka consumer (its own process and consumer group). For every message it
reads the task id and trace_id FROM THE MESSAGE and answers with the same ones: there is no
"current task" anywhere, which is what keeps three simultaneous debates apart (spec 13.11).

Round 0 (instruction: round.started round 0 on ai.requests): rank the candidates from the database
alone, run the reflection checks, publish ONE opinion to debate.round.0. The agents never read
debate.round.0, so they cannot see each other's answers (spec 7.2).

Round 2 (instruction: round.started round 2 on debate.round.1, which carries every round-0 opinion
and the chair's challenges): answer the challenges addressed to this agent, then cast one vote
with a reason, citing the stored messages (spec 7.2).

Reflection (spec 7.5.3): at most two cycles. Cycle 1 checks the constraint, evidence, risk,
conflict and action rules. If the constraint check fails (the top pick misses a must-have while
another candidate meets them all), the agent revises its order once and records cycle 2.
"""
from __future__ import annotations

import logging
from typing import Any, Callable

from xenia_shared.trace import emit_step

from . import protocol, scoring
from .listings import Snapshot, load_snapshot

log = logging.getLogger("xenia.ai.agents")

NO_ACTION = "No external action: booking needs the guest’s approval, and this agent has read-only data access."


def is_round0_instruction(envelope: dict[str, Any], agent: str) -> bool:
    p = envelope["payload"]
    if envelope["event_type"] != "round.started" or p.get("round") != 0 or envelope["actor_id"] != "chair":
        return False
    retry = p.get("context", {}).get("retry_agent")
    return agent in p.get("waiting_for", []) and (retry is None or retry == agent)


def is_round2_instruction(envelope: dict[str, Any], agent: str) -> bool:
    p = envelope["payload"]
    if envelope["event_type"] != "round.started" or p.get("round") != 2 or envelope["actor_id"] != "chair":
        return False
    retry = p.get("context", {}).get("retry_agent")
    return agent in p.get("waiting_for", []) and (retry is None or retry == agent)


def pool_from(snap: Snapshot, candidate_ids: list[str]) -> list[dict[str, Any]]:
    return [p for pid in candidate_ids if (p := snap.property(pid)) is not None]


def check(ok: bool, note: str) -> dict[str, str]:
    return {"result": "pass" if ok else "concern", "note": note}


def must_have_misses(snap: Snapshot, p: dict[str, Any], req: dict[str, Any]) -> list[str]:
    return [label for label in scoring.fit_of(snap, p, req)["failed"] if not label.startswith("has ")]


def reflect(
    agent: str,
    snap: Snapshot,
    req: dict[str, Any],
    ranked: list[dict[str, Any]],
    evidence_note: str,
    risk_check: Callable[[list[dict[str, Any]]], dict[str, str]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Run the reflection cycles. Returns (final ranked list, reflection records)."""
    records: list[dict[str, Any]] = []
    for cycle in (1, 2):
        top = ranked[0]["p"]
        misses = must_have_misses(snap, top, req)
        better_exists = any(not must_have_misses(snap, s["p"], req) for s in ranked[1:])
        constraint = check(
            not misses,
            f"{top['title']} meets {len(scoring.fit_of(snap, top, req)['passed'])} requirement(s)."
            if not misses else f"{top['title']} misses a must-have: {', '.join(misses)}.",
        )
        needs_revision = bool(misses) and better_exists and cycle == 1
        records.append({
            "round": 0,
            "cycle": cycle,
            "checks": {
                "constraint": constraint,
                "evidence": check(True, evidence_note),
                "risk": risk_check(ranked),
                "conflict": check(True, "No other agent’s output read (round 0 is independent)."),
                "action": check(True, NO_ACTION),
            },
            "decision": "revise" if needs_revision else "keep",
        })
        if not needs_revision:
            break
        # The one allowed revision: listings that meet every must-have move to the front (order kept).
        ranked = [s for s in ranked if not must_have_misses(snap, s["p"], req)] + [s for s in ranked if must_have_misses(snap, s["p"], req)]
    return ranked, records


def publish_opinion(envelope: dict[str, Any], agent: str, payload: dict[str, Any], attempt: int, changed_by_reflection: bool) -> None:
    task_id, trace_id = protocol.task_of(envelope), envelope["trace_id"]
    protocol.send("debate.round.0", "opinion.published", task_id, trace_id, agent, payload, key_suffix=f"r0:{attempt}")
    # The report must measure whether reflection helps (spec 7.5.3): log whether it changed the #1.
    emit_step(trace_id, "opinion.published", f"agent-{agent}", 0, "ok", None, {"reflection_changed_top_pick": changed_by_reflection, "attempt": attempt})


def publish_round2(envelope: dict[str, Any], agent: str, answers: list[dict[str, Any]], vote: dict[str, Any]) -> None:
    task_id, trace_id = protocol.task_of(envelope), envelope["trace_id"]
    attempt = envelope["payload"].get("context", {}).get("attempt", 0)
    for answer in answers:
        protocol.send("debate.round.2", "challenge.answered", task_id, trace_id, agent, answer, key_suffix=f"{answer['challenge_id']}:{attempt}")
    protocol.send("debate.round.2", "vote.cast", task_id, trace_id, agent, vote, key_suffix=f"r2:{attempt}")


def context_of(envelope: dict[str, Any]) -> dict[str, Any]:
    return envelope["payload"].get("context", {})


def load(envelope: dict[str, Any]) -> tuple[Snapshot, list[dict[str, Any]], dict[str, Any]]:
    ctx = context_of(envelope)
    snap = load_snapshot()
    return snap, pool_from(snap, ctx["candidate_ids"]), ctx["requirements"]


def cites(ctx: dict[str, Any], challenge_ids: list[str]) -> str:
    """A short pointer to the stored messages a vote is based on (spec 7.2: votes cite stored messages)."""
    picks = ", ".join(f"{a}→{pid}" for a, pid in ctx.get("picks", {}).items())
    used = f"; challenge {', '.join(challenge_ids)}" if challenge_ids else ""
    return f" [based on round 0 opinions ({picks}){used}]"
