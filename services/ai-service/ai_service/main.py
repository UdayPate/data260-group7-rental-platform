"""Xenia AI Agent Service API (port 8007). Contract: docs/api/data-contract.md section 6.

    POST /ai/requests                     start a debate (202, then follow it on the stream)
    GET  /ai/tasks/{task_id}              the task and every event so far (a reload rebuilds the debate)
    GET  /ai/results/{task_id}            the result (409 while the debate runs)
    POST /ai/tasks/{task_id}/approve      approve or edit (books NOTHING: the guest books it themselves)
    POST /ai/tasks/{task_id}/reject
    WS   /ai/tasks/{task_id}/stream?after_seq=N&token=...
    GET  /ai/feedback, GET /ai/versions, POST /ai/versions/{id}/promote|rollback   (admin only)

This process never runs an agent. It stores the new task, publishes `ai.requests` (key = trace_id)
and reads what the chair writes to MongoDB. Run the agents with `python -m ai_service.workers ...`
(or set AI_RUN_WORKERS_IN_PROCESS=on for a one-process development setup).

Run:   uvicorn ai_service.main:app --port 8007
"""
from __future__ import annotations

import asyncio
import logging
import uuid
from typing import Any

from fastapi import Depends, WebSocket
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool

from xenia_shared.app import create_app
from xenia_shared.auth import Claims, claims_from_websocket_token, require
from xenia_shared.config import env_flag, load_env
from xenia_shared.errors import ApiError
from xenia_shared.kafka import KafkaUnavailable
from xenia_shared.timeutil import iso_millis, iso_seconds, utc_now
from xenia_shared.trace import emit_step
from xenia_shared.validation import json_body, require_fields

from . import protocol, scoring, store, versions

load_env()
log = logging.getLogger("xenia.ai.api")
app = create_app("ai-service")
POLL_SECONDS = 0.2  # how often an open stream looks for new events in MongoDB


@app.on_event("startup")
def _startup() -> None:
    store.ensure_indexes()
    versions.ensure_seeded()
    app.state.workers = []
    if env_flag("AI_RUN_WORKERS_IN_PROCESS", False):
        from .workers import start_in_threads

        log.warning("AI_RUN_WORKERS_IN_PROCESS=on: all agents run inside the API process (development only)")
        app.state.workers = start_in_threads()


@app.on_event("shutdown")
def _shutdown() -> None:
    for _thread, stop in app.state.workers:
        stop.set()


def task_not_found(task_id: Any) -> ApiError:
    return ApiError("NOT_FOUND", f"No AI task found with id {task_id}.")


def own_task(task_id: str, claims: Claims, refusal: str) -> dict[str, Any]:
    task = store.get_task(task_id)
    if task is None:
        raise task_not_found(task_id)
    if task["guest_id"] != claims.sub:
        raise ApiError("UNAUTHORIZED", refusal)
    return task


def read_weights(value: Any) -> dict[str, float]:
    """Contract 6.7: all five weights, each a number 0-1, not all 0."""
    if not isinstance(value, dict):
        raise ApiError("VALIDATION_ERROR", "weights must be an object with the five Matcher weights.")
    for key in scoring.WEIGHT_KEYS:
        n = value.get(key)
        if isinstance(n, bool) or not isinstance(n, (int, float)) or not 0 <= n <= 1:
            raise ApiError("VALIDATION_ERROR", f"weights.{key} must be a number from 0 to 1.")
    extra = [k for k in value if k not in scoring.WEIGHT_KEYS]
    if extra:
        raise ApiError("VALIDATION_ERROR", f"Unknown weight(s): {', '.join(extra)}.")
    if all(value[k] == 0 for k in scoring.WEIGHT_KEYS):
        raise ApiError("VALIDATION_ERROR", "At least one weight must be above 0.")
    return {k: value[k] for k in scoring.WEIGHT_KEYS}


