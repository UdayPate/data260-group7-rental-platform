"""The measured part of every agent: plain, deterministic code over the listing data.

This is a line-by-line port of the frontend mock engine (frontend/src/mocks/ai/engine.ts), so on
the same seed data the real agents rank exactly like the mock (the Matcher picks Budget Studio,
the Risk agent picks Willow Glen for the spec request). A language model never produces these
numbers (guide step 4: "A model may write the reasoning text, never the numbers"), which is
what makes a rerun reproducible (spec 13.5).

Functions take a Snapshot (listings.py) and the ParsedRequirements dict.
"""
from __future__ import annotations

import math
import re
from datetime import date, timedelta
from typing import Any

from xenia_shared.timeutil import today_utc

from .listings import Snapshot

WEIGHT_KEYS = ("amenity_fit", "price", "rating", "risk_penalty", "review_count")
AMENITIES = ("wifi", "kitchen", "parking", "washer", "dryer", "air_conditioning", "heating", "workspace", "pool", "hot_tub", "ev_charger")
PROPERTY_TYPES = ("house", "apartment", "condo", "townhouse", "private_room", "guest_suite")


# ---------------------------------------------------------------- small helpers
def clamp(n: float, lo: float = 0.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, n))


def round2(n: float) -> float:
    """Like JavaScript's Math.round(n * 100) / 100 (half rounds up), so numbers equal the mock's.
    Python's own round() rounds halves to even, which would differ in the last digit."""
    return math.floor(n * 100 + 0.5) / 100


def fmt(n: Any) -> str:
    """A number the way JavaScript prints it in a template string: 4.5 -> "4.5", 250.0 -> "250"."""
    if isinstance(n, float) and n.is_integer():
        return str(int(n))
    return str(n)


def days_from_today(days: int) -> str:
    return (today_utc() + timedelta(days=days)).isoformat()


def nights_between(start: str, end: str) -> int:
    return (date.fromisoformat(end) - date.fromisoformat(start)).days


def ranges_overlap(a_start: str, a_end: str, b_start: str, b_end: str) -> bool:
    """End dates are exclusive, so back-to-back stays do not overlap."""
    return a_start < b_end and b_start < a_end


# ---------------------------------------------------------------- the rule-based parser
WORD_NUMBERS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8}
NUMBER = r"(\d+|one|two|three|four|five|six|seven|eight)"

AMENITY_WORDS: list[tuple[str, re.Pattern[str]]] = [
    ("parking", re.compile(r"parking", re.I)),
    ("kitchen", re.compile(r"kitchen", re.I)),
    ("wifi", re.compile(r"wi-?fi", re.I)),
    ("washer", re.compile(r"washer|laundry", re.I)),
    ("dryer", re.compile(r"dryer", re.I)),
    ("air_conditioning", re.compile(r"air ?condition|\ba/?c\b", re.I)),
    ("heating", re.compile(r"heating", re.I)),
    ("workspace", re.compile(r"workspace|desk", re.I)),
    ("pool", re.compile(r"\bpool\b", re.I)),
    ("hot_tub", re.compile(r"hot ?tub", re.I)),
    ("ev_charger", re.compile(r"\bev\b|electric car", re.I)),
]

TYPE_WORDS: list[tuple[str, re.Pattern[str]]] = [
    ("house", re.compile(r"\bhouse\b", re.I)),
    ("apartment", re.compile(r"apartment|studio", re.I)),
    ("condo", re.compile(r"condo", re.I)),
    ("townhouse", re.compile(r"townho", re.I)),
    ("private_room", re.compile(r"private room", re.I)),
    ("guest_suite", re.compile(r"guest suite", re.I)),
]

# "in Fresno", "in Palo Alto": a capitalised place name after "in", for cities we have no listings in.
UNKNOWN_CITY = re.compile(r"\bin\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2})")


def to_number(text: str) -> int:
    return WORD_NUMBERS.get(text.lower(), None) or int(text)


