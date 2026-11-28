"""Xenia Property Service (port 8002).

    POST /properties/create /get /update /delete /search /save /availability
    WS   /properties/{property_id}/availability/stream

Rules: docs/api/data-contract.md ("Property Service"). Reference behaviour: frontend/src/mocks/handlers/properties.ts.
Run:   uvicorn property_service.main:app --port 8002
"""
from __future__ import annotations

import logging
import uuid
from typing import Any

from fastapi import Depends, Response, WebSocket
from starlette.concurrency import run_in_threadpool

from xenia_shared import availability as avail
from xenia_shared.app import create_app
from xenia_shared.auth import Claims, claims_from_websocket_token, require
from xenia_shared.cache import get_cache
from xenia_shared.config import load_env
from xenia_shared.db import get_db, is_duplicate_key
from xenia_shared.envelope import make_envelope
from xenia_shared.errors import ApiError
from xenia_shared.kafka import KafkaUnavailable, publish
from xenia_shared.timeutil import today_utc, utc_now
from xenia_shared.validation import check_paging, is_int, is_number, is_valid_date, json_body, paged, require_fields, to_date

from . import consumers, models, repository
from .realtime import hub

load_env()
log = logging.getLogger("xenia.property")
app = create_app("property-service")
SERVICE = "property-service"


@app.on_event("startup")
def _start_consumers() -> None:
    app.state.consumers = consumers.start_consumers()


@app.on_event("shutdown")
def _stop_consumers() -> None:
    for _thread, stop in getattr(app.state, "consumers", []):
        stop.set()


def property_not_found(property_id: Any) -> ApiError:
    return ApiError("NOT_FOUND", f"No property found with id {property_id}.")


def not_owner(action: str) -> ApiError:
    return ApiError("UNAUTHORIZED", f"Only the host of this listing can {action} it.")


def safe_publish(topic: str, envelope: dict[str, Any]) -> bool:
    """Publish an event about something already saved. A Kafka outage must not undo or fail the change."""
    try:
        publish(topic, envelope)
        return True
    except KafkaUnavailable as problem:
        log.warning("Kafka unavailable, %s not published: %s", envelope["event_type"], problem)
        return False


# ------------------------------------------------------------------ create / get / update / delete
@app.post("/properties/create", status_code=201)
def properties_create(_claims=Depends(require(["host"], own=["host_id"])), body: dict[str, Any] = Depends(json_body)):
    require_fields(body, models.REQUIRED_ON_CREATE)
    models.check_property_fields(body)
    if "amenities" in body:
        body["amenities"] = models.unique_amenities(body["amenities"])
    db = get_db()
    with db.connection() as conn:
        if not repository.host_exists(conn, body["host_id"]):
            raise ApiError("NOT_FOUND", f"No host found with id {body['host_id']}.")
    with db.transaction() as conn:
        property_id = repository.insert_property(conn, db, body)
        row = repository.get_property(conn, property_id)
    get_cache().invalidate_search()
    return models.property_json(row)


@app.post("/properties/get")
def properties_get(_claims=Depends(require("public", own=["guest_id"])), body: dict[str, Any] = Depends(json_body)):
    require_fields(body, ["property_id"])
    with get_db().connection() as conn:
        row = repository.get_property(conn, body["property_id"])
        if row is None:
            raise property_not_found(body["property_id"])
        guest_id = body.get("guest_id")
        saved = bool(guest_id) and row["property_id"] in repository.saved_ids(conn, str(guest_id), [row["property_id"]])
    return {**models.property_json(row), "is_saved": saved}


@app.post("/properties/update")
def properties_update(_claims=Depends(require(["host"], own=["host_id"])), body: dict[str, Any] = Depends(json_body)):
    require_fields(body, ["property_id", "host_id"])
    db = get_db()
    with db.connection() as conn:
        row = repository.get_property(conn, body["property_id"])
    if row is None:
        raise property_not_found(body["property_id"])
    if row["host_id"] != body["host_id"]:
        raise not_owner("edit")
    models.check_property_fields(body)
    changes = {field: body[field] for field in models.EDITABLE if field in body and body[field] is not None}
    if "amenities" in changes:
        changes["amenities"] = models.unique_amenities(changes["amenities"])
    with db.transaction() as conn:
        repository.update_property(conn, body["property_id"], changes)
        updated = repository.get_property(conn, body["property_id"])
    get_cache().invalidate_search()  # price, status, amenities... any of them can change a search result
    return models.property_json(updated)


