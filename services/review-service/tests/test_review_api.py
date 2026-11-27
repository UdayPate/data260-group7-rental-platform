"""Review Service rules (contract "Review Service", guide step 13), including Tanya's rating consumer."""
from __future__ import annotations

import json

import pytest
from fastapi.testclient import TestClient

from review_testkit import auth

TEXT = "Bright, quiet high-rise flat with a great view and easy check-in."


@pytest.fixture()
def client(real_upstream):
    from review_service.main import app, seed_if_empty

    with TestClient(app) as c:
        seed_if_empty()
        yield c


def post(client, path, body, user=None):
    return client.post(path, json=body, headers=auth(user) if user else {})


def test_seeded_reviews_newest_first_and_paged(client):
    page = post(client, "/reviews/byProperty", {"property_id": "p_001", "page": 1, "page_size": 3}).json()
    assert page["total"] == 5 and len(page["items"]) == 3 and page["items"][0]["review_id"] == "v_001"
    dates = [r["created_datetime"] for r in post(client, "/reviews/byProperty", {"property_id": "p_001", "page": 1, "page_size": 10}).json()["items"]]
    assert dates == sorted(dates, reverse=True)
    assert post(client, "/reviews/get", {"review_id": "v_001"}).json()["guest_name"] == "Emily Novak"
    assert post(client, "/reviews/byProperty", {"property_id": "p_404", "page": 1, "page_size": 3}).status_code == 404
    assert post(client, "/reviews/byProperty", {"property_id": "p_001", "page": 0, "page_size": 3}).status_code == 400


def test_alex_reviews_his_completed_stay_and_the_rating_updates(client, kafka, fresh_db):
    from property_service.consumers import RATING_GROUP, SERVICE, handle_review_created
    from xenia_shared.db import fetch_one
    from xenia_shared.kafka import Record, process_record

    with fresh_db.connection() as conn:
        before = fetch_one(conn, "SELECT rating, review_count FROM properties WHERE property_id = 'p_007'")
    created = post(client, "/reviews/create", {"reservation_id": "r_012", "guest_id": "g_001", "rating": 4, "review_text": TEXT}, "g_001")
    assert created.status_code == 201, created.text
    review = created.json()
    assert (review["property_id"], review["host_id"], review["guest_name"], review["response_text"]) == ("p_007", "h_002", "Alex Chen", None)
    duplicate = post(client, "/reviews/create", {"reservation_id": "r_012", "guest_id": "g_001", "rating": 5, "review_text": TEXT}, "g_001")
    assert duplicate.status_code == 409 and duplicate.json()["error"]["code"] == "DUPLICATE_REVIEW"

    events = kafka.messages("review.created")
    assert len(events) == 1 and events[0]["idempotency_key"] == review["review_id"]
    # Tanya's Property Service consumer applies it, exactly once (a redelivery changes nothing).
    record = Record("review.created", 0, 0, "p_007", json.dumps(events[0]).encode())
    assert process_record(record, RATING_GROUP, handle_review_created, SERVICE, fresh_db, kafka) == "processed"
    assert process_record(record, RATING_GROUP, handle_review_created, SERVICE, fresh_db, kafka) == "duplicate"
    with fresh_db.connection() as conn:
        after = fetch_one(conn, "SELECT rating, review_count FROM properties WHERE property_id = 'p_007'")
    assert after["review_count"] == before["review_count"] + 1
    assert float(after["rating"]) == round((float(before["rating"]) * before["review_count"] + 4) / (before["review_count"] + 1), 2)
    assert [r["review_id"] for r in post(client, "/reviews/byGuest", {"guest_id": "g_001"}, "g_001").json()["items"]] == [review["review_id"]]


def test_review_rules(client):
    def create(reservation, guest, rating=5, text=TEXT):
        return post(client, "/reviews/create", {"reservation_id": reservation, "guest_id": guest, "rating": rating, "review_text": text}, guest)

    assert create("r_012", "g_002").status_code == 403          # not Sam's stay
    assert create("r_008", "g_001").status_code == 409          # approved, not completed yet
    assert create("r_999", "g_001").status_code == 404
    assert create("r_012", "g_001", rating=6).status_code == 400
    assert create("r_012", "g_001", rating=4.5).status_code == 400
    assert create("r_012", "g_001", text="Too short.").status_code == 400
    assert post(client, "/reviews/create", {"reservation_id": "r_012", "guest_id": "g_002", "rating": 5, "review_text": TEXT}, "g_001").status_code == 403


def test_host_replies_once(client):
    reply = {"review_id": "v_003", "host_id": "h_001", "response_text": "Thank you, Fatima! Come back soon."}
    assert post(client, "/reviews/respond", {**reply, "host_id": "h_003"}, "h_003").status_code == 403  # not this listing's host
    assert post(client, "/reviews/respond", {**reply, "response_text": "Thanks"}, "h_001").status_code == 400
    done = post(client, "/reviews/respond", reply, "h_001")
    assert done.status_code == 200 and done.json()["response_text"] == reply["response_text"]
    again = post(client, "/reviews/respond", reply, "h_001")
    assert again.status_code == 409 and again.json()["error"]["code"] == "DUPLICATE_REVIEW"
    assert post(client, "/reviews/respond", reply, "g_001").status_code == 403  # guests can't reply
