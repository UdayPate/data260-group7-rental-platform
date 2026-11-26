"""The Property entity (contract section 3) and the rules about its fields."""
from __future__ import annotations

from typing import Any

from xenia_shared.db import jsonable, json_column, number
from xenia_shared.errors import ApiError
from xenia_shared.validation import is_int, is_number

PROPERTY_TYPES = ["house", "apartment", "condo", "townhouse", "private_room", "guest_suite"]
AMENITIES = ["wifi", "kitchen", "parking", "washer", "dryer", "air_conditioning", "heating", "workspace", "pool", "hot_tub", "ev_charger"]

REQUIRED_ON_CREATE = [
    "host_id", "title", "property_type", "address", "city", "state", "zip_code",
    "capacity", "bedrooms", "bathrooms", "nightly_price", "cleaning_fee",
]
# Everything except ids, owner, rating, review_count and created time can change (contract).
EDITABLE = [
    "title", "description", "property_type", "address", "city", "state", "zip_code", "latitude", "longitude",
    "capacity", "bedrooms", "bathrooms", "amenities", "nightly_price", "cleaning_fee", "status", "photo_url",
]


def property_json(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "property_id": row["property_id"],
        "host_id": row["host_id"],
        "title": row["title"],
        "description": row["description"],
        "property_type": row["property_type"],
        "address": row["address"],
        "city": row["city"],
        "state": row["state"],
        "zip_code": row["zip_code"],
        "latitude": number(row["latitude"]),
        "longitude": number(row["longitude"]),
        "capacity": int(row["capacity"]),
        "bedrooms": int(row["bedrooms"]),
        "bathrooms": number(row["bathrooms"]),
        "amenities": json_column(row["amenities"]),
        "nightly_price": number(row["nightly_price"]),
        "cleaning_fee": number(row["cleaning_fee"]),
        "status": row["status"],
        "rating": number(row["rating"]),
        "review_count": int(row["review_count"]),
        "created_datetime": jsonable(row["created_datetime"]),
        "photo_url": row["photo_url"],
    }


def check_property_fields(body: dict[str, Any]) -> None:
    """Check the listing fields that are present (used by create and update). Same messages as the mock."""
    if "property_type" in body and body["property_type"] not in PROPERTY_TYPES:
        raise ApiError("VALIDATION_ERROR", f"property_type must be one of: {', '.join(PROPERTY_TYPES)}.")
    if "amenities" in body:
        amenities = body["amenities"]
        if not isinstance(amenities, list) or any(a not in AMENITIES for a in amenities):
            raise ApiError("VALIDATION_ERROR", f"amenities may only contain: {', '.join(AMENITIES)}.")
    if "capacity" in body and (not is_int(body["capacity"]) or body["capacity"] < 1):
        raise ApiError("VALIDATION_ERROR", "capacity must be a whole number of at least 1.")
    if "bedrooms" in body and (not is_int(body["bedrooms"]) or body["bedrooms"] < 0):
        raise ApiError("VALIDATION_ERROR", "bedrooms must be a whole number (0 or more).")
    if "bathrooms" in body and not (is_number(body["bathrooms"]) and body["bathrooms"] >= 0 and (body["bathrooms"] * 2).is_integer()):
        raise ApiError("VALIDATION_ERROR", "bathrooms must be 0 or more (halves allowed, e.g. 1.5).")
    if "nightly_price" in body and not (is_number(body["nightly_price"]) and body["nightly_price"] > 0):
        raise ApiError("VALIDATION_ERROR", "nightly_price must be more than 0.")
    if "cleaning_fee" in body and not (is_number(body["cleaning_fee"]) and body["cleaning_fee"] >= 0):
        raise ApiError("VALIDATION_ERROR", "cleaning_fee must be 0 or more.")
    if "status" in body and body["status"] not in ("active", "inactive"):
        raise ApiError("VALIDATION_ERROR", 'status must be "active" or "inactive".')
    for field in ("title", "description", "address", "city", "state", "zip_code", "photo_url"):
        if field in body and body[field] is not None and not isinstance(body[field], str):
            raise ApiError("VALIDATION_ERROR", f"{field} must be text.")
    for field in ("latitude", "longitude"):
        if field in body and body[field] is not None and not is_number(body[field]):
            raise ApiError("VALIDATION_ERROR", f"{field} must be a number.")


def unique_amenities(amenities: list[str]) -> list[str]:
    """Keep the order, drop repeats."""
    return list(dict.fromkeys(amenities))
