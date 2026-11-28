"""Fairness and Bias Auditor (spec 7.1): ranks on fit, price and rating only, so a newer listing with
few reviews is not pushed down by popularity.

    python -m ai_service.workers fairness       (consumer group agent-fairness)

In round 2 it is ALWAYS challenged (spec 7.2) and answers with a measured check: it reruns the
Matcher's formula with review_count = 0 and reports which listings move. That finding is what
matcher-v2 is based on (spec 7.5.4).
"""
from __future__ import annotations

from typing import Any

from . import agent_base as base
from . import scoring

AGENT = "fairness"


def handle(envelope: dict[str, Any], _conn: Any = None) -> None:
    if base.is_round0_instruction(envelope, AGENT):
        round0(envelope)
    elif base.is_round2_instruction(envelope, AGENT):
        round2(envelope)


def round0(envelope: dict[str, Any]) -> None:
    ctx = base.context_of(envelope)
    snap, pool, req = base.load(envelope)
    ranked = scoring.rank_by([scoring.fairness_score(snap, p, req) for p in pool])

    def risk_check(order: list[dict[str, Any]]) -> dict[str, str]:
        return base.check(True, "Popularity signals (review count, host fame) are left out on purpose; host risk is the Risk agent’s job.")

    first_top = ranked[0]["p"]["property_id"]
    ranked, reflections = base.reflect(AGENT, snap, req, ranked, "Fit, price and rating come from the property record.", risk_check)
    payload = {
        "round": 0,
        "ranked": [scoring.to_ranked(s) for s in ranked[:5]],
        "confidence": scoring.confidence_of(ranked),
        "reasoning": "Ranked on fit, price and rating only, without review counts or host popularity, so newer listings are not pushed down.",
        "reflections": reflections,
    }
    base.publish_opinion(envelope, AGENT, payload, ctx.get("attempt", 0), first_top != ranked[0]["p"]["property_id"])


def popularity_finding(snap, pool, req, weights) -> tuple[str, list[str], bool]:
    """Rerun the Matcher's formula without the review-count term and report who moves up."""
    matcher = scoring.rank_matcher(snap, pool, req, weights)
    without = scoring.rank_matcher(snap, pool, req, {**weights, "review_count": 0})
    order = [m["p"]["property_id"] for m in matcher]
    moved = [
        (s, order.index(s["p"]["property_id"]), i)
        for i, s in enumerate(without[:5])
        if i < order.index(s["p"]["property_id"])
    ]
    if not moved:
        return "Review count does not change the Matcher’s order for these listings.", ["no rank changes"], False
    same_top = without[0]["p"]["property_id"] == matcher[0]["p"]["property_id"]
    text = (
        "The Matcher’s score includes review count. Without it, "
        + "; ".join(f"{s['p']['title']} moves from #{before + 1} to #{after + 1}" for s, before, after in moved)
        + f". The top pick {'does not change' if same_top else 'changes'}, but the review-count term should be removed (proposal: matcher-v2)."
    )
    return text, [f"{s['p']['property_id']}: rank {before + 1} → {after + 1} without review count" for s, before, after in moved], True


def round2(envelope: dict[str, Any]) -> None:
    ctx = base.context_of(envelope)
    snap, pool, req = base.load(envelope)
    picks = ctx["picks"]
    mine = snap.property(picks[AGENT])
    matcher_pick = snap.property(picks["matcher"]) if picks.get("matcher") else None
    risk_pick = snap.property(picks["risk"]) if picks.get("risk") else None
    matcher_flags = scoring.risk_flags(snap, matcher_pick) if matcher_pick else []

    answers = []
    for c in ctx["challenges"]:
        if c["to_agent"] != AGENT:
            continue
        text, evidence, _moved = popularity_finding(snap, pool, req, ctx["weights"])
        if matcher_flags:
            text += (
                f" The cancellation penalty on {matcher_pick['title']} rests on documented host-caused cancellations, "
                "so it is a legitimate safety signal, not a popularity bias."
            )
        answers.append({"round": 2, "challenge_id": c["challenge_id"], "answer": text, "evidence": evidence})

    cited = base.cites(ctx, [a["challenge_id"] for a in answers])
    my_flags = scoring.risk_flags(snap, mine)
    if my_flags and risk_pick and risk_pick["property_id"] != mine["property_id"]:
        vote = {"round": 2, "vote": "switch", "property_id": risk_pick["property_id"],
                "reason": f"The penalty is justified by the reservation records; {risk_pick['title']} meets the requirements without that risk." + cited}
    else:
        vote = {"round": 2, "vote": "keep", "property_id": mine["property_id"],
                "reason": f"{mine['title']} ranks first on fit, price and rating, with no unfair signal involved." + cited}
    base.publish_round2(envelope, AGENT, answers, vote)
