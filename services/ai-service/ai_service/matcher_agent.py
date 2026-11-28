"""Matching agent (spec 7.1): ranks the candidates with the weighted score of contract 6.7.

    python -m ai_service.workers matcher        (consumer group agent-matcher)

The weights come in the chair's instruction: the active matcher version's, or the guest's own on
a rerun. The score is the deterministic formula in scoring.py, so the same request with the same
weights always gives the same ranking.

Demo switch `invalid_agent_output` (spec 7.5.5): the FIRST round-0 output is deliberately broken
(property p_999, score 1.7), so the harness rejects it and asks again; the retry is the real one.
"""
from __future__ import annotations

from typing import Any

from . import agent_base as base
from . import scoring

AGENT = "matcher"


def handle(envelope: dict[str, Any], _conn: Any = None) -> None:
    if base.is_round0_instruction(envelope, AGENT):
        round0(envelope)
    elif base.is_round2_instruction(envelope, AGENT):
        round2(envelope)


def round0(envelope: dict[str, Any]) -> None:
    ctx = base.context_of(envelope)
    attempt = ctx.get("attempt", 0)
    snap, pool, req = base.load(envelope)
    ranked = scoring.rank_matcher(snap, pool, req, ctx["weights"])

    def risk_check(order: list[dict[str, Any]]) -> dict[str, str]:
        flags = scoring.risk_flags(snap, order[0]["p"])
        return base.check(not flags, f"Not scored by the Matcher: {'; '.join(flags)}." if flags else "None found.")

    first_top = ranked[0]["p"]["property_id"]
    ranked, reflections = base.reflect(AGENT, snap, req, ranked, "Price, amenities and rating come from the property record.", risk_check)
    top = ranked[0]
    payload: dict[str, Any] = {
        "round": 0,
        "ranked": [scoring.to_ranked(s) for s in ranked[:5]],
        "confidence": scoring.confidence_of(ranked),
        "reasoning": (
            f"{top['p']['title']} has the highest score under the Matcher’s weights ({scoring.fmt(scoring.round2(top['score']))}): "
            f"it meets {len(scoring.fit_of(snap, top['p'], req)['passed'])} requirement(s) at ${scoring.fmt(top['p']['nightly_price'])}/night."
        ),
        "reflections": reflections,
        # The Matcher's own top 10 with the measured parts: the chair copies it into result.matcher_ranking.
        "matcher_ranking": [scoring.to_rank_entry(s, i) for i, s in enumerate(ranked[:10])],
    }
    if ctx.get("demo", {}).get("invalid_agent_output") and attempt == 0:
        # Deliberately invalid for the demo: an id that is not a candidate, and a score above 1.
        payload["ranked"][0] = {**payload["ranked"][0], "property_id": "p_999", "score": 1.7}
    base.publish_opinion(envelope, AGENT, payload, attempt, first_top != top["p"]["property_id"])


def round2(envelope: dict[str, Any]) -> None:
    ctx = base.context_of(envelope)
    snap, _pool, _req = base.load(envelope)
    picks = ctx["picks"]
    mine = snap.property(picks[AGENT])
    answers = []
    for c in ctx["challenges"]:
        if c["to_agent"] != AGENT:
            continue
        other_id = picks.get("risk")
        other = snap.property(other_id) if other_id else None
        if other and other["property_id"] != mine["property_id"]:
            gap = other["nightly_price"] - mine["nightly_price"]
            text = (
                f"{mine['title']} meets every requirement and is ${scoring.fmt(gap)} cheaper per night than {other['title']}. "
                "I note the host history, but fit and price still rank it first."
            )
            evidence = [f"nightly_price {mine['property_id']}: ${scoring.fmt(mine['nightly_price'])}", f"nightly_price {other['property_id']}: ${scoring.fmt(other['nightly_price'])}"]
        else:
            text, evidence = f"{mine['title']} has the highest weighted score among listings that meet every must-have.", [f"property {mine['property_id']}"]
        answers.append({"round": 2, "challenge_id": c["challenge_id"], "answer": text, "evidence": evidence})
    vote = {
        "round": 2,
        "vote": "keep",
        "property_id": mine["property_id"],
        "reason": "Highest score under the Matcher’s weights among listings that meet every must-have." + base.cites(ctx, [a["challenge_id"] for a in answers]),
    }
    base.publish_round2(envelope, AGENT, answers, vote)
