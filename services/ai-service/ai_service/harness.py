"""The harness's output checks (spec 7.5.1 "input/output checks", contract 6.4 rule 5).

Every message an agent sends is checked here BEFORE the chair uses it. A message is rejected when:
    - a field is missing or has the wrong type
    - a score or confidence is outside 0-1
    - a property_id is not in this debate's candidate pool (e.g. a model inventing "p_999")
    - its trace_id is not the task's trace_id
Rejected -> `agent.output_rejected` on the stream, the bad message to `dead.letter`, one retry, then dropped.

Each check returns (clean_payload, None, []) or (None, reason, invalid_fields).
"""
from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, StrictFloat, StrictInt, StrictStr, ValidationError

from .scoring import AMENITIES, PROPERTY_TYPES

Score = Field(ge=0, le=1)


class _Strict(BaseModel):
    model_config = ConfigDict(extra="ignore")


class RankedItem(_Strict):
    property_id: StrictStr
    title: StrictStr
    score: StrictFloat | StrictInt = Score
    reasons: list[StrictStr]


class Check(_Strict):
    result: Literal["pass", "concern"]
    note: StrictStr


class Checks(_Strict):
    constraint: Check
    evidence: Check
    risk: Check
    conflict: Check
    action: Check


class Reflection(_Strict):
    round: Literal[0, 1, 2]
    cycle: Literal[1, 2]  # at most two cycles (spec 7.5.3 "limited to a fixed number of cycles")
    checks: Checks
    decision: Literal["keep", "revise", "reject"]


class Parts(_Strict):
    amenity_fit: StrictFloat | StrictInt = Score
    price: StrictFloat | StrictInt = Score
    rating: StrictFloat | StrictInt = Score
    risk_penalty: StrictFloat | StrictInt = Score
    review_count: StrictFloat | StrictInt = Score


class MatcherRankEntry(_Strict):
    rank: StrictInt = Field(ge=1)
    property_id: StrictStr
    title: StrictStr
    score: StrictFloat | StrictInt = Score
    meets_must_haves: bool
    parts: Parts


class Opinion(_Strict):
    round: Literal[0]
    ranked: list[RankedItem] = Field(min_length=1, max_length=10)
    confidence: StrictFloat | StrictInt = Score
    reasoning: StrictStr = Field(min_length=1)
    reflections: list[Reflection] = Field(default_factory=list, max_length=2)
    matcher_ranking: Optional[list[MatcherRankEntry]] = None  # only the Matcher sends it


class Requirements(_Strict):
    location: Optional[StrictStr]
    check_in: Optional[StrictStr]
    check_out: Optional[StrictStr]
    dates_assumed: bool
    guest_count: Optional[StrictInt] = Field(ge=1, le=50)
    max_nightly_price: Optional[StrictFloat | StrictInt] = Field(gt=0)
    min_rating: Optional[StrictFloat | StrictInt] = Field(ge=0, le=5)
    amenities: list[Literal[AMENITIES]]  # type: ignore[valid-type]
    property_types: list[Literal[PROPERTY_TYPES]]  # type: ignore[valid-type]


class Parsed(_Strict):
    requirements: Requirements
    candidate_ids: list[StrictStr]


class Answer(_Strict):
    round: Literal[2]
    challenge_id: StrictStr
    answer: StrictStr = Field(min_length=1)
    evidence: list[StrictStr]


class VoteOut(_Strict):
    round: Literal[2]
    vote: Literal["keep", "switch", "abstain"]
    property_id: Optional[StrictStr]
    reason: StrictStr = Field(min_length=1)  # every vote has a reason (contract 6.4 rule 4)


class ExplanationText(_Strict):
    rationale: StrictStr = Field(min_length=20, max_length=1500)
    dissent_note: Optional[StrictStr]


class Explanation(_Strict):
    result: ExplanationText


def _path(loc: tuple[Any, ...]) -> str:
    """('ranked', 0, 'score') -> 'ranked[0].score' (the way the UI and the contract write it)."""
    out = ""
    for part in loc:
        if isinstance(part, str) and (part in ("float", "int", "str", "bool") or "[" in part):
            continue  # pydantic names the member of a union ("score.float"); the field name is enough
        out += f"[{part}]" if isinstance(part, int) else (f".{part}" if out else str(part))
    return out