@app.post("/properties/delete")
def properties_delete(_claims=Depends(require(["host"], own=["host_id"])), body: dict[str, Any] = Depends(json_body)):
    require_fields(body, ["property_id", "host_id"])
    with get_db().transaction() as conn:
        row = repository.get_property(conn, body["property_id"], for_update=True)
        if row is None:
            raise property_not_found(body["property_id"])
        if row["host_id"] != body["host_id"]:
            raise not_owner("delete")
        upcoming = repository.upcoming_reservation_ids_for_property(conn, body["property_id"])
        if upcoming:
            raise ApiError(
                "INVALID_STATUS",
                f"This listing has {len(upcoming)} upcoming reservation(s). Decline or cancel them before deleting it.",
                {"reservation_ids": upcoming},
            )
        repository.delete_property(conn, body["property_id"])
    get_cache().invalidate_availability(body["property_id"])
    return {"property_id": body["property_id"], "deleted": True}


# ------------------------------------------------------------------ search
def normalise_search(body: dict[str, Any]) -> dict[str, Any]:
    """Validate the search request (same messages as the mock) and return the filters that decide the result."""
    check_paging(body.get("page"), body.get("page_size"))
    check_in, check_out = body.get("check_in"), body.get("check_out")
    if (check_in is None) != (check_out is None):
        raise ApiError("VALIDATION_ERROR", "Pick both a check-in and a check-out date.")
    if check_in is not None:
        if not is_valid_date(check_in) or not is_valid_date(check_out):
            raise ApiError("VALIDATION_ERROR", "Dates must be real dates in YYYY-MM-DD format.")
        if check_out <= check_in:
            raise ApiError("VALIDATION_ERROR", "Check-out must be after check-in.")
    if body.get("available_only") is True and check_in is None:
        raise ApiError("VALIDATION_ERROR", "Pick dates to see only available stays.")
    guest_count = body.get("guest_count")
    if guest_count is not None and (not is_int(guest_count) or guest_count < 1):
        raise ApiError("VALIDATION_ERROR", "Number of guests must be a whole number of at least 1.")
    for name in ("min_price", "max_price", "min_rating"):
        if body.get(name) is not None and not is_number(body[name]):
            raise ApiError("VALIDATION_ERROR", f"{name} must be a number.")
    if is_number(body.get("min_price")) and is_number(body.get("max_price")) and body["min_price"] > body["max_price"]:
        raise ApiError("VALIDATION_ERROR", "The minimum price can’t be higher than the maximum price.")
    if body.get("status") not in (None, "active", "inactive"):
        raise ApiError("VALIDATION_ERROR", 'status must be "active" or "inactive".')
    types, amenities = body.get("property_types") or [], body.get("amenities") or []
    if not isinstance(types, list) or any(t not in models.PROPERTY_TYPES for t in types):
        raise ApiError("VALIDATION_ERROR", f"property_types may only contain: {', '.join(models.PROPERTY_TYPES)}.")
    if not isinstance(amenities, list) or any(a not in models.AMENITIES for a in amenities):
        raise ApiError("VALIDATION_ERROR", f"amenities may only contain: {', '.join(models.AMENITIES)}.")
    location = body.get("location")
    if location is not None and not isinstance(location, str):
        raise ApiError("VALIDATION_ERROR", "location must be text.")
    host_id = body.get("host_id")
    return {
        "location": (location or "").strip() or None,
        "check_in": check_in,
        "check_out": check_out,
        "available_only": body.get("available_only") is True,
        "guest_count": guest_count,
        "min_price": body.get("min_price"),
        "max_price": body.get("max_price"),
        "min_rating": body.get("min_rating"),
        "property_types": sorted(set(types)),
        "amenities": sorted(set(amenities)),
        "host_id": str(host_id) if host_id else None,
        "status": body.get("status"),
        "page": int(body["page"]),
        "page_size": int(body["page_size"]),
    }


