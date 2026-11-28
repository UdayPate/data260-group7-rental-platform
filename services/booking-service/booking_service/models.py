"""Reservation entity (contract section 3) and the booking rules' constants."""
from __future__ import annotations

from decimal import Decimal
from typing import Any

from xenia_shared.db import jsonable, number

STATUSES = ["processing", "pending", "approved", "declined", "cancelled", "completed", "failed"]
HOLDING = ("pending", "approved")  # these statuses hold the dates (contract section 5 rule 1)
HIDDEN_FROM_HOST = ("processing", "failed")  # the host never sees these: not in lists, 404 by id (contract)

DATE_CONFLICT_TEXT = "Some of these dates are no longer available. Please pick other dates."
EXPIRED_TEXT = "Expired: the host didn’t respond before check-in."


def price_breakdown(nightly_price: Decimal | int | float, cleaning_fee: Decimal | int | float, nights: int) -> dict[str, Any]:
    """The numbers of the price box. total = nights x nightly_price + cleaning_fee (no taxes, no service fee)."""
    subtotal = Decimal(str(nightly_price)) * nights
    return {"nights": nights, "nightly_price": Decimal(str(nightly_price)), "subtotal": subtotal, "cleaning_fee": Decimal(str(cleaning_fee)), "total": subtotal + Decimal(str(cleaning_fee))}


def reservation_json(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "reservation_id": row["reservation_id"],
        "trace_id": row["trace_id"],
        "property_id": row["property_id"],
        "guest_id": row["guest_id"],
        "check_in": jsonable(row["check_in"]),
        "check_out": jsonable(row["check_out"]),
        "guest_count": int(row["guest_count"]),
        "price_breakdown": {
            "nights": int(row["nights"]),
            "nightly_price": number(row["nightly_price"]),
            "subtotal": number(row["subtotal"]),
            "cleaning_fee": number(row["cleaning_fee"]),
            "total": number(row["total"]),
        },
        "booking_datetime": jsonable(row["booking_datetime"]),
        "status": row["status"],
        "cancellation_reason": row["cancellation_reason"],
        "failure_code": row["failure_code"],
        "guest_message": row["guest_message"],
    }
