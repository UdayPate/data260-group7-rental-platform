"""Xenia Messaging Service (port 8004). Contract: docs/api/data-contract.md "Messaging Service".
Reference behaviour: frontend/src/mocks/handlers/messaging.ts.

    POST /threads/open /threads/get /threads/byUser /messages/list /messages/send

Storage: MongoDB `threads` and `messages` (spec 3.2). Names in a thread are COPIED from the User and
Property services when the thread opens, calling them with the caller's own token (xenia_shared.upstream).

Rules (team decisions):
  1. Only the thread's guest and host may read or write it (403).
  2. One thread per guest + host + listing. A host may only open a thread with a guest who has a
     reservation at that listing (403, checked with /bookings/byProperty), so no cold messages.
  3. delivery_status: "sent" when stored, "delivered" when it appears in the receiver's
     threads/byUser, "read" when the receiver calls messages/list.
  4. Kafka: message.sent with the message as payload, idempotency_key = message_id.

Run:   uvicorn messaging_service.main:app --port 8004
"""
from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import Depends, Request
from fastapi.responses import JSONResponse

from xenia_shared.app import create_app
from xenia_shared.auth import Claims, bearer_token, require
from xenia_shared.config import env_flag, load_env
from xenia_shared.envelope import make_envelope
from xenia_shared.errors import ApiError
from xenia_shared.kafka import publish
from xenia_shared.mongo import clean, get_mongo, is_duplicate, load_seed
from xenia_shared.timeutil import iso_millis, iso_seconds, utc_now
from xenia_shared.trace import emit_step
from xenia_shared.upstream import call
from xenia_shared.validation import json_body, require_fields

load_env()
log = logging.getLogger("xenia.messaging")
app = create_app("messaging-service")
SERVICE = "messaging-service"
MESSAGE_TEXT_MAX = 2000


def db():
    return get_mongo()


@app.on_event("startup")
def _startup() -> None:
    ensure_indexes()
    if env_flag("SEED_ON_START", False):
        seed_if_empty()


def ensure_indexes() -> None:
    d = db()
    d.threads.create_index("thread_id", unique=True)
    d.threads.create_index([("guest_id", 1), ("host_id", 1), ("property_id", 1)], unique=True)  # one thread per guest + host + listing
    d.threads.create_index("host_id")
    d.messages.create_index("message_id", unique=True)
    d.messages.create_index([("thread_id", 1), ("timestamp", 1)])
    d.messages.create_index("receiver_id")
    d.message_keys.create_index("idempotency_key", unique=True)


def seed_if_empty() -> int:
    """Load the mock's 5 threads and 12 messages (same ids). Does nothing if threads exist."""
    d = db()
    if d.threads.count_documents({}) > 0:
        return 0
    threads, messages = load_seed("threads", millis=False), load_seed("messages")
    d.threads.insert_many([dict(t) for t in threads])
    d.messages.insert_many([dict(m) for m in messages])
    d.counters.update_one({"_id": "t"}, {"$max": {"value": len(threads)}}, upsert=True)
    d.counters.update_one({"_id": "m"}, {"$max": {"value": len(messages)}}, upsert=True)
    return len(threads)


def next_id(prefix: str) -> str:
    row = db().counters.find_one_and_update({"_id": prefix}, {"$inc": {"value": 1}}, upsert=True, return_document=True)
    return f"{prefix}_{int(row['value']):03d}"


# ------------------------------------------------------------------ helpers
THREAD_FIELDS = ("thread_id", "guest_id", "host_id", "property_id", "reservation_id", "created_datetime", "guest_name", "host_name", "property_title")
MESSAGE_FIELDS = ("message_id", "thread_id", "sender_id", "receiver_id", "timestamp", "message_text", "delivery_status")


def thread_not_found(thread_id: Any) -> ApiError:
    return ApiError("NOT_FOUND", f"No conversation found with id {thread_id}.")


def not_participant() -> ApiError:
    return ApiError("UNAUTHORIZED", "Only the guest and host in this conversation can see it.")


def is_participant(thread: dict[str, Any], user_id: Any) -> bool:
    return user_id in (thread["guest_id"], thread["host_id"])


def message_json(m: dict[str, Any]) -> dict[str, Any]:
    return {k: m[k] for k in MESSAGE_FIELDS}