@app.post("/properties/search")
def properties_search(
    response: Response,
    _claims=Depends(require("public", own=["guest_id", "host_id"])),
    body: dict[str, Any] = Depends(json_body),
):
    filters = normalise_search(body)  # no guest_id in here: saves are per guest, so they are filled in below
    cache = get_cache()
    cached = cache.get_search(filters)
    response.headers["X-Cache"] = "HIT" if cached is not None else "MISS"
    with get_db().connection() as conn:
        if cached is None:
            rows, total = repository.search_properties(conn, filters)
            cached = {"items": [models.property_json(r) for r in rows], "total": total}
            cache.set_search(filters, cached)
        guest_id = body.get("guest_id")
        saved = repository.saved_ids(conn, str(guest_id), [p["property_id"] for p in cached["items"]]) if guest_id else set()
    items = [{**p, "is_saved": p["property_id"] in saved} for p in cached["items"]]
    return paged(items, cached["total"], filters["page"], filters["page_size"])


# ------------------------------------------------------------------ save
@app.post("/properties/save")
def properties_save(_claims=Depends(require(["guest"], own=["guest_id"])), body: dict[str, Any] = Depends(json_body)):
    require_fields(body, ["guest_id", "property_id", "saved"])
    if not isinstance(body["saved"], bool):
        raise ApiError("VALIDATION_ERROR", "saved must be true or false.")
    with get_db().transaction() as conn:
        if not repository.guest_exists(conn, body["guest_id"]):
            raise ApiError("NOT_FOUND", f"No guest found with id {body['guest_id']}.")
        if repository.get_property(conn, body["property_id"]) is None:
            raise property_not_found(body["property_id"])
        changed = repository.set_saved(conn, body["guest_id"], body["property_id"], body["saved"])  # saving twice changes nothing
        count = repository.saved_count(conn, body["guest_id"])
    if changed and body["saved"]:  # the host funnel counts saves (spec 6.1)
        safe_publish(
            "property.saved",
            make_envelope("property.saved", str(uuid.uuid4()), body["guest_id"], "property", body["property_id"], {"guest_id": body["guest_id"], "property_id": body["property_id"]}),
        )
    return {"property_id": body["property_id"], "saved": body["saved"], "saved_properties_count": count}


# ------------------------------------------------------------------ availability
def _availability_roles(body: dict[str, Any]):
    return "public" if body.get("action", "get") == "get" else ["host"]


def _publish_availability(event_type: str, block_row: dict[str, Any], reason: str) -> None:
    """Tell everyone (Kafka -> every instance's sockets). If Kafka is down, still push to the sockets of THIS instance."""
    envelope = avail.availability_envelope(event_type, block_row, reason, str(uuid.uuid4()), SERVICE)
    if not safe_publish(event_type, envelope):
        hub.broadcast(block_row["property_id"], envelope)


@app.post("/properties/availability")
def properties_availability(
    _claims: Claims | None = Depends(require(_availability_roles, own=["host_id"])),
    body: dict[str, Any] = Depends(json_body),
):
    action = body.get("action", "get")
    if action == "unblock":
        return _unblock(body)
    if action not in ("get", "block"):
        raise ApiError("VALIDATION_ERROR", 'action must be "get", "block" or "unblock".')
    require_fields(body, ["property_id", "host_id", "start_date", "end_date"] if action == "block" else ["property_id", "start_date", "end_date"])
    if not is_valid_date(body["start_date"]) or not is_valid_date(body["end_date"]):
        raise ApiError("VALIDATION_ERROR", "Dates must be real dates in YYYY-MM-DD format.")
    if body["end_date"] <= body["start_date"]:
        raise ApiError("VALIDATION_ERROR", "The end date must be after the start date.")
    start, end = to_date(body["start_date"]), to_date(body["end_date"])
    db = get_db()
    with db.connection() as conn:
        prop = repository.get_property(conn, body["property_id"])
    if prop is None:
        raise property_not_found(body["property_id"])
    if action == "get":
        return _get_availability(body["property_id"], body["start_date"], body["end_date"], start, end)
    return _block(db, prop, body, start, end)


