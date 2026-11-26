"""The Kafka consumers of the Property Service.

1. Live availability (step 10): every availability.blocked / availability.released message is sent to the
   sockets open for that property, and the Redis cache is invalidated. This consumer group is PER INSTANCE
   (property-ws-<hostname>), so when several copies run, each one sees every event for its own sockets.
2. Rating (step 13): review.created updates the listing's rating and review_count, exactly once per
   review (processed_events row in the SAME transaction), then invalidates the search cache.
"""
from __future__ import annotations

import logging
import os
import socket
import threading
from typing import Any

from xenia_shared.cache import get_cache
from xenia_shared.config import env_flag
from xenia_shared.db import execute, fetch_one, get_db
from xenia_shared.kafka import PermanentError, start_consumer_thread

from .realtime import hub

log = logging.getLogger("xenia.property.consumers")

SERVICE = "property-service"
AVAILABILITY_TOPICS = ["availability.blocked", "availability.released"]


def ws_group() -> str:
    return os.environ.get("WS_CONSUMER_GROUP") or f"property-ws-{socket.gethostname()}"


RATING_GROUP = "property-service-rating"


def handle_availability(envelope: dict[str, Any], _conn: Any):
    property_id = envelope["entity"]["entity_id"]

    def push() -> None:
        get_cache().invalidate_availability(property_id)  # the nights changed: availability answers + searches are stale
        hub.broadcast(property_id, envelope)

    return push


def handle_review_created(envelope: dict[str, Any], conn: Any):
    review = envelope["payload"]
    property_id, new_rating = review.get("property_id"), review.get("rating")
    if not isinstance(property_id, str) or isinstance(new_rating, bool) or not isinstance(new_rating, (int, float)) or not 1 <= new_rating <= 5:
        raise PermanentError("review.created needs payload.property_id and a payload.rating from 1 to 5")
    row = fetch_one(conn, "SELECT rating, review_count FROM properties WHERE property_id = %s FOR UPDATE", (property_id,))
    if row is None:
        log.warning("review %s is for unknown property %s; ignored", envelope["entity"]["entity_id"], property_id)
        return None
    old_rating, old_count = float(row["rating"]), int(row["review_count"])
    rating = round((old_rating * old_count + new_rating) / (old_count + 1), 2)
    execute(conn, "UPDATE properties SET rating = %s, review_count = %s WHERE property_id = %s", (rating, old_count + 1, property_id))
    return lambda: get_cache().invalidate_search()


def start_consumers() -> list[tuple[threading.Thread, threading.Event]]:
    """Start both consumer threads (switch off with RUN_CONSUMERS=off, e.g. to run them in their own process)."""
    if not env_flag("RUN_CONSUMERS", True):
        return []
    return [
        start_consumer_thread(AVAILABILITY_TOPICS, ws_group(), handle_availability, SERVICE, offset_reset="latest"),
        start_consumer_thread(["review.created"], RATING_GROUP, handle_review_created, SERVICE, db=get_db()),
    ]