def _validate(model: type[BaseModel], payload: Any) -> tuple[BaseModel | None, list[str], list[str]]:
    try:
        return model.model_validate(payload), [], []
    except ValidationError as problem:
        fields, reasons = [], []
        for item in problem.errors():
            name = _path(tuple(item["loc"])) or "payload"
            if name not in fields:
                fields.append(name)
            value = item.get("input")
            if item["type"] == "missing":
                reasons.append(f"{name} is missing")
            elif item["type"] in ("less_than_equal", "greater_than_equal", "greater_than") and name.endswith(("score", "confidence")):
                reasons.append(f"{name} {value} is outside 0–1")
            else:
                reasons.append(f"{name}: {item['msg']}")
        return None, reasons, fields


def check_trace(envelope: dict[str, Any], task: dict[str, Any]) -> str | None:
    if envelope["trace_id"] != task["trace_id"]:
        return f"trace_id {envelope['trace_id']} is not this task's trace_id"
    return None


def check_opinion(payload: Any, pool_ids: set[str]) -> tuple[dict[str, Any] | None, str | None, list[str]]:
    model, reasons, fields = _validate(Opinion, payload)
    ranked = payload.get("ranked") if isinstance(payload, dict) else None
    # Unknown property ids: checked even when the shape is wrong, so the reason names every problem.
    for i, item in enumerate(ranked if isinstance(ranked, list) else []):
        pid = item.get("property_id") if isinstance(item, dict) else None
        if isinstance(pid, str) and pid not in pool_ids:
            reasons.insert(0, f"property {pid} is not in the candidate pool")
            fields.insert(0, f"ranked[{i}].property_id")
    entries = payload.get("matcher_ranking") if isinstance(payload, dict) else None
    for i, item in enumerate(entries if isinstance(entries, list) else []):
        pid = item.get("property_id") if isinstance(item, dict) else None
        if isinstance(pid, str) and pid not in pool_ids:
            reasons.append(f"matcher_ranking property {pid} is not in the candidate pool")
            fields.append(f"matcher_ranking[{i}].property_id")
    if reasons:
        return None, "; ".join(reasons), fields
    return model.model_dump(), None, []  # type: ignore[union-attr]


def check_parsed(payload: Any, known_ids: set[str]) -> tuple[dict[str, Any] | None, str | None, list[str]]:
    model, reasons, fields = _validate(Parsed, payload)
    if model is not None:
        unknown = [pid for pid in model.candidate_ids if pid not in known_ids]  # type: ignore[attr-defined]
        if unknown:
            return None, f"unknown or inactive candidate ids: {', '.join(unknown)}", ["candidate_ids"]
        return model.model_dump(), None, []
    return None, "; ".join(reasons), fields


def check_answer(payload: Any, expected_challenges: set[str]) -> tuple[dict[str, Any] | None, str | None, list[str]]:
    model, reasons, fields = _validate(Answer, payload)
    if model is None:
        return None, "; ".join(reasons), fields
    if model.challenge_id not in expected_challenges:  # type: ignore[attr-defined]
        return None, f"challenge {model.challenge_id} was not issued to this agent", ["challenge_id"]  # type: ignore[attr-defined]
    return model.model_dump(), None, []


def check_vote(payload: Any, pool_ids: set[str]) -> tuple[dict[str, Any] | None, str | None, list[str]]:
    model, reasons, fields = _validate(VoteOut, payload)
    if model is None:
        return None, "; ".join(reasons), fields
    vote = model.model_dump()
    if vote["vote"] != "abstain" and vote["property_id"] not in pool_ids:
        return None, f"property {vote['property_id']} is not in the candidate pool", ["property_id"]
    return vote, None, []


def check_explanation(payload: Any, recommended_title: str | None) -> tuple[dict[str, Any] | None, str | None, list[str]]:
    model, reasons, fields = _validate(Explanation, payload)
    if model is None:
        return None, "; ".join(reasons), fields
    text = model.result.rationale  # type: ignore[attr-defined]
    # A cheap hallucination guard: the explanation must be about the listing the chair chose.
    if recommended_title and recommended_title.lower() not in text.lower():
        return None, f"the rationale does not mention the recommended listing ({recommended_title})", ["result.rationale"]
    return model.result.model_dump(), None, []  # type: ignore[attr-defined]