def _get_availability(property_id: str, start_text: str, end_text: str, start, end) -> dict[str, Any]:
    cache = get_cache()
    items = cache.get_availability(property_id, start_text, end_text)
    if items is None:
        with get_db().connection() as conn:
            items = [avail.block_json(b) for b in avail.blocks_overlapping(conn, property_id, start, end)]
        cache.set_availability(property_id, start_text, end_text, items)
    return {"items": items}


def _block(db, prop: dict[str, Any], body: dict[str, Any], start, end) -> Any:
    from fastapi.responses import JSONResponse

    if prop["host_id"] != body["host_id"]:
        raise not_owner("change the calendar of")
    if start < today_utc():
        raise ApiError("VALIDATION_ERROR", "You can’t block dates in the past.")
    availability_id = db.next_id("a")
    try:
        # The block row AND one row per night, in one transaction. A taken night makes MySQL refuse (1062): the first writer wins.
        with db.transaction() as conn:
            avail.insert_block(conn, availability_id, prop["property_id"], start, end, "blocked", "host")
            row = avail.get_block(conn, availability_id)
    except Exception as problem:  # noqa: BLE001
        if not is_duplicate_key(problem):
            raise
        with db.connection() as conn:
            clash = avail.find_clash(conn, prop["property_id"], start, end)
        what = "a reservation" if clash and clash["source"] == "booking" else "one of your existing blocks"
        raise ApiError("DATE_CONFLICT", f"Some of these nights are already taken by {what}.", {"availability_id": clash["availability_id"] if clash else None}) from problem
    get_cache().invalidate_availability(prop["property_id"])
    _publish_availability("availability.blocked", row, "host_blocked")
    return JSONResponse(avail.block_json(row), status_code=201)


def _unblock(body: dict[str, Any]) -> dict[str, Any]:
    require_fields(body, ["availability_id", "host_id"])
    with get_db().transaction() as conn:
        block = avail.get_block(conn, body["availability_id"], for_update=True)
        if block is None:
            raise ApiError("NOT_FOUND", f"No availability block found with id {body['availability_id']}.")
        prop = repository.get_property(conn, block["property_id"])
        if prop is None or prop["host_id"] != body["host_id"]:
            raise not_owner("change the calendar of")
        if block["source"] != "host":
            raise ApiError("INVALID_STATUS", "These nights are held by a reservation. Decline or cancel that reservation to free them.")
        avail.delete_block(conn, body["availability_id"])
    get_cache().invalidate_availability(block["property_id"])
    released = {**block, "updated_datetime": utc_now().replace(tzinfo=None)}  # the moment of removal; the block itself is as it was
    _publish_availability("availability.released", released, "host_unblocked")
    return {"availability_id": block["availability_id"], "unblocked": True}


# ------------------------------------------------------------------ live availability (WebSocket)
@app.websocket("/properties/{property_id}/availability/stream")
async def availability_stream(websocket: WebSocket, property_id: str):
    await websocket.accept()  # accept first, THEN close with our own code (closing before accept would show as 403)
    try:
        claims_from_websocket_token(websocket.query_params.get("token"))
    except ApiError:
        await websocket.close(code=4401)
        return

    def exists() -> bool:
        with get_db().connection() as conn:
            return repository.get_property(conn, property_id) is not None

    if not await run_in_threadpool(exists):
        await websocket.close(code=4404)
        return
    hub.add(property_id, websocket)
    try:
        while True:
            await websocket.receive_text()  # nothing is expected from the page; this just notices when it goes away
    except Exception:  # noqa: BLE001  (WebSocketDisconnect or a broken connection)
        pass
    finally:
        hub.remove(property_id, websocket)