def summarize(thread: dict[str, Any], user_id: str) -> dict[str, Any]:
    """ThreadSummary: the thread + its newest message + how many messages TO this user are unread."""
    d = db()
    last = d.messages.find_one({"thread_id": thread["thread_id"]}, sort=[("timestamp", -1)])
    unread = d.messages.count_documents({"thread_id": thread["thread_id"], "receiver_id": user_id, "delivery_status": {"$ne": "read"}})
    return {
        **{k: thread.get(k) for k in THREAD_FIELDS},
        "last_message": {"text": last["message_text"], "timestamp": last["timestamp"], "sender_id": last["sender_id"]} if last else None,
        "unread_count": unread,
    }


def get_thread(thread_id: Any, user_id: Any) -> dict[str, Any]:
    thread = clean(db().threads.find_one({"thread_id": thread_id}))
    if thread is None:
        raise thread_not_found(thread_id)
    if not is_participant(thread, user_id):
        raise not_participant()
    return thread


def upstream(base_env: str, path: str, body: dict[str, Any], token: str | None, not_found: str) -> dict[str, Any]:
    status, data = call(base_env, path, body, token)
    if status == 404:
        raise ApiError("NOT_FOUND", not_found)
    if status in (401, 403):
        raise ApiError("UNAUTHORIZED", (data or {}).get("error", {}).get("message", "You may not do this."))
    if status != 200:
        raise ApiError("VALIDATION_ERROR", (data or {}).get("error", {}).get("message", "The request is not valid."))
    return data


# ------------------------------------------------------------------ endpoints
@app.post("/threads/open")
def threads_open(request: Request, claims: Claims = Depends(require(["guest", "host"], own=["actor_id"])), body: dict[str, Any] = Depends(json_body)):
    require_fields(body, ["guest_id", "host_id", "property_id", "actor_id"])
    token = bearer_token(request)
    guest_id, host_id, property_id, actor = str(body["guest_id"]), str(body["host_id"]), str(body["property_id"]), claims.sub
    if actor not in (guest_id, host_id):
        raise ApiError("UNAUTHORIZED", "Only the guest or the host can open this conversation.")
    prop = upstream("PROPERTY_API_BASE_URL", "/properties/get", {"property_id": property_id}, token, f"No property found with id {property_id}.")
    host = upstream("USER_API_BASE_URL", "/hosts/get", {"host_id": host_id}, token, f"No host found with id {host_id}.")
    if prop["host_id"] != host["host_id"]:
        raise ApiError("VALIDATION_ERROR", "That host doesn’t host this listing.")

    reservations: list[dict[str, Any]] | None = None
    if actor == host_id:
        # Rule 2: hosts can't cold-message guests. Asked with the HOST's token, so the Booking Service
        # itself checks that this host owns the listing.
        reservations = upstream("BOOKING_API_BASE_URL", "/bookings/byProperty", {"property_id": property_id}, token,
                                f"No property found with id {property_id}.")["items"]
        if not any(r["guest_id"] == guest_id for r in reservations):
            raise ApiError("UNAUTHORIZED", "You can only message guests who have a reservation at this listing.")
    guest = upstream("USER_API_BASE_URL", "/guests/get", {"guest_id": guest_id}, token, f"No guest found with id {guest_id}.")

    reservation_id = None
    if body.get("reservation_id") is not None:
        status, reservation = call("BOOKING_API_BASE_URL", "/bookings/get", {"reservation_id": body["reservation_id"]}, token)
        if status != 200 or reservation["guest_id"] != guest_id or reservation["property_id"] != property_id:
            raise ApiError("VALIDATION_ERROR", "That reservation doesn’t belong to this guest and listing.")
        reservation_id = reservation["reservation_id"]

    d = db()
    existing = clean(d.threads.find_one({"guest_id": guest_id, "host_id": host_id, "property_id": property_id}))
    if existing:
        if reservation_id:  # remember the latest reservation the thread was opened from
            d.threads.update_one({"thread_id": existing["thread_id"]}, {"$set": {"reservation_id": reservation_id}})
            existing["reservation_id"] = reservation_id
        return summarize(existing, actor)
    thread = {
        "thread_id": next_id("t"), "guest_id": guest_id, "host_id": host_id, "property_id": property_id,
        "reservation_id": reservation_id, "created_datetime": iso_seconds(utc_now()),
        "guest_name": f"{guest['first_name']} {guest['last_name']}", "host_name": host["name"], "property_title": prop["title"],
    }
    try:
        d.threads.insert_one(dict(thread))
    except Exception as problem:  # noqa: BLE001
        if is_duplicate(problem):  # two opens at the same moment: the other one created it
            return summarize(clean(d.threads.find_one({"guest_id": guest_id, "host_id": host_id, "property_id": property_id})), actor)
        raise
    return JSONResponse(summarize(thread, actor), status_code=201)


