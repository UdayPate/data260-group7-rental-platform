"""Xenia Review Service (port 8005). Contract: docs/api/data-contract.md "Review Service".
Reference behaviour: frontend/src/mocks/handlers/reviews.ts.

    POST /reviews/create /reviews/get /reviews/byProperty /reviews/byGuest /reviews/respond

Storage: MongoDB `reviews` (spec 3.2), unique reservation_id (one review per stay).

Rules (team decisions):
  1. A review needs a `completed` reservation (409 INVALID_STATUS), written by that reservation's
     guest (403), once per reservation (409 DUPLICATE_REVIEW). The reservation is read from the
     Booking Service with the guest's own token.
  2. The listing's rating is NOT updated here: we publish `review.created` and Tanya's Property
     Service consumer updates rating and review_count (exactly once per review_id).
  3. Only the listing's host replies, once (409 DUPLICATE_REVIEW the second time).
  4. No editing, no deleting.

Run:   uvicorn review_service.main:app --port 8005
"""
from __future__ import annotations

import logging
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
from xenia_shared.timeutil import iso_seconds, utc_now
from xenia_shared.trace import emit_step
from xenia_shared.upstream import call
from xenia_shared.validation import check_paging, is_int, json_body, paged, require_fields

load_env()
log = logging.getLogger("xenia.review")
app = create_app("review-service")
SERVICE = "review-service"
REVIEW_TEXT_MIN, REVIEW_TEXT_MAX = 20, 1000
RESPONSE_TEXT_MIN, RESPONSE_TEXT_MAX = 10, 1000
REVIEW_FIELDS = ("review_id", "reservation_id", "property_id", "guest_id", "guest_name", "host_id", "rating", "review_text", "created_datetime", "response_text")


def db():
    return get_mongo()


@app.on_event("startup")
def _startup() -> None:
    ensure_indexes()
    if env_flag("SEED_ON_START", False):
        seed_if_empty()


def ensure_indexes() -> None:
    d = db()
    d.reviews.create_index("review_id", unique=True)
    d.reviews.create_index("reservation_id", unique=True)  # one review per reservation, even for two clicks at once
    d.reviews.create_index([("property_id", 1), ("created_datetime", -1)])
    d.reviews.create_index([("guest_id", 1), ("created_datetime", -1)])


def seed_if_empty() -> int:
    """The mock's 46 reviews (v_001-v_046, same text and replies). Does nothing if reviews exist.
    The seeded listings' rating/review_count already include them, so NO review.created is sent."""
    d = db()
    if d.reviews.count_documents({}) > 0:
        return 0
    reviews = load_seed("reviews", millis=False)
    d.reviews.insert_many([dict(r) for r in reviews])
    d.counters.update_one({"_id": "v"}, {"$max": {"value": len(reviews)}}, upsert=True)
    return len(reviews)


def next_review_id() -> str:
    row = db().counters.find_one_and_update({"_id": "v"}, {"$inc": {"value": 1}}, upsert=True, return_document=True)
    return f"v_{int(row['value']):03d}"


def review_json(r: dict[str, Any]) -> dict[str, Any]:
    return {k: r.get(k) for k in REVIEW_FIELDS}


def review_not_found(review_id: Any) -> ApiError:
    return ApiError("NOT_FOUND", f"No review found with id {review_id}.")


def text_length(value: Any) -> int:
    return len(value.strip()) if isinstance(value, str) else 0


def newest_first(query: dict[str, Any]) -> list[dict[str, Any]]:
    return [review_json(r) for r in db().reviews.find(query).sort([("created_datetime", -1), ("review_id", -1)])]


