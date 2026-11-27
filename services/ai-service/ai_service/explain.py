"""Plain-language text for the result (spec 7.1 Explanation Skill, 13.6 "separate measured
evidence from generated explanation").

The chair builds `evidence` and `risks` from records (code). This module only turns the measured
`facts` into sentences. The Explanation agent uses it as the template, or asks a model to write the
rationale from the same facts; the chair uses it as the fallback when the agent is late or invalid.
"""
from __future__ import annotations

from typing import Any

from .scoring import fmt


def template_rationale(facts: dict[str, Any]) -> str:
    if facts.get("nothing_matched"):
        where = f" in {facts['location']}" if facts.get("location") else ""
        return f"No listings matched where you want to stay{where}, so there is nothing to recommend yet."
    w = facts["winner"]
    text = (
        f"{w['title']} in {w['city']} meets {w['passed']} of {w['total']} of your requirements "
        f"for ${fmt(w['nightly_price'])}/night, rated {fmt(w['rating'])} from {w['review_count']} reviews, "
        f"and its host replies to {w['host_response_rate']}% of messages."
    )
    runner = facts.get("runner_up")
    if runner:
        because = f" because that {runner['first_flag']}" if runner.get("first_flag") else ""
        text += f" It was chosen over {runner['title']} (${fmt(runner['nightly_price'])}/night){because}."
    return text


def dissent_note(dissent: list[dict[str, Any]], missing: list[dict[str, Any]], titles: dict[str, str]) -> str | None:
    """Who disagreed and why, plus every agent that is missing. Never hidden (contract 6.4 rule 4)."""
    parts = [f"{d['agent']} preferred {titles.get(d['preferred_property_id'], d['preferred_property_id'])}: {d['reason']}" for d in dissent]
    for m in missing:
        if m["round"] == 2 and m.get("half_vote"):
            parts.append(f"{m['agent']} did not answer in round {m['round']}; its round 0 position was used at half weight.")
        else:
            parts.append(f"{m['agent']} is missing from round {m['round']}: {m['reason']}")
    return " ".join(parts) if parts else None


SYSTEM_PROMPT = (
    "You write the explanation for a vacation-rental recommendation. Use ONLY the facts given in JSON. "
    "Do not invent numbers, amenities or reviews. Write 2 or 3 plain sentences for a guest, "
    "name the recommended listing exactly as written, and say why it was chosen over the runner-up if there is one. "
    'Reply with JSON only: {"rationale": "..."}'
)
