"""Explanation skill (spec 7.1), plan step 7: turns the chair's measured facts into plain language.

    python -m ai_service.workers explanation    (consumer group agent-explanation)

Instruction: plan.step_updated (s7, in_progress) from the chair on ai.results, with `facts` and the
dissent / missing agents in the context.
Answer:      result.published on ai.results with ONLY { rationale, dissent_note }.

It never sees or changes `evidence`, `risks`, scores or the winner: the chair keeps those and takes
only the two text fields back (spec 13.6 "separate measured evidence from generated explanation").
A model writes the rationale when one is available; otherwise (or if its answer fails the check)
the template in explain.py does.
"""
from __future__ import annotations

import json
from typing import Any

from . import explain, llm, protocol
from .harness import check_explanation

AGENT = "explanation"


def handle(envelope: dict[str, Any], _conn: Any = None) -> None:
    p = envelope["payload"]
    if envelope["event_type"] != "plan.step_updated" or envelope["actor_id"] != "chair" or p.get("step_id") != "s7" or p.get("status") != "in_progress":
        return
    ctx = p["context"]
    task_id, trace_id = protocol.task_of(envelope), envelope["trace_id"]
    facts = ctx["facts"]
    rationale = explain.template_rationale(facts)
    if not facts.get("nothing_matched") and llm.model_available():
        reply = llm.extract_json(llm.complete(trace_id, "explain", "small", explain.SYSTEM_PROMPT, json.dumps(facts)))
        title = facts["winner"]["title"]
        checked, _reason, _fields = check_explanation({"result": {"rationale": (reply or {}).get("rationale"), "dissent_note": None}}, title)
        if checked:
            rationale = checked["rationale"]
    note = explain.dissent_note(ctx.get("dissent", []), ctx.get("missing", []), ctx.get("titles", {}))
    protocol.send("ai.results", "result.published", task_id, trace_id, AGENT, {"result": {"rationale": rationale, "dissent_note": note}}, key_suffix="s7")