# ------------------------------------------------------------------ endpoints
@app.post("/reviews/create")
def reviews_create(request: Request, claims: Claims = Depends(require(["guest"], own=["guest_id"])), body: dict[str, Any] = Depends(json_body)):
    require_fields(body, ["reservation_id", "guest_id", "rating", "review_text"])
    if not is_int(body["rating"]) or not 1 <= body["rating"] <= 5:
        raise ApiError("VALIDATION_ERROR", "Pick a rating from 1 to 5 stars.")
    if not REVIEW_TEXT_MIN <= text_length(body["review_text"]) <= REVIEW_TEXT_MAX:
        raise ApiError("VALIDATION_ERROR", f"Please write between {REVIEW_TEXT_MIN} and {REVIEW_TEXT_MAX} characters.")
    token = bearer_token(request)
    reservation_id = str(body["reservation_id"])

    # The reservation, read with the guest's own token (the Booking Service also refuses someone else's).
    status, reservation = call("BOOKING_API_BASE_URL", "/bookings/get", {"reservation_id": reservation_id}, token)
    if status == 404:
        raise ApiError("NOT_FOUND", f"No reservation found with id {reservation_id}.")
    if status == 403 or (status == 200 and reservation["guest_id"] != claims.sub):
        raise ApiError("UNAUTHORIZED", "You can only review your own stays.")
    if status != 200:
        raise ApiError("SERVICE_UNAVAILABLE", "The booking could not be checked right now. Please try again in a moment.")
    if reservation["status"] != "completed":
        raise ApiError("INVALID_STATUS", "You can review a stay once it’s completed.")
    if db().reviews.find_one({"reservation_id": reservation_id}):
        raise ApiError("DUPLICATE_REVIEW", "You already reviewed this stay.")
    status, prop = call("PROPERTY_API_BASE_URL", "/properties/get", {"property_id": reservation["property_id"]}, None)
    if status != 200:
        raise ApiError("NOT_FOUND", "This listing no longer exists, so it can’t be reviewed.")
    status, guest = call("USER_API_BASE_URL", "/guests/get", {"guest_id": claims.sub}, token)
    guest_name = f"{guest['first_name']} {guest['last_name']}" if status == 200 else "Former guest"

    review = {
        "review_id": next_review_id(), "reservation_id": reservation_id, "property_id": prop["property_id"],
        "guest_id": claims.sub, "guest_name": guest_name, "host_id": prop["host_id"], "rating": int(body["rating"]),
        "review_text": body["review_text"].strip(), "created_datetime": iso_seconds(utc_now()), "response_text": None,
    }
    try:
        db().reviews.insert_one(dict(review))
    except Exception as problem:  # noqa: BLE001
        if is_duplicate(problem):  # a second click at the same instant
            raise ApiError("DUPLICATE_REVIEW", "You already reviewed this stay.") from problem
        raise
    # The reservation's own trace_id, so the review shows up in that booking's journey (spec 8).
    trace_id = reservation.get("trace_id") or review["review_id"]
    try:
        publish("review.created", make_envelope("review.created", trace_id, claims.sub, "review", review["review_id"], review,
                                                idempotency_key=review["review_id"]), key=review["property_id"])
        emit_step(trace_id, "review.created", SERVICE, 0, "ok")
    except Exception as problem:  # noqa: BLE001
        log.error("review %s stored but review.created could not be published: %s", review["review_id"], problem)
        emit_step(trace_id, "review.created", SERVICE, 0, "failed", str(problem))
    return JSONResponse(review_json(review), status_code=201)


@app.post("/reviews/get")
def reviews_get(_claims=Depends(require("public")), body: dict[str, Any] = Depends(json_body)):
    require_fields(body, ["review_id"])
    review = db().reviews.find_one({"review_id": body["review_id"]})
    if review is None:
        raise review_not_found(body["review_id"])
    return review_json(review)


@app.post("/reviews/byProperty")
def reviews_by_property(_claims=Depends(require("public")), body: dict[str, Any] = Depends(json_body)):
    require_fields(body, ["property_id"])
    check_paging(body.get("page"), body.get("page_size"))
    status, _prop = call("PROPERTY_API_BASE_URL", "/properties/get", {"property_id": body["property_id"]}, None)
    if status == 404:
        raise ApiError("NOT_FOUND", f"No property found with id {body['property_id']}.")
    items = newest_first({"property_id": body["property_id"]})
    page, size = int(body["page"]), int(body["page_size"])
    return paged(items[(page - 1) * size: page * size], len(items), page, size)


@app.post("/reviews/byGuest")
def reviews_by_guest(_claims=Depends(require(["guest"], own=["guest_id"])), body: dict[str, Any] = Depends(json_body)):
    require_fields(body, ["guest_id"])
    return {"items": newest_first({"guest_id": body["guest_id"]})}


@app.post("/reviews/respond")
def reviews_respond(_claims=Depends(require(["host"], own=["host_id"])), body: dict[str, Any] = Depends(json_body)):
    require_fields(body, ["review_id", "host_id", "response_text"])
    if not RESPONSE_TEXT_MIN <= text_length(body["response_text"]) <= RESPONSE_TEXT_MAX:
        raise ApiError("VALIDATION_ERROR", f"Please write between {RESPONSE_TEXT_MIN} and {RESPONSE_TEXT_MAX} characters.")
    review = clean(db().reviews.find_one({"review_id": body["review_id"]}))
    if review is None:
        raise review_not_found(body["review_id"])
    if review["host_id"] != body["host_id"]:
        raise ApiError("UNAUTHORIZED", "Only the host of this listing can reply to its reviews.")
    # Atomic "only if there is no reply yet", so two replies at once can't both win.
    from pymongo import ReturnDocument

    updated = db().reviews.find_one_and_update(
        {"review_id": review["review_id"], "response_text": None}, {"$set": {"response_text": body["response_text"].strip()}},
        return_document=ReturnDocument.AFTER,
    )
    if updated is None:
        raise ApiError("DUPLICATE_REVIEW", "You already replied to this review.")
    return review_json(updated)