# ------------------------------------------------------------------ requests
@app.post("/ai/requests")
def create_request(claims: Claims = Depends(require(["guest"], own=["guest_id"])), body: dict[str, Any] = Depends(json_body)):
    require_fields(body, ["guest_id", "request_text"])
    if not isinstance(body["request_text"], str):
        raise ApiError("VALIDATION_ERROR", "request_text must be text.")
    text = body["request_text"].strip()
    if len(text) < 10:
        raise ApiError("VALIDATION_ERROR", "Please describe what you’re looking for in a little more detail.")
    if len(text) > 500:
        raise ApiError("VALIDATION_ERROR", "Please keep the request under 500 characters.")
    weights = read_weights(body["weights"]) if body.get("weights") is not None else None
    parent_task_id = None
    if body.get("parent_task_id") is not None:
        parent = store.get_task(str(body["parent_task_id"]))
        if parent is None:
            raise task_not_found(body["parent_task_id"])
        if parent["guest_id"] != claims.sub:
            raise ApiError("UNAUTHORIZED", "You can only rerun your own AI requests.")
        if parent["request_text"] != text:
            raise ApiError("VALIDATION_ERROR", "A rerun must use the same request text as the request it reruns.")
        parent_task_id = parent["task_id"]
    demo = body.get("demo") if isinstance(body.get("demo"), dict) else {}

    # The active matcher version is read ONCE, here, and recorded on the task (spec 7.5.4).
    version = versions.active_version()
    now = iso_millis()
    task = {
        "task_id": store.next_task_id(),
        "trace_id": str(uuid.uuid4()),  # never changes for this workflow: every round, vote, result and approval
        "guest_id": claims.sub,
        "request_text": text,
        "status": "waiting",
        "demo": {"delay_risk_agent": demo.get("delay_risk_agent") is True, "invalid_agent_output": demo.get("invalid_agent_output") is True},
        "plan": None,
        "requirements": None,
        "matcher_version": version["version_id"],
        "weights": weights or version["weights"],
        "parent_task_id": parent_task_id,
        "created_datetime": now,
        "updated_datetime": now,
        "error": None,
    }
    store.insert_task(task)
    try:
        protocol.send("ai.requests", "ai.requests", task["task_id"], task["trace_id"], claims.sub, {
            "task_id": task["task_id"], "guest_id": claims.sub, "request_text": text, "demo": task["demo"],
            "weights": task["weights"], "matcher_version": task["matcher_version"], "parent_task_id": parent_task_id,
        }, key_suffix="request")
    except KafkaUnavailable:
        store.update_task(task["task_id"], {"status": "failed", "error": "Kafka unavailable"})
        raise ApiError("SERVICE_UNAVAILABLE", "The AI assistant is temporarily unavailable. Please try again in a moment.")
    emit_step(task["trace_id"], "ai.requests", protocol.SERVICE, 0, "ok", None, {"task_id": task["task_id"]})
    return JSONResponse({"task_id": task["task_id"], "trace_id": task["trace_id"], "status": "waiting"}, status_code=202)


@app.get("/ai/tasks/{task_id}")
def get_task(task_id: str, claims: Claims = Depends(require(["guest"]))):
    task = own_task(task_id, claims, "This AI request belongs to another guest.")
    return {"task": store.task_json(task), "events": [store.stream_event(e) for e in store.all_events(task_id)]}


@app.get("/ai/results/{task_id}")
def get_result(task_id: str, claims: Claims = Depends(require(["guest"]))):
    own_task(task_id, claims, "This AI request belongs to another guest.")
    result = store.get_result(task_id)
    if result is None:
        raise ApiError("INVALID_STATUS", "The debate is still running; the result isn’t ready yet.")
    return result


# ------------------------------------------------------------------ human approval (spec 7.5.1: approving books nothing)
def check_decision(task_id: str, claims: Claims) -> tuple[dict[str, Any], dict[str, Any]]:
    task = own_task(task_id, claims, "Only the guest who asked can approve or reject this recommendation.")
    result = store.get_result(task_id)
    if result and result.get("human_decision"):
        raise ApiError("INVALID_STATUS", f"This recommendation was already {result['human_decision']['decision']}.")
    if task["status"] != "waiting_for_approval" or result is None:
        raise ApiError("INVALID_STATUS", "The debate is not finished yet, so there is nothing to approve.")
    return task, result


def record_decision(task: dict[str, Any], result: dict[str, Any], decision: dict[str, Any]) -> dict[str, Any]:
    updated = store.set_decision_once(task["task_id"], decision)
    if updated is None:  # another click got there first
        raise ApiError("INVALID_STATUS", "This recommendation was already decided.")
    recommended = result.get("recommended") or {}
    store.db().ai_feedback.insert_one({  # spec 7.5.4: the original trace_id, recommendation, decision and reason
        "feedback_id": f"fb_{task['task_id']}_{task['trace_id'][:8]}", "trace_id": task["trace_id"], "task_id": task["task_id"],
        "guest_id": decision["guest_id"], "recommended_property_id": recommended.get("property_id"), "recommended_title": recommended.get("title"),
        "decision": decision["decision"], "reason": decision["reason"] or decision["edited_rationale"], "decided_datetime": decision["decided_datetime"],
        "sample": False, "outcome": None, "outcome_version": None, "outcome_reason": None,
    })
    # The chair (the one writer of the stream) records decision.recorded and completes the task.
    try:
        protocol.send("ai.results", "decision.recorded", task["task_id"], task["trace_id"], decision["guest_id"], {"decision": decision}, key_suffix="decision")
    except KafkaUnavailable:
        log.error("decision for %s stored, but could not be sent to the chair", task["task_id"])
    return updated


