"""The Guest and Host entities as the contract (docs/api/data-contract.md section 3) describes them,
and the rules about their fields. Rows come from repository.py; these functions turn them into JSON."""
from __future__ import annotations

from typing import Any

from xenia_shared.db import jsonable, json_column
from xenia_shared.errors import ApiError
from xenia_shared.validation import is_email, is_number

MIN_PASSWORD_LENGTH = 8
MAX_PASSWORD_BYTES = 72  # bcrypt only looks at the first 72 bytes, so longer passwords are refused (not silently cut)

PROPERTY_TYPES = ["house", "apartment", "condo", "townhouse", "private_room", "guest_suite"]
AMENITIES = ["wifi", "kitchen", "parking", "washer", "dryer", "air_conditioning", "heating", "workspace", "pool", "hot_tub", "ev_charger"]

GUEST_EDITABLE = ["first_name", "last_name", "email", "phone", "location", "profile_photo_url", "preferences"]
HOST_EDITABLE = ["name", "email", "phone", "profile_photo_url"]


def guest_json(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "guest_id": row["guest_id"],
        "first_name": row["first_name"],
        "last_name": row["last_name"],
        "email": row["email"],
        "phone": row["phone"],
        "location": row["location"],
        "profile_photo_url": row["profile_photo_url"],
        "preferences": json_column(row["preferences"]),
        "saved_properties_count": int(row["saved_properties_count"]),
        "booking_count": int(row["booking_count"]),
        "profile_created_datetime": jsonable(row["profile_created_datetime"]),
    }


def host_json(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "host_id": row["host_id"],
        "name": row["name"],
        "email": row["email"],
        "phone": row["phone"],
        "profile_photo_url": row["profile_photo_url"],
        "verification_status": row["verification_status"],
        "response_rate": int(row["response_rate"]),
        "response_time": int(row["response_time"]),
        "host_since": jsonable(row["host_since"]),
        "access_level": row["access_level"],
    }


def default_preferences() -> dict[str, Any]:
    return {"preferred_locations": [], "max_nightly_price": None, "property_types": [], "amenities": []}


def clean_preferences(value: Any) -> dict[str, Any]:
    """Check a guest's preferences object and fill in anything left out."""
    if not isinstance(value, dict):
        raise ApiError("VALIDATION_ERROR", "preferences must be an object.")
    prefs = {**default_preferences(), **{k: v for k, v in value.items() if k in default_preferences()}}
    for name in ("preferred_locations", "property_types", "amenities"):
        if not isinstance(prefs[name], list) or any(not isinstance(item, str) for item in prefs[name]):
            raise ApiError("VALIDATION_ERROR", f"preferences.{name} must be a list of text values.")
    if prefs["max_nightly_price"] is not None and not (is_number(prefs["max_nightly_price"]) and prefs["max_nightly_price"] > 0):
        raise ApiError("VALIDATION_ERROR", "preferences.max_nightly_price must be a number above 0, or null.")
    if any(t not in PROPERTY_TYPES for t in prefs["property_types"]):
        raise ApiError("VALIDATION_ERROR", f"preferences.property_types may only contain: {', '.join(PROPERTY_TYPES)}.")
    if any(a not in AMENITIES for a in prefs["amenities"]):
        raise ApiError("VALIDATION_ERROR", f"preferences.amenities may only contain: {', '.join(AMENITIES)}.")
    return prefs


def check_text_fields(body: dict[str, Any], fields: list[str]) -> None:
    """Fields that are present must be text."""
    for field in fields:
        if field in body and body[field] is not None and not isinstance(body[field], str):
            raise ApiError("VALIDATION_ERROR", f"{field} must be text.")


def check_email(value: Any) -> None:
    if not is_email(value):
        raise ApiError("VALIDATION_ERROR", "Please enter a valid email address.")