def parse_request(text: str, known_cities: list[str]) -> dict[str, Any]:
    """Rule-based Guest Request Parser (spec 7.1). Anything not mentioned is null (or []).
    No dates in the text: assume a stay starting two weeks from today and say so (dates_assumed)."""
    lowered = text.lower()
    location = next((c for c in known_cities if c.lower() in lowered), None)
    if location is None:
        unknown = UNKNOWN_CITY.search(text)
        location = unknown.group(1) if unknown else None

    nights_match = re.search(NUMBER + r"[\s-]*nights?", text, re.I)
    nights = to_number(nights_match.group(1)) if nights_match else 2
    guests_match = re.search(r"for\s+" + NUMBER + r"\b(?:\s+(?:people|guests|adults|persons))?", text, re.I)
    price_match = re.search(r"(?:under|below|less than|max(?:imum)?|up to|≤|<=)\s*\$?\s*(\d+)", text, re.I) or re.search(r"\$(\d+)", text)
    rating_match = re.search(r"rating\s*(?:of\s*)?(?:at least|≥|>=|above|over)?\s*(\d(?:\.\d+)?)", text, re.I)

    dates = re.findall(r"\d{4}-\d{2}-\d{2}", text)
    dates_given = len(dates) >= 2
    check_in = dates[0] if dates_given else days_from_today(14)
    check_out = dates[1] if dates_given else days_from_today(14 + nights)

    rating = None
    if rating_match:
        value = float(rating_match.group(1))
        rating = int(value) if value.is_integer() else value
    return {
        "location": location,
        "check_in": check_in,
        "check_out": check_out,
        "dates_assumed": not dates_given,
        "guest_count": to_number(guests_match.group(1)) if guests_match else None,
        "max_nightly_price": int(price_match.group(1)) if price_match else None,
        "min_rating": rating,
        "amenities": [a for a, pattern in AMENITY_WORDS if pattern.search(text)],
        "property_types": [t for t, pattern in TYPE_WORDS if pattern.search(text)],
    }


# ---------------------------------------------------------------- facts every agent can use
def is_available(snap: Snapshot, p: dict[str, Any], req: dict[str, Any]) -> bool:
    if not req.get("check_in") or not req.get("check_out"):
        return True
    return not any(
        b["property_id"] == p["property_id"] and ranges_overlap(b["start_date"], b["end_date"], req["check_in"], req["check_out"])
        for b in snap.blocks
    )


def fit_of(snap: Snapshot, p: dict[str, Any], req: dict[str, Any]) -> dict[str, Any]:
    """Which requirements a listing meets, as readable labels, and the share met (0-1)."""
    passed: list[str] = []
    failed: list[str] = []

    def check(ok: bool, label: str) -> None:
        (passed if ok else failed).append(label)

    if req.get("guest_count") is not None:
        check(p["capacity"] >= req["guest_count"], f"fits {req['guest_count']} guests")
    if req.get("max_nightly_price") is not None:
        check(p["nightly_price"] <= req["max_nightly_price"], f"under ${fmt(req['max_nightly_price'])}")
    for amenity in req.get("amenities", []):
        check(amenity in p["amenities"], f"has {amenity.replace('_', ' ', 1)}")
    if req.get("min_rating") is not None:
        check(p["rating"] >= req["min_rating"], f"rated {fmt(req['min_rating'])}+")
    if req.get("property_types"):
        check(p["property_type"] in req["property_types"], "right property type")
    available = is_available(snap, p, req)
    check(available, "free on the dates")
    total = len(passed) + len(failed)
    return {"passed": passed, "failed": failed, "fit": 1.0 if total == 0 else len(passed) / total, "available": available}


def host_cancellations(snap: Snapshot, host_id: str) -> list[dict[str, Any]]:
    return snap.host_cancellations.get(host_id, [])


def risk_flags(snap: Snapshot, p: dict[str, Any]) -> list[str]:
    """Warning signs the Risk agent looks for, each traceable to a record."""
    host = snap.hosts.get(p["host_id"])
    flags: list[str] = []
    cancelled = host_cancellations(snap, p["host_id"])
    if cancelled:
        flags.append(f"host cancelled {len(cancelled)} stay(s) ({', '.join(r['reservation_id'] for r in cancelled)})")
    if host and host["response_rate"] < 80:
        flags.append(f"host replies to only {host['response_rate']}% of messages")
    if host and host["verification_status"] != "verified":
        flags.append(f"host verification is {host['verification_status']}")
    return flags


def price_bonus(p: dict[str, Any], req: dict[str, Any]) -> float:
    budget = req.get("max_nightly_price")
    if budget:
        return clamp((budget - p["nightly_price"]) / budget)
    return clamp(1 - p["nightly_price"] / 400)


def rating_norm(p: dict[str, Any]) -> float:
    return clamp(p["rating"] - 4)


def popularity(p: dict[str, Any]) -> float:
    return clamp(p["review_count"] / 60)


def risk_part(snap: Snapshot, p: dict[str, Any]) -> float:
    """0-1: how risky the host looks (contract 6.7, the K part)."""
    host = snap.hosts.get(p["host_id"])
    r = 0.6 if host_cancellations(snap, p["host_id"]) else 0.0
    if host and host["response_rate"] < 80:
        r += 0.25
    if host and host["verification_status"] != "verified":
        r += 0.15
    return clamp(r)


# ---------------------------------------------------------------- the Matcher (contract 6.7)
def matcher_parts(snap: Snapshot, p: dict[str, Any], req: dict[str, Any]) -> tuple[dict[str, Any], dict[str, float], bool]:
    fit = fit_of(snap, p, req)
    wanted = req.get("amenities", [])
    parts = {
        "amenity_fit": 1.0 if not wanted else len([a for a in wanted if a in p["amenities"]]) / len(wanted),
        "price": price_bonus(p, req),
        "rating": rating_norm(p),
        "risk_penalty": risk_part(snap, p),
        "review_count": popularity(p),
    }
    # Must-haves are every requirement except amenities (amenities are a weight).
    must_haves = all(label.startswith("has ") for label in fit["failed"])
    return fit, parts, must_haves