@app.post("/ai/tasks/{task_id}/approve")
def approve(task_id: str, claims: Claims = Depends(require(["guest"], own=["guest_id"])), body: dict[str, Any] = Depends(json_body)):
    require_fields(body, ["guest_id"])
    task, result = check_decision(task_id, claims)
    edits = body.get("edits") if isinstance(body.get("edits"), dict) else {}
    recommended_id = (result.get("recommended") or {}).get("property_id")
    edited_property = edits.get("property_id") if isinstance(edits.get("property_id"), str) and edits.get("property_id") != recommended_id else None
    edited_rationale = None
    if isinstance(edits.get("rationale"), str) and edits["rationale"].strip() != result["rationale"]:
        edited_rationale = edits["rationale"].strip()
        if edited_rationale == "":
            raise ApiError("VALIDATION_ERROR", "The explanation can’t be empty.")
    if edited_property and edited_property not in {r["property_id"] for r in result["ranked"]}:
        raise ApiError("VALIDATION_ERROR", "You can only pick one of the listed candidates.")
    reason = body.get("reason").strip() if isinstance(body.get("reason"), str) and body["reason"].strip() else None
    return record_decision(task, result, {
        "decision": "edited" if edited_property or edited_rationale else "approved",
        "guest_id": claims.sub, "reason": reason, "edited_property_id": edited_property, "edited_rationale": edited_rationale,
        "decided_datetime": iso_seconds(utc_now()),
    })


@app.post("/ai/tasks/{task_id}/reject")
def reject(task_id: str, claims: Claims = Depends(require(["guest"], own=["guest_id"])), body: dict[str, Any] = Depends(json_body)):
    require_fields(body, ["guest_id", "reason"])
    if not isinstance(body["reason"], str) or not body["reason"].strip():
        raise ApiError("VALIDATION_ERROR", "Please give a reason for rejecting.")
    task, result = check_decision(task_id, claims)
    return record_decision(task, result, {
        "decision": "rejected", "guest_id": claims.sub, "reason": body["reason"].strip(),
        "edited_property_id": None, "edited_rationale": None, "decided_datetime": iso_seconds(utc_now()),
    })


# ------------------------------------------------------------------ self-improvement (admin only)
@app.get("/ai/feedback")
def feedback(_claims: Claims = Depends(require(["admin"]))):
    return {"items": versions.feedback_items()}


@app.get("/ai/versions")
def get_versions(_claims: Claims = Depends(require(["admin"]))):
    return versions.versions_response()


def _switch(version_id: str, action: str, claims: Claims):
    code, message = versions.switch(version_id, action, claims.sub, claims.name)
    if code:
        raise ApiError(code, message)
    return versions.versions_response()


@app.post("/ai/versions/{version_id}/promote")
def promote(version_id: str, claims: Claims = Depends(require(["admin"]))):
    return _switch(version_id, "promote", claims)


@app.post("/ai/versions/{version_id}/rollback")
def rollback(version_id: str, claims: Claims = Depends(require(["admin"]))):
    return _switch(version_id, "rollback", claims)


# ------------------------------------------------------------------ the live stream (contract 6.3)
@app.websocket("/ai/tasks/{task_id}/stream")
async def stream(websocket: WebSocket, task_id: str):
    await websocket.accept()  # accept first, THEN close with our own code (closing before accept shows as 403)
    try:
        claims = claims_from_websocket_token(websocket.query_params.get("token"))
    except ApiError:
        claims = None
    if claims is None:
        await websocket.close(code=4401)
        return
    task = await run_in_threadpool(store.get_task, task_id)
    if task is None:
        await websocket.close(code=4404)
        return
    if task["guest_id"] != claims.sub:
        await websocket.close(code=4403)
        return
    try:
        last_seq = max(int(websocket.query_params.get("after_seq", "0")), 0)
    except ValueError:
        last_seq = 0

    # Notice when the page goes away (the page never sends anything).
    gone = asyncio.Event()

    async def watch() -> None:
        try:
            while True:
                await websocket.receive_text()
        except Exception:  # noqa: BLE001
            gone.set()

    watcher = asyncio.create_task(watch())
    try:
        while not gone.is_set():
            # 1. replay everything after last_seq, 2. then every new event as the chair stores it
            events = await run_in_threadpool(store.events_after, task_id, last_seq)
            for event in events:
                # Trace isolation (contract 6.6 rule 3): only this task's own events, ever.
                if event["trace_id"] != task["trace_id"] or event["entity"]["entity_id"] != task_id:
                    log.error("DROPPED event %s from another trace on the stream of %s", event.get("idempotency_key"), task_id)
                    continue
                await websocket.send_json(store.stream_event(event))
                last_seq = event["seq"]
            current = await run_in_threadpool(store.get_task, task_id)
            if current and current["status"] in store.FINISHED and not events:
                await websocket.close(code=1000)  # finished; stays open during waiting_for_approval
                return
            try:
                await asyncio.wait_for(gone.wait(), timeout=POLL_SECONDS)
            except asyncio.TimeoutError:
                pass
    except Exception:  # noqa: BLE001  (the page closed the socket mid-send)
        pass
    finally:
        watcher.cancel()
