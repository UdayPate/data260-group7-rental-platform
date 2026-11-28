"""Recompute a debate's decision from its stored events (spec 13.5 "final resolution must be reproducible").

    python -m ai_service.recompute task_001

Reads ONLY ai_events (round 0 picks, votes, timeouts) and applies the written decision rule again:
votes count 1, a timed-out agent's round 0 pick counts 0.5, ties go to fewer risk flags then the
lower price (those two facts come from the listing data). The answer must equal the stored result.
"""
from __future__ import annotations

import json
import sys
from collections import defaultdict
from typing import Any

from . import listings, scoring, store

ANALYSIS = ("matcher", "risk", "fairness")


def recompute_result(task_id: str) -> dict[str, Any]:
    events = store.all_events(task_id)
    picks: dict[str, str] = {}
    votes: list[tuple[str, str, float]] = []
    missing: list[dict[str, Any]] = []
    for e in events:
        p = e["payload"]
        if e["event_type"] == "opinion.published":
            picks[e["actor_id"]] = p["ranked"][0]["property_id"]
        elif e["event_type"] == "vote.cast" and p["vote"] != "abstain":
            votes.append((e["actor_id"], p["property_id"], 1.0))
        elif e["event_type"] == "agent.timed_out" and p["agent"] in ANALYSIS:
            missing.append({"agent": p["agent"], "round": p["round"]})
            if p["round"] == 2 and p["agent"] in picks:
                votes.append((p["agent"], picks[p["agent"]], 0.5))
        elif e["event_type"] == "agent.output_rejected" and p["action"] == "dropped" and p["agent"] in ANALYSIS:
            missing.append({"agent": p["agent"], "round": p["round"]})
    if not votes and "matcher" in picks:
        votes.append(("matcher", picks["matcher"], 1.0))  # single-agent mode
    snap = listings.load_snapshot()
    tally: dict[str, float] = defaultdict(float)
    for _agent, pid, weight in votes:
        tally[pid] += weight
    ordered = sorted(tally.items(), key=lambda kv: (-kv[1], len(scoring.risk_flags(snap, snap.property(kv[0]))), snap.property(kv[0])["nightly_price"]))
    winner = ordered[0][0] if ordered else None
    full = [v for v in votes if v[2] == 1.0]
    return {
        "winner": winner,
        "tally": dict(tally),
        "dissent": sorted(agent for agent, pid, _w in full if pid != winner),
        "missing": sorted(m["agent"] for m in missing),
        "consensus": bool(winner) and not missing and len([v for v in full if v[1] == winner]) >= 2 and len(votes) > 1,
    }


def matches_stored(task_id: str) -> tuple[bool, dict[str, Any], dict[str, Any]]:
    """(equal?, recomputed, stored) — the stored side reduced to the same fields."""
    again = recompute_result(task_id)
    result = store.get_result(task_id) or {}
    stored = {
        "winner": (result.get("recommended") or {}).get("property_id"),
        "dissent": sorted(d["agent"] for d in result.get("dissent", [])),
        "missing": sorted(m["agent"] for m in result.get("missing_agents", [])),
        "consensus": result.get("consensus"),
    }
    same = all(again[k] == stored[k] for k in stored)
    # The availability re-check (plan step 6) may move the win to the next free listing: then the stored winner differs on purpose.
    if not same and result.get("decision_rule", "") and "booked during the debate" in (result.get("decision_rule") or ""):
        same = True
    return same, again, stored


if __name__ == "__main__":
    from xenia_shared.config import load_env

    load_env()
    ok, again, stored = matches_stored(sys.argv[1])
    print(json.dumps({"reproducible": ok, "recomputed": again, "stored": stored}, indent=2))
    sys.exit(0 if ok else 1)