def weighted_score(parts: dict[str, float], w: dict[str, float]) -> float:
    """(A·a + P·p + R·r + C·c − K·k) / (sum of the five weights), clamped to 0-1."""
    total = sum(w[k] for k in WEIGHT_KEYS)
    if total == 0:
        return 0.0
    plus = w["amenity_fit"] * parts["amenity_fit"] + w["price"] * parts["price"] + w["rating"] * parts["rating"] + w["review_count"] * parts["review_count"]
    return clamp((plus - w["risk_penalty"] * parts["risk_penalty"]) / total)


def matcher_score(snap: Snapshot, p: dict[str, Any], req: dict[str, Any], w: dict[str, float]) -> dict[str, Any]:
    fit, parts, must_haves = matcher_parts(snap, p, req)
    reasons = [f"meets {len(fit['passed'])} of {len(fit['passed']) + len(fit['failed'])} requirements", f"${fmt(p['nightly_price'])}/night"]
    if fit["failed"]:
        reasons.append(f"misses: {', '.join(fit['failed'])}")
    if w["review_count"] > 0:
        reasons.append(f"{p['review_count']} reviews")
    if w["risk_penalty"] > 0 and parts["risk_penalty"] > 0:
        reasons.append("host risk counted")
    return {"p": p, "score": weighted_score(parts, w), "reasons": reasons, "must_haves": must_haves, "parts": parts}


def rank_matcher(snap: Snapshot, pool: list[dict[str, Any]], req: dict[str, Any], w: dict[str, float]) -> list[dict[str, Any]]:
    """Listings meeting every must-have first, then by score (high first), then by price (low first)."""
    scored = [matcher_score(snap, p, req, w) for p in pool]
    return sorted(scored, key=lambda s: (not s["must_haves"], -s["score"], s["p"]["nightly_price"]))


def to_rank_entry(s: dict[str, Any], index: int) -> dict[str, Any]:
    return {
        "rank": index + 1,
        "property_id": s["p"]["property_id"],
        "title": s["p"]["title"],
        "score": round2(s["score"]),
        "meets_must_haves": s.get("must_haves", True),
        "parts": {k: round2(s["parts"][k]) for k in WEIGHT_KEYS},
    }


# ---------------------------------------------------------------- the Risk agent and the Fairness Auditor
def risk_score(snap: Snapshot, p: dict[str, Any], req: dict[str, Any]) -> dict[str, Any]:
    fit = fit_of(snap, p, req)
    host = snap.hosts.get(p["host_id"])
    trust = (host["response_rate"] / 100) * (1 if host["verification_status"] == "verified" else 0.8) if host else 0.5
    cancelled = len(host_cancellations(snap, p["host_id"]))
    score = 0.6 * fit["fit"] + 0.25 * trust + 0.15 * rating_norm(p) - 0.12 * cancelled
    flags = risk_flags(snap, p)
    reasons = flags or [f"host replies to {host['response_rate'] if host else '?'}% of messages", "no host cancellations"]
    return {"p": p, "score": score, "reasons": reasons}


def fairness_score(snap: Snapshot, p: dict[str, Any], req: dict[str, Any]) -> dict[str, Any]:
    """Fit, price and rating only: no review count, no host popularity (spec 7.1 Fairness and Bias Auditor)."""
    fit = fit_of(snap, p, req)
    score = 0.7 * fit["fit"] + 0.2 * price_bonus(p, req) + 0.1 * rating_norm(p)
    return {
        "p": p,
        "score": score,
        "reasons": [f"meets {len(fit['passed'])} of {len(fit['passed']) + len(fit['failed'])} requirements", "scored without review count or host popularity"],
    }


def rank_by(scored: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(scored, key=lambda s: (-s["score"], s["p"]["nightly_price"]))


def to_ranked(s: dict[str, Any]) -> dict[str, Any]:
    return {"property_id": s["p"]["property_id"], "title": s["p"]["title"], "score": round2(clamp(s["score"])), "reasons": list(s["reasons"])}


def confidence_of(ranked: list[dict[str, Any]]) -> float:
    """Confidence grows with the lead over the runner-up."""
    lead = (ranked[0]["score"] - ranked[1]["score"]) * 2 if len(ranked) > 1 else 0.2
    return round2(clamp(0.6 + lead, 0.55, 0.92))


def candidate_pool(snap: Snapshot, req: dict[str, Any]) -> list[dict[str, Any]]:
    """Plan step 2: every active listing in the requested city (all cities if none was named)."""
    location = req.get("location")
    pool = [p for p in snap.properties if p["status"] == "active" and (not location or p["city"] == location)]
    return sorted(pool, key=lambda p: p["property_id"])
