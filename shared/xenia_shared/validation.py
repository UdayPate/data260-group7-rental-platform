"""Request-body helpers with the SAME rules and messages as the frontend mocks
(frontend/src/mocks/responses.ts), so the UI shows the same text from the real service."""
from __future__ import annotations

import json
import re
from datetime import date, datetime
from typing import Any

from fastapi import Request

from .errors import ApiError

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


async def json_body(request: Request) -> dict[str, Any]:
    """FastAPI dependency: the request body as a dict, or 400 if it is not a JSON object."""
    try:
        body = json.loads(await request.body())
    except ValueError:
        body = None
    if not isinstance(body, dict):
        raise ApiError("VALIDATION_ERROR", "The request body must be a JSON object.")
    return body


def require_fields(body: dict[str, Any], fields: list[str]) -> None:
    """400 if any field is missing, null or an empty string."""
    missing = [f for f in fields if body.get(f) is None or body.get(f) == ""]
    if missing:
        plural = "s" if len(missing) > 1 else ""
        raise ApiError("VALIDATION_ERROR", f"Missing required field{plural}: {', '.join(missing)}.", {"missing_fields": missing})


def is_email(value: Any) -> bool:
    return isinstance(value, str) and EMAIL_PATTERN.match(value) is not None


def is_int(value: Any) -> bool:
    """A whole number (JSON 3 or 3.0). Booleans are not numbers."""
    return not isinstance(value, bool) and (isinstance(value, int) or (isinstance(value, float) and value.is_integer()))


def is_number(value: Any) -> bool:
    return not isinstance(value, bool) and isinstance(value, (int, float))


def is_valid_date(value: Any) -> bool:
    """A real calendar date written YYYY-MM-DD (rejects '2026-13-40' and 'next week')."""
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return False
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        return False
    return True


def to_date(value: str) -> date:
    return datetime.strptime(value, "%Y-%m-%d").date()


def check_paging(page: Any, page_size: Any) -> None:
    if not is_int(page) or page < 1:
        raise ApiError("VALIDATION_ERROR", "page must be a whole number of 1 or more.")
    if not is_int(page_size) or page_size < 1 or page_size > 100:
        raise ApiError("VALIDATION_ERROR", "page_size must be a whole number from 1 to 100.")


def paged(items: list[Any], total: int, page: int, page_size: int) -> dict[str, Any]:
    return {"items": items, "total": total, "page": int(page), "page_size": int(page_size)}
