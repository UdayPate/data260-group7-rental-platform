"""Review and Risk agent (spec 7.1): fit plus host trust, minus host-caused cancellations.

    python -m ai_service.workers risk           (consumer group agent-risk)

Every warning sign it raises comes from a record: host cancellations from the reservations table,
response rate and verification from the host row (risk_flags in scoring.py).

Demo switch `delay_risk_agent` (spec 13.10): in round 2 the agent answers only AFTER the round's
deadline. It does not block (a timer thread sends the late answer), so the other debates running
at the same time are not slowed down. The chair has already closed the round by then, records
`agent.timed_out`, and ignores the late message.
"""
from __future__ import annotations

import logging
import threading
from typing import Any

from . import agent_base as base
from . import scoring

AGENT = "risk"
log = logging.getLogger("xenia.ai.risk")
LATE_BY_SECONDS = 2.0


def handle(envelope: dict[str, Any], _conn: Any = None) -> None:
    if base.is_round0_instruction(envelope, AGENT):
        round0(envelope)
    elif base.is_round2_instruction(envelope, AGENT):
        ctx = base.context_of(envelope)
        if ctx.get("demo", {}).get("delay_risk_agent"):
            delay = ctx.get("deadline_ms", 8000) / 1000 + LATE_BY_SECONDS
            log.info("demo delay_risk_agent: answering task %s %.1fs late", envelope["entity"]["entity_id"], delay)
            threading.Timer(delay, round2, args=(envelope,)).start()
        else:
            round2(envelope)


def round0(envelope: dict[str, Any]) -> None:
    ctx = base.context_of(envelope)
    snap, pool, req = base.load(envelope)
    ranked = scoring.rank_by([scoring.risk_score(snap, p, req) for p in pool])

    def risky_alternatives(order: list[dict[str, Any]]) -> list[tuple[dict[str, Any], list[str]]]:
        """Listings that meet the must-haves and are cheaper than our #1, but have warning signs (strongest rival first)."""
        top = order[0]["p"]
        out = []
        for s in order[1:]:
            p = s["p"]
            if p["nightly_price"] < top["nightly_price"] and not base.must_have_misses(snap, p, req):
                flags = scoring.risk_flags(snap, p)
                if flags:
                    out.append((p, flags))
        # The strongest rival first: best fit and price as the guest would see them (no host signals).
        return sorted(out, key=lambda pf: (-scoring.fairness_score(snap, pf[0], req)["score"], pf[0]["nightly_price"]))

    def risk_check(order: list[dict[str, Any]]) -> dict[str, str]:
        top_flags = scoring.risk_flags(snap, order[0]["p"])
        if top_flags:
            return base.check(False, f"{order[0]['p']['title']}: {'; '.join(top_flags)}.")
        others = risky_alternatives(order)
        if others:
            p, flags = others[0]
            return base.check(False, f"Cheaper option {p['title']}: {'; '.join(flags)}.")
        return base.check(True, "No warning signs on the top candidates.")

    first_top = ranked[0]["p"]["property_id"]
    ranked, reflections = base.reflect(
        AGENT, snap, req, ranked, "Cancellation counts come from reservation records; response rates from host profiles.", risk_check
    )
    top = ranked[0]["p"]
    cheaper = risky_alternatives(ranked)
    if cheaper:
        p, flags = cheaper[0]
        reasoning = f"{p['title']} is cheaper, but its {flags[0]}. {top['title']} has a reliable host and no cancellations."
    else:
        reasoning = f"{top['title']} has the most reliable host among listings that fit."
    payload = {
        "round": 0,
        "ranked": [scoring.to_ranked(s) for s in ranked[:5]],
        "confidence": scoring.confidence_of(ranked),
        "reasoning": reasoning,
        "reflections": reflections,
    }
    base.publish_opinion(envelope, AGENT, payload, ctx.get("attempt", 0), first_top != top["property_id"])


def round2(envelope: dict[str, Any]) -> None:
    ctx = base.context_of(envelope)
    snap, _pool, _req = base.load(envelope)
    picks = ctx["picks"]
    mine = snap.property(picks[AGENT])
    answers = []
    for c in ctx["challenges"]:
        if c["to_agent"] != AGENT:
            continue
        host = snap.hosts.get(mine["host_id"], {})
        other = snap.property(picks["matcher"]) if picks.get("matcher") else None
        other_flags = scoring.risk_flags(snap, other) if other else []
        text = f"{mine['title']}: host replies to {host.get('response_rate')}% of messages and has no cancellations."
        if other and other_flags:
            text += f" {other['title']}: {'; '.join(other_flags)}."
        evidence = [f"{r['reservation_id']}: {r['cancellation_reason']}" for r in (scoring.host_cancellations(snap, other["host_id"]) if other else [])]
        answers.append({"round": 2, "challenge_id": c["challenge_id"], "answer": text, "evidence": evidence or [f"host {mine['host_id']}"]})
    vote = {
        "round": 2,
        "vote": "keep",
        "property_id": mine["property_id"],
        "reason": "Safety and reliability outweigh a small price difference." + base.cites(ctx, [a["challenge_id"] for a in answers]),
    }
    base.publish_round2(envelope, AGENT, answers, vote)
