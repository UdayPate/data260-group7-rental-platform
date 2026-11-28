"""MongoDB: the record of every debate (spec 7.2 "save the complete debate, not only the final answer").

Kafka is how the agents talk; MongoDB is what happened. Collections:

    ai_tasks        one per request (unique task_id). Also holds `last_seq` (the event counter) and
                    `debate` (the chair's working state, so a restarted chair can carry on)
    ai_events       every stream event, unique (task_id, seq) and unique idempotency_key
    ai_results      one per task (unique task_id), the AiResult
    ai_feedback     one per human decision (+ the labelled sample items)
    ai_versions     matcher-v1, matcher-v2 ... (never edited, only added)
    ai_settings     the active matcher version and the promote / rollback history
    ai_counters     task_001, task_002 ...
    model_calls, semantic_cache, semantic_cache_stats   step 11 (llm.py)
"""
from __future__ import annotations

import threading
from typing import Any

from xenia_shared.mongo import clean, get_mongo
from xenia_shared.timeutil import iso_millis

FINISHED = ("completed", "failed", "timed_out")

_indexes_done = False
_indexes_lock = threading.Lock()


def db() -> Any:
    return get_mongo()


def ensure_indexes() -> None:
    """Idempotent: safe to run at every start-up. The unique keys are what the rules rely on."""
    global _indexes_done
    with _indexes_lock:
        if _indexes_done:
            return
        d = db()
        d.ai_tasks.create_index("task_id", unique=True)
        d.ai_tasks.create_index("trace_id")
        d.ai_tasks.create_index([("guest_id", 1), ("created_datetime", -1)])
        d.ai_events.create_index([("task_id", 1), ("seq", 1)], unique=True)  # no gaps, no doubles
        d.ai_events.create_index("idempotency_key", unique=True)
        d.ai_events.create_index([("trace_id", 1), ("timestamp", 1)])
        d.ai_results.create_index("task_id", unique=True)
        d.ai_feedback.create_index("feedback_id", unique=True)
        d.ai_feedback.create_index("trace_id")
        d.ai_versions.create_index("version_id", unique=True)
        d.model_calls.create_index([("trace_id", 1), ("timestamp", 1)])
        d.semantic_cache_stats.create_index("timestamp")
        _indexes_done = True


def reset_for_tests() -> None:
    global _indexes_done
    _indexes_done = False


# ------------------------------------------------------------------ ids
def next_task_id() -> str:
    """task_001, task_002 ... (atomic $inc, so two requests never get the same number)."""
    row = db().ai_counters.find_one_and_update({"_id": "task"}, {"$inc": {"value": 1}}, upsert=True, return_document=True)
    return f"task_{int(row['value']):03d}"


# ------------------------------------------------------------------ tasks
TASK_FIELDS = (
    "task_id", "trace_id", "guest_id", "request_text", "status", "demo", "plan", "requirements",
    "matcher_version", "weights", "parent_task_id", "created_datetime", "updated_datetime", "error",
)


def task_json(doc: dict[str, Any]) -> dict[str, Any]:
    """The AiTask of the contract (internal fields such as `debate` and `last_seq` left out)."""
    return {k: doc.get(k) for k in TASK_FIELDS}


def get_task(task_id: str) -> dict[str, Any] | None:
    return clean(db().ai_tasks.find_one({"task_id": task_id}))


def insert_task(task: dict[str, Any]) -> None:
    db().ai_tasks.insert_one({**task, "last_seq": 0, "debate": None})


def update_task(task_id: str, fields: dict[str, Any]) -> None:
    db().ai_tasks.update_one({"task_id": task_id}, {"$set": fields})


def events_after(task_id: str, after_seq: int) -> list[dict[str, Any]]:
    return [clean(e) for e in db().ai_events.find({"task_id": task_id, "seq": {"$gt": after_seq}}).sort("seq", 1)]


def all_events(task_id: str) -> list[dict[str, Any]]:
    return events_after(task_id, 0)


def stream_event(doc: dict[str, Any]) -> dict[str, Any]:
    """A stored event as the StreamEvent the UI expects (the envelope + seq; task_id is internal)."""
    return {k: doc[k] for k in ("event_type", "trace_id", "timestamp", "actor_id", "entity", "idempotency_key", "seq", "payload")}


def append_event(task_id: str, trace_id: str, actor: str, event_type: str, payload: dict[str, Any]) -> dict[str, Any]:
    """Store one stream event with the next seq for the task.

    Only the chair calls this (one writer per task). The seq comes from an atomic $inc on the
    task, and (task_id, seq) is a unique index, so there can be no doubles; and because the same
    writer inserts right after taking the number, no gaps."""
    row = db().ai_tasks.find_one_and_update({"task_id": task_id}, {"$inc": {"last_seq": 1}}, return_document=True)
    seq = int(row["last_seq"])
    event = {
        "event_type": event_type,
        "trace_id": trace_id,
        "timestamp": iso_millis(),  # UTC with milliseconds: the UI measures delivery latency from it
        "actor_id": actor,
        "entity": {"entity_type": "ai_task", "entity_id": task_id},
        "idempotency_key": f"{task_id}:{seq}",
        "seq": seq,
        "payload": payload,
        "task_id": task_id,
    }
    db().ai_events.insert_one(dict(event))
    fields: dict[str, Any] = {"updated_datetime": event["timestamp"]}
    if event_type == "task.status":
        fields["status"] = payload["status"]
    elif event_type == "plan.created":
        fields["plan"] = payload["plan"]
    elif event_type == "requirements.parsed":
        fields["requirements"] = payload["requirements"]
    db().ai_tasks.update_one({"task_id": task_id}, {"$set": fields})
    if event_type == "plan.step_updated":
        db().ai_tasks.update_one(
            {"task_id": task_id, "plan.steps.step_id": payload["step_id"]},
            {"$set": {"plan.steps.$.status": payload["status"], "plan.steps.$.note": payload["note"]}},
        )
    event.pop("task_id")
    return event


# ------------------------------------------------------------------ results
def get_result(task_id: str) -> dict[str, Any] | None:
    return clean(db().ai_results.find_one({"task_id": task_id}))


def save_result(result: dict[str, Any]) -> None:
    db().ai_results.replace_one({"task_id": result["task_id"]}, dict(result), upsert=True)


def set_decision_once(task_id: str, decision: dict[str, Any]) -> dict[str, Any] | None:
    """Store the human decision only if there is none yet (atomic). None = someone was first."""
    from pymongo import ReturnDocument

    row = db().ai_results.find_one_and_update(
        {"task_id": task_id, "human_decision": None}, {"$set": {"human_decision": decision}}, return_document=ReturnDocument.AFTER
    )
    return clean(row)
