"""Guest Request Parser (spec 7.1), plan step 1.

    python -m ai_service.workers parser         (consumer group agent-parser)

Instruction: plan.step_updated (s1, in_progress) from the chair on ai.requests.
Answer:      requirements.parsed on ai.requests, with the requirements and the candidate ids.

1. The rule-based parser always runs (scoring.parse_request).
2. If a model is available, the router picks small or frontier (llm.route), the semantic cache is
   asked first, and the model's JSON may FILL fields the rules left empty. Every field is checked
   on its own (type, allowed values, real dates in the future); a bad field is simply ignored.
"""
from __future__ import annotations

import json
import logging
import time
from typing import Any

from xenia_shared.timeutil import today_utc

from . import llm, protocol, scoring
from .harness import Requirements
from .listings import load_snapshot

log = logging.getLogger("xenia.ai.parser")
AGENT = "parser"

PROMPT = (
    "Extract the stay requirements from a guest's request. Reply with JSON only, with these keys "
    "(null when the request does not say): location (city name), check_in and check_out (YYYY-MM-DD; "
    "today is {today}), guest_count (integer), max_nightly_price (US dollars per night), min_rating (0-5), "
    "amenities (subset of {amenities}), property_types (subset of {types}).\n\nRequest: {text}"
)


def handle(envelope: dict[str, Any], _conn: Any = None) -> None:
    p = envelope["payload"]
    if envelope["event_type"] != "plan.step_updated" or envelope["actor_id"] != "chair" or p.get("step_id") != "s1" or p.get("status") != "in_progress":
        return
    ctx = p.get("context", {})
    task_id, trace_id = protocol.task_of(envelope), envelope["trace_id"]
    snap = load_snapshot()
    requirements = parse(trace_id, ctx["request_text"], snap.cities())
    pool = scoring.candidate_pool(snap, requirements)
    protocol.send(
        "ai.requests", "requirements.parsed", task_id, trace_id, AGENT,
        {"requirements": requirements, "candidate_ids": [x["property_id"] for x in pool]},
        key_suffix=f"s1:{ctx.get('attempt', 0)}",
    )


def _rules_found(req: dict[str, Any]) -> int:
    return sum([
        req["location"] is not None, req["guest_count"] is not None, req["max_nightly_price"] is not None,
        req["min_rating"] is not None, bool(req["amenities"]), not req["dates_assumed"],
    ])


def _guard(req: dict[str, Any]) -> dict[str, Any]:
    """What must be identical for a cache hit: the numbers the rules read from THIS text."""
    nights = scoring.nights_between(req["check_in"], req["check_out"]) if req["check_in"] and req["check_out"] else None
    return {
        "nights": nights, "guest_count": req["guest_count"], "max_nightly_price": req["max_nightly_price"],
        "min_rating": req["min_rating"], "dates": [req["check_in"], req["check_out"]] if not req["dates_assumed"] else None,
    }


def model_fields(raw: Any) -> dict[str, Any]:
    """Keep only the model's fields that pass the same checks as the contract's ParsedRequirements."""
    if not isinstance(raw, dict):
        return {}
    probe = {"location": None, "check_in": None, "check_out": None, "dates_assumed": True, "guest_count": None,
             "max_nightly_price": None, "min_rating": None, "amenities": [], "property_types": []}
    kept: dict[str, Any] = {}
    # Lists: keep only the allowed values ("castle" is not a property type), item by item.
    for key, allowed in (("amenities", scoring.AMENITIES), ("property_types", scoring.PROPERTY_TYPES)):
        if isinstance(raw.get(key), list):
            raw = {**raw, key: [v for v in raw[key] if v in allowed]}
    for key in ("location", "guest_count", "max_nightly_price", "min_rating", "amenities", "property_types"):
        if raw.get(key) in (None, []):
            continue
        try:
            Requirements.model_validate({**probe, key: raw[key]})
            kept[key] = raw[key]
        except Exception:  # noqa: BLE001
            log.info("ignored model field %s=%r", key, raw.get(key))
    check_in, check_out = raw.get("check_in"), raw.get("check_out")
    try:
        if isinstance(check_in, str) and isinstance(check_out, str):
            if today_utc().isoformat() <= check_in < check_out and scoring.nights_between(check_in, check_out) <= 30:
                kept["check_in"], kept["check_out"] = check_in, check_out
    except ValueError:
        pass
    return kept


def parse(trace_id: str, text: str, cities: list[str]) -> dict[str, Any]:
    req = scoring.parse_request(text, cities)
    if not llm.model_available():
        llm.log_call(trace_id, "parse", "rules-only", "rules-only (no ANTHROPIC_API_KEY)", time.monotonic())
        return req
    tier = llm.route(text, _rules_found(req))
    guard = _guard(req)
    fields = llm.cache_lookup(trace_id, text, guard)
    if fields is not None:
        llm.log_call(trace_id, "parse", tier, llm.model_name(tier), time.monotonic(), cached=True)
    else:
        prompt = PROMPT.format(today=today_utc().isoformat(), amenities=json.dumps(scoring.AMENITIES), types=json.dumps(scoring.PROPERTY_TYPES), text=text)
        fields = model_fields(llm.extract_json(llm.complete(trace_id, "parse", tier, "You turn travel requests into JSON.", prompt)))
        llm.cache_store(text, guard, fields)
    # The model only fills gaps: anything the rules read stays as the rules read it.
    for key, value in fields.items():
        if key in ("check_in", "check_out"):
            continue
        if req.get(key) in (None, []):
            req[key] = value
    if req["dates_assumed"] and "check_in" in fields:
        req["check_in"], req["check_out"], req["dates_assumed"] = fields["check_in"], fields["check_out"], False
    if isinstance(req.get("location"), str) and req["location"] not in cities:
        match = next((c for c in cities if c.lower() == req["location"].lower()), None)
        req["location"] = match or req["location"]
    return req
