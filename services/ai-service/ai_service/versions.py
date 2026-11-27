"""Matcher versions and human feedback (spec 7.5.4, 7.5.5; contract 6.8; guide steps 9-10).

Rules:
  - A change to the Matcher is a NEW version (matcher-v2). Versions are inserted, never edited,
    so the old one is always there for a rollback.
  - Nothing is promoted automatically: only an admin promotes (to a newer version) or rolls back
    (to an older one), after comparing the evaluation numbers. Who and when is kept in `history`.
  - A debate reads the active version ONCE, when it starts, and records it on the task.
  - The evaluation numbers are sample values until Rohini and Shashank's benchmark run
    (evaluation_sample: true). They are the same numbers the frontend mock shows.
"""
from __future__ import annotations

from datetime import timedelta
from typing import Any

from xenia_shared.mongo import clean
from xenia_shared.timeutil import iso_seconds, utc_now

from .store import db

V1_WEIGHTS = {"amenity_fit": 0.6, "price": 0.35, "rating": 0.1, "risk_penalty": 0, "review_count": 0.1}


def _days_ago(days: float) -> str:
    return iso_seconds(utc_now() - timedelta(days=days))


def seed_versions() -> list[dict[str, Any]]:
    return [
        {
            "version_id": "matcher-v1",
            "order": 1,
            "change": "First version: amenity fit, price and rating, plus a small review-count term.",
            "weights": V1_WEIGHTS,
            "based_on_feedback_ids": [],
            "evaluation": {"precision_at_10": 0.59, "recall_at_10": 0.71, "mean_rank": 3.2, "avg_latency_ms": 23400},
            "created_datetime": _days_ago(40),
        },
        {
            "version_id": "matcher-v2",
            "order": 2,
            "change": "Remove review count from the Matcher score (review_count weight 0.1 → 0), as the Fairness Auditor proposes in debates: popular listings were ranked above equally good newer ones.",
            "weights": {**V1_WEIGHTS, "review_count": 0},
            "based_on_feedback_ids": ["fb_s01"],
            "evaluation": {"precision_at_10": 0.62, "recall_at_10": 0.73, "mean_rank": 2.9, "avg_latency_ms": 23300},
            "created_datetime": _days_ago(3),
        },
    ]


BASELINE = {"name": "Filter-count baseline", "precision_at_10": 0.41, "recall_at_10": 0.52, "mean_rank": 6.8, "avg_latency_ms": 120}


def _sample(fid, trace, task, guest, pid, title, decision, reason, days, outcome=None, version=None, why=None):
    return {
        "feedback_id": fid, "trace_id": trace, "task_id": task, "guest_id": guest,
        "recommended_property_id": pid, "recommended_title": title, "decision": decision, "reason": reason,
        "decided_datetime": _days_ago(days), "sample": True,
        "outcome": outcome, "outcome_version": version, "outcome_reason": why,
    }


def seed_feedback() -> list[dict[str, Any]]:
    """Labelled sample feedback (same as the mock). fb_s01 led to matcher-v2; fb_s02 was rejected as unreliable."""
    return [
        _sample("fb_s01", "sample-trace-01", "sample-task-01", "g_004", "p_002", "Budget Studio near SJSU", "edited",
                "Picked the newer Japantown flat instead: same amenities and price, it only ranked lower because it has few reviews.", 9,
                "led_to_version", "matcher-v2",
                "Specific and checkable: the Fairness Auditor’s rerun without review count gives the same order change in 6 of 8 similar debates. Became matcher-v2."),
        _sample("fb_s02", "sample-trace-02", "sample-task-02", "g_007", "p_008", "Naglee Park Guest Suite", "rejected", "Didn’t like it.", 6,
                "rejected", None,
                "Insufficient and unreliable: no reason the Matcher could use, and the same guest approved two very similar listings that week. No rule change."),
        _sample("fb_s03", "sample-trace-03", "sample-task-03", "g_002", "p_005", "Santana Row Modern Condo", "approved", None, 5),
        _sample("fb_s04", "sample-trace-04", "sample-task-04", "g_009", "p_011", "Berryessa BART-side Condo", "rejected",
                "Host cancelled on a friend last month.", 4),
        _sample("fb_s05", "sample-trace-05", "sample-task-05", "g_006", "p_014", "Las Palmas Park Townhome", "approved", None, 2),
    ]


def ensure_seeded() -> None:
    """Insert the two versions, the settings document and the sample feedback, if they are not there yet."""
    d = db()
    for version in seed_versions():
        d.ai_versions.update_one({"version_id": version["version_id"]}, {"$setOnInsert": version}, upsert=True)
    d.ai_settings.update_one({"_id": "matcher"}, {"$setOnInsert": {"active_version_id": "matcher-v1", "history": []}}, upsert=True)
    for item in seed_feedback():
        d.ai_feedback.update_one({"feedback_id": item["feedback_id"]}, {"$setOnInsert": item}, upsert=True)


def all_versions() -> list[dict[str, Any]]:
    return [clean(v) for v in db().ai_versions.find({}).sort("order", 1)]


def version_by_id(version_id: str) -> dict[str, Any] | None:
    return clean(db().ai_versions.find_one({"version_id": version_id}))


def settings() -> dict[str, Any]:
    ensure_seeded()
    return db().ai_settings.find_one({"_id": "matcher"})


def active_version() -> dict[str, Any]:
    return version_by_id(settings()["active_version_id"])  # type: ignore[return-value]


def _public(version: dict[str, Any]) -> dict[str, Any]:
    return {k: version[k] for k in ("version_id", "change", "weights", "based_on_feedback_ids", "evaluation", "created_datetime")}


def versions_response() -> dict[str, Any]:
    s = settings()
    return {
        "active_version_id": s["active_version_id"],
        "versions": [_public(v) for v in all_versions()],
        "baseline": BASELINE,
        "history": s.get("history", []),
        "evaluation_sample": True,
    }


def switch(version_id: str, action: str, by_id: str, by_name: str) -> tuple[str | None, str | None]:
    """Promote (newer only) or roll back (older only). Returns (error_code, message) or (None, None)."""
    target = version_by_id(version_id)
    if target is None:
        return "NOT_FOUND", f"No matcher version {version_id}."
    current = settings()["active_version_id"]
    if version_id == current:
        return "INVALID_STATUS", f"{version_id} is already the active version."
    newer = target["order"] > version_by_id(current)["order"]  # type: ignore[index]
    if action == "promote" and not newer:
        return "INVALID_STATUS", f"{version_id} is older than the active version: roll back to it instead."
    if action == "rollback" and newer:
        return "INVALID_STATUS", f"{version_id} is newer than the active version: promote it instead."
    entry = {"action": action, "version_id": version_id, "by_id": by_id, "by_name": by_name, "at": iso_seconds(utc_now())}
    # The filter on the current version makes two admins clicking at once safe: only one switch wins.
    changed = db().ai_settings.update_one(
        {"_id": "matcher", "active_version_id": current}, {"$set": {"active_version_id": version_id}, "$push": {"history": entry}}
    )
    if changed.modified_count != 1:
        return "INVALID_STATUS", "The active version changed meanwhile. Reload and try again."
    return None, None


def feedback_items() -> list[dict[str, Any]]:
    ensure_seeded()
    items = [clean(f) for f in db().ai_feedback.find({})]
    return sorted(items, key=lambda f: f["decided_datetime"], reverse=True)
