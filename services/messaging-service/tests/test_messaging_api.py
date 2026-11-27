"""Messaging Service rules (contract "Messaging Service", guide step 12)."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from msg_testkit import auth


@pytest.fixture()
def client(real_upstream):
    from messaging_service.main import app, seed_if_empty

    with TestClient(app) as c:
        seed_if_empty()
        yield c


def post(client, path, body, user):
    return client.post(path, json=body, headers=auth(user))


def test_seeded_threads_and_unread_counts(client):
    alex = post(client, "/threads/byUser", {"user_id": "g_001"}, "g_001").json()["items"]
    assert [t["thread_id"] for t in alex] == ["t_001"]
    assert alex[0]["unread_count"] == 1 and alex[0]["host_name"] == "Maya Ortiz" and alex[0]["property_title"] == "Santana Row Modern Condo"
    maya = post(client, "/threads/byUser", {"user_id": "h_001"}, "h_001").json()["items"]
    assert [t["thread_id"] for t in maya] == ["t_002", "t_001", "t_003"]  # most recent activity first


def test_alex_and_maya_exchange_messages_with_delivery_status(client, kafka):
    opened = post(client, "/threads/open", {"guest_id": "g_001", "host_id": "h_001", "property_id": "p_001", "actor_id": "g_001"}, "g_001")
    assert opened.status_code == 201
    thread = opened.json()
    assert (thread["guest_name"], thread["host_name"], thread["property_title"]) == ("Alex Chen", "Maya Ortiz", "Willow Glen Craftsman Cottage")
    again = post(client, "/threads/open", {"guest_id": "g_001", "host_id": "h_001", "property_id": "p_001", "actor_id": "g_001"}, "g_001")
    assert again.status_code == 200 and again.json()["thread_id"] == thread["thread_id"]  # one thread per guest + host + listing

    body = {"thread_id": thread["thread_id"], "sender_id": "g_001", "message_text": "  Hi Maya, is the driveway free?  ", "idempotency_key": "k-1"}
    sent = post(client, "/messages/send", body, "g_001")
    assert sent.status_code == 201
    message = sent.json()
    assert (message["delivery_status"], message["receiver_id"], message["message_text"]) == ("sent", "h_001", "Hi Maya, is the driveway free?")
    retry = post(client, "/messages/send", body, "g_001")
    assert retry.status_code == 200 and retry.json()["message_id"] == message["message_id"]  # idempotency

    maya_threads = post(client, "/threads/byUser", {"user_id": "h_001"}, "h_001").json()["items"]
    mine = next(t for t in maya_threads if t["thread_id"] == thread["thread_id"])
    assert mine["unread_count"] == 1 and maya_threads[0]["thread_id"] == thread["thread_id"]
    seen_by_alex = post(client, "/messages/list", {"thread_id": thread["thread_id"], "user_id": "g_001"}, "g_001").json()["items"]
    assert seen_by_alex[0]["delivery_status"] == "delivered"  # it showed in Maya's list
    post(client, "/messages/list", {"thread_id": thread["thread_id"], "user_id": "h_001"}, "h_001")
    seen_by_alex = post(client, "/messages/list", {"thread_id": thread["thread_id"], "user_id": "g_001"}, "g_001").json()["items"]
    assert seen_by_alex[0]["delivery_status"] == "read"  # Maya opened the conversation

    events = [m for m in kafka.messages("message.sent")]
    assert len(events) == 1 and events[0]["idempotency_key"] == message["message_id"] and events[0]["payload"]["message_text"].startswith("Hi Maya")


def test_host_cannot_cold_message_a_guest(client):
    r = post(client, "/threads/open", {"guest_id": "g_012", "host_id": "h_001", "property_id": "p_001", "actor_id": "h_001"}, "h_001")
    assert r.status_code == 403 and "reservation" in r.json()["error"]["message"]
    ok = post(client, "/threads/open", {"guest_id": "g_002", "host_id": "h_001", "property_id": "p_001", "actor_id": "h_001", "reservation_id": "r_003"}, "h_001")
    # Sam has a pending request there, so the host may; the seed already has their thread (t_002): 200, same thread
    assert ok.status_code == 200 and ok.json()["thread_id"] == "t_002" and ok.json()["reservation_id"] == "r_003"


def test_participants_only_and_validation(client):
    assert post(client, "/messages/list", {"thread_id": "t_001", "user_id": "g_002"}, "g_002").status_code == 403
    assert post(client, "/threads/get", {"thread_id": "t_001", "user_id": "g_002"}, "g_002").status_code == 403
    assert post(client, "/threads/get", {"thread_id": "t_999", "user_id": "g_001"}, "g_001").status_code == 404
    assert post(client, "/threads/byUser", {"user_id": "g_002"}, "g_001").status_code == 403  # someone else's id
    assert client.post("/threads/byUser", json={"user_id": "g_001"}).status_code == 401
    for text in ("   ", "x" * 2001):
        r = post(client, "/messages/send", {"thread_id": "t_001", "sender_id": "g_001", "message_text": text, "idempotency_key": text[:5] + "k"}, "g_001")
        assert r.status_code == 400
    wrong_host = post(client, "/threads/open", {"guest_id": "g_001", "host_id": "h_003", "property_id": "p_001", "actor_id": "g_001"}, "g_001")
    assert wrong_host.status_code == 400
    bad_reservation = post(client, "/threads/open", {"guest_id": "g_001", "host_id": "h_001", "property_id": "p_001", "actor_id": "g_001", "reservation_id": "r_008"}, "g_001")
    assert bad_reservation.status_code == 400
    missing = post(client, "/threads/open", {"guest_id": "g_001", "host_id": "h_001", "property_id": "p_404", "actor_id": "g_001"}, "g_001")
    assert missing.status_code == 404