@app.post("/threads/get")
def threads_get(_claims: Claims = Depends(require(["guest", "host"], own=["user_id"])), body: dict[str, Any] = Depends(json_body)):
    require_fields(body, ["thread_id", "user_id"])
    return summarize(get_thread(body["thread_id"], body["user_id"]), str(body["user_id"]))


@app.post("/threads/byUser")
def threads_by_user(_claims: Claims = Depends(require(["guest", "host"], own=["user_id"])), body: dict[str, Any] = Depends(json_body)):
    require_fields(body, ["user_id"])
    user_id = str(body["user_id"])
    d = db()
    # Rule 3: messages that now appear in the receiver's list are "delivered".
    d.messages.update_many({"receiver_id": user_id, "delivery_status": "sent"}, {"$set": {"delivery_status": "delivered"}})
    threads = [clean(t) for t in d.threads.find({"$or": [{"guest_id": user_id}, {"host_id": user_id}]})]
    items = [summarize(t, user_id) for t in threads]
    items.sort(key=lambda s: (s["last_message"] or {}).get("timestamp") or s["created_datetime"], reverse=True)
    return {"items": items}


@app.post("/messages/list")
def messages_list(_claims: Claims = Depends(require(["guest", "host"], own=["user_id"])), body: dict[str, Any] = Depends(json_body)):
    require_fields(body, ["thread_id", "user_id"])
    thread = get_thread(body["thread_id"], body["user_id"])
    d = db()
    # Rule 3: the receiver opened the conversation, so their incoming messages are "read".
    d.messages.update_many({"thread_id": thread["thread_id"], "receiver_id": body["user_id"]}, {"$set": {"delivery_status": "read"}})
    items = [message_json(m) for m in d.messages.find({"thread_id": thread["thread_id"]}).sort("timestamp", 1)]
    return {"items": items}


@app.post("/messages/send")
def messages_send(_claims: Claims = Depends(require(["guest", "host"], own=["sender_id"])), body: dict[str, Any] = Depends(json_body)):
    require_fields(body, ["thread_id", "sender_id", "message_text", "idempotency_key"])
    d = db()
    key = str(body["idempotency_key"])
    previous = d.message_keys.find_one({"idempotency_key": key})
    if previous:  # a retry of a send we already handled: the same message, 200
        return message_json(d.messages.find_one({"message_id": previous["message_id"]}))
    if not isinstance(body["message_text"], str):
        raise ApiError("VALIDATION_ERROR", "message_text must be text.")
    text = body["message_text"].strip()
    if not text:
        raise ApiError("VALIDATION_ERROR", "Type a message first.")
    if len(text) > MESSAGE_TEXT_MAX:
        raise ApiError("VALIDATION_ERROR", f"Messages can be at most {MESSAGE_TEXT_MAX} characters.")
    thread = get_thread(body["thread_id"], body["sender_id"])
    message = {
        "message_id": next_id("m"), "thread_id": thread["thread_id"], "sender_id": str(body["sender_id"]),
        "receiver_id": thread["host_id"] if body["sender_id"] == thread["guest_id"] else thread["guest_id"],
        "timestamp": iso_millis(), "message_text": text, "delivery_status": "sent",
    }
    try:
        d.message_keys.insert_one({"idempotency_key": key, "message_id": message["message_id"]})
    except Exception as problem:  # noqa: BLE001
        if is_duplicate(problem):  # the same key at the same instant: the other request won
            return message_json(d.messages.find_one({"message_id": d.message_keys.find_one({"idempotency_key": key})["message_id"]}))
        raise
    d.messages.insert_one(dict(message))
    trace_id = str(uuid.uuid4())
    try:
        publish("message.sent", make_envelope("message.sent", trace_id, message["sender_id"], "message", message["message_id"], message,
                                              idempotency_key=message["message_id"]), key=thread["thread_id"])
        emit_step(trace_id, "message.sent", SERVICE, 0, "ok")
    except Exception as problem:  # noqa: BLE001  (the message is stored; the event is for analytics)
        log.warning("could not publish message.sent for %s: %s", message["message_id"], problem)
    return JSONResponse(message_json(message), status_code=201)
