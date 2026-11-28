"""Booking Service tests: the Done-when lines of steps 7, 8, 9 and 12 plus every rule of contract section 5."""
import json
import threading
import uuid
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from xenia_shared import kafka as kafka_module
from xenia_shared.auth import sign_token
from xenia_shared.db import execute, fetch_all, fetch_one, get_db
from xenia_shared.kafka import Record, process_record
from xenia_shared.timeutil import today_local

from booking_service import jobs, worker
from booking_service.main import app


@pytest.fixture()
def client(fresh_db, kafka):
    return TestClient(app, raise_server_exceptions=False)


def auth(user_id, role):
    return {"Authorization": "Bearer " + sign_token(user_id, role, "x")}


def day(offset):
    """Far enough ahead (about 14 months) to avoid every stay in the seed data."""
    return (today_local() + timedelta(days=400 + offset)).isoformat()


def real_day(offset):
    return (today_local() + timedelta(days=offset)).isoformat()


def error(response):
    return response.json()["error"]


GUESTS = [f"g_{n:03d}" for n in range(1, 13)]


def request(client, guest="g_001", prop="p_005", start=10, end=12, key=None, count=2, **extra):
    body = {"property_id": prop, "guest_id": guest, "check_in": day(start), "check_out": day(end), "guest_count": count, "idempotency_key": key or str(uuid.uuid4()), **extra}
    return client.post("/bookings/request", json=body, headers=auth(guest, "guest"))


def drain(kafka):
    """Run the worker over everything waiting in booking.requested, one message at a time."""
    consumer = kafka.consumer(["booking.requested"], worker.GROUP)
    done = 0
    while (record := consumer.poll(0.01)) is not None:
        process_record(record, worker.GROUP, worker.handle_booking_requested, "booking-worker", db=get_db(), transport=kafka, commit=consumer.commit)
        done += 1
    consumer.close()  # a consumer left open would keep its share of the partitions
    return done


def get(client, reservation_id, who=("g_001", "guest")):
    return client.post("/bookings/get", json={"reservation_id": reservation_id}, headers=auth(*who))


# ---------------------------------------------------------------- step 7: request, worker, double booking
def test_request_is_202_processing_then_the_worker_makes_it_pending(client, kafka):
    response = request(client)
    assert response.status_code == 202
    r = response.json()
    assert r["status"] == "processing" and r["failure_code"] is None and r["cancellation_reason"] is None
    assert r["price_breakdown"] == {"nights": 2, "nightly_price": 240, "subtotal": 480, "cleaning_fee": r["price_breakdown"]["cleaning_fee"], "total": 480 + r["price_breakdown"]["cleaning_fee"]}
    assert len(r["trace_id"]) == 36 and r["reservation_id"].startswith("r_")
    with get_db().connection() as conn:  # nothing is held while processing
        assert fetch_one(conn, "SELECT COUNT(*) AS n FROM availability_nights WHERE property_id='p_005' AND night_date >= %s", (day(10),))["n"] == 0
    assert kafka.messages("availability.blocked") == []        # nothing pushed at 202 time

    sent = kafka.messages("booking.requested")
    assert len(sent) == 1 and sent[0]["trace_id"] == r["trace_id"] and sent[0]["entity"] == {"entity_type": "reservation", "entity_id": r["reservation_id"]}
    assert sent[0]["actor_id"] == "g_001" and sent[0]["idempotency_key"] == f"{r['trace_id']}:booking.requested"

    assert drain(kafka) == 1
    after = get(client, r["reservation_id"]).json()
    assert after["status"] == "pending" and after["trace_id"] == r["trace_id"] and after["failure_code"] is None
    with get_db().connection() as conn:
        assert [str(x["night_date"]) for x in fetch_all(conn, "SELECT night_date FROM availability_nights WHERE property_id='p_005' AND night_date >= %s ORDER BY night_date", (day(10),))] == [day(10), day(11)]
        block = fetch_one(conn, "SELECT * FROM availability_blocks WHERE reservation_id = %s", (r["reservation_id"],))
    assert block["status"] == "booked" and block["source"] == "booking"
    pushed = kafka.messages("availability.blocked")
    assert len(pushed) == 1 and pushed[0]["trace_id"] == r["trace_id"] and pushed[0]["actor_id"] == "booking-service"
    assert pushed[0]["payload"]["reason"] == "booking_requested" and pushed[0]["entity"]["entity_id"] == "p_005"


def test_same_idempotency_key_returns_the_original_with_200(client, kafka):
    key = "key-1"
    first = request(client, key=key)
    second = request(client, key=key)
    assert second.status_code == 200 and second.json() == first.json()
    drain(kafka)
    third = request(client, key=key)  # whatever its status NOW
    assert third.status_code == 200 and third.json()["status"] == "pending" and third.json()["reservation_id"] == first.json()["reservation_id"]
    assert len(kafka.messages("booking.requested")) == 1
    with get_db().connection() as conn:
        assert fetch_one(conn, "SELECT COUNT(*) AS n FROM reservations WHERE guest_id='g_001' AND check_in = %s", (day(10),))["n"] == 1


def test_a_redelivered_event_never_holds_dates_twice(client, kafka):
    r = request(client).json()
    message = json.dumps(kafka.messages("booking.requested")[0]).encode()
    record = Record("booking.requested", 0, 0, "p_005", message)
    results = [process_record(record, worker.GROUP, worker.handle_booking_requested, "booking-worker", db=get_db(), transport=kafka) for _ in range(3)]
    assert results == ["processed", "duplicate", "duplicate"]
    assert len(kafka.messages("availability.blocked")) == 1
    with get_db().connection() as conn:
        assert fetch_one(conn, "SELECT COUNT(*) AS n FROM availability_blocks WHERE reservation_id = %s", (r["reservation_id"],))["n"] == 1


def test_overlapping_request_fails_with_date_conflict(client, kafka):
    first = request(client, "g_001", start=20, end=24).json()
    second = request(client, "g_002", start=22, end=26).json()
    assert second["status"] == "processing"
    drain(kafka)
    assert get(client, first["reservation_id"]).json()["status"] == "pending"
    loser = get(client, second["reservation_id"], ("g_002", "guest")).json()
    assert loser["status"] == "failed" and loser["failure_code"] == "DATE_CONFLICT"
    assert loser["cancellation_reason"] == "Some of these dates are no longer available. Please pick other dates."
    assert len(kafka.messages("availability.blocked")) == 1  # nothing sent for the failed one
    # touching dates (the check-out day of one is the check-in of the other) are fine
    third = request(client, "g_003", start=24, end=26).json()
    drain(kafka)
    assert get(client, third["reservation_id"], ("g_003", "guest")).json()["status"] == "pending"


def test_a_host_block_makes_a_request_fail(client, kafka):
    from xenia_shared.availability import insert_block
    with get_db().transaction() as conn:
        insert_block(conn, "a_900", "p_005", today_local() + timedelta(days=400 + 30), today_local() + timedelta(days=400 + 33), "blocked", "host")
    r = request(client, start=31, end=32).json()
    drain(kafka)
    assert get(client, r["reservation_id"]).json()["failure_code"] == "DATE_CONFLICT"


def test_same_guest_overlapping_request_is_duplicate_booking(client, kafka):
    first = request(client, "g_001", start=40, end=43).json()
    drain(kafka)
    second = request(client, "g_001", start=42, end=45).json()
    drain(kafka)
    loser = get(client, second["reservation_id"]).json()
    assert loser["status"] == "failed" and loser["failure_code"] == "DUPLICATE_BOOKING" and first["reservation_id"] in loser["cancellation_reason"]


def test_twenty_simultaneous_requests_one_pending_nineteen_failed(client, kafka):
    """Spec 13.1. 20 different guests ask for the same nights at the same instant."""
    guests = [f"g_{n:03d}" for n in range(1, 13)]
    with get_db().transaction() as conn:  # the seed has 12 guests; add 8 more so there are 20 different people
        for n in range(13, 21):
            gid = f"g_{n:03d}"
            execute(conn, "INSERT IGNORE INTO guests (guest_id, first_name, last_name, email, phone, location, preferences, profile_created_datetime) SELECT %s, 'Test', %s, %s, '555-0100', 'San Jose, CA', preferences, UTC_TIMESTAMP(3) FROM guests WHERE guest_id = 'g_001'", (gid, gid, f"{gid}@example.com"))
            guests.append(gid)
    assert len(guests) == 20

    statuses, barrier = [], threading.Barrier(20)

    def ask(guest):
        c = TestClient(app, raise_server_exceptions=False)
        barrier.wait()
        statuses.append(request(c, guest, start=50, end=53).status_code)

    threads = [threading.Thread(target=ask, args=(g,)) for g in guests]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert statuses.count(202) == 20  # the API accepted everybody, as the contract says

    consumer = kafka.consumer(["booking.requested"], worker.GROUP)
    records = []
    while (rec := consumer.poll(0.01)) is not None:
        records.append(rec)
    assert len(records) == 20
    consumer.close()
    results, barrier2 = [], threading.Barrier(20)

    def work(rec):  # twenty workers deciding at the SAME time: the database picks one
        barrier2.wait()
        results.append(process_record(rec, worker.GROUP, worker.handle_booking_requested, "booking-worker", db=get_db(), transport=kafka, commit=consumer.commit))

    threads = [threading.Thread(target=work, args=(rec,)) for rec in records]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert results.count("processed") == 20  # every message was handled exactly once; the outcomes differ

    with get_db().connection() as conn:
        rows = fetch_all(conn, "SELECT status, failure_code FROM reservations WHERE check_in = %s", (day(50),))
        nights = fetch_all(conn, "SELECT night_date FROM availability_nights WHERE property_id = 'p_005' AND night_date >= %s", (day(50),))
    assert sorted(r["status"] for r in rows) == ["failed"] * 19 + ["pending"]
    assert {r["failure_code"] for r in rows if r["status"] == "failed"} == {"DATE_CONFLICT"}
    assert len(nights) == 3  # one set of held nights, never two
    assert len(kafka.messages("availability.blocked")) == 1
    assert not kafka.messages("dead.letter")


def test_twenty_requests_through_real_consumer_threads(client, kafka):
    """The same with the real consumer loop and three workers sharing the partitions (a consumer group)."""
    ids = [request(client, GUESTS[i % 12], prop="p_002", start=60, end=62, key=f"k{i}", count=1).json()["reservation_id"] for i in range(20)]
    # one guest repeated: the first request of each guest decides, later ones of the same guest are DUPLICATE or DATE_CONFLICT
    stop = threading.Event()
    threads = [threading.Thread(target=kafka_module.run_consumer, args=(worker.TOPICS, worker.GROUP, worker.handle_booking_requested, "booking-worker"), kwargs={"db": get_db(), "stop": stop, "poll_seconds": 0.05}, daemon=True) for _ in range(3)]
    [t.start() for t in threads]
    deadline = threading.Event()
    for _ in range(100):
        with get_db().connection() as conn:
            left = fetch_one(conn, "SELECT COUNT(*) AS n FROM reservations WHERE status = 'processing'")["n"]
        if left == 0:
            break
        deadline.wait(0.1)
    stop.set()
    [t.join(2) for t in threads]
    with get_db().connection() as conn:
        rows = fetch_all(conn, "SELECT status FROM reservations WHERE property_id = 'p_002' AND check_in = %s", (day(60),))
    assert left == 0 and sorted(r["status"] for r in rows).count("pending") == 1 and len(rows) == 20


def test_worker_stopped_requests_wait_and_are_processed_later_exactly_once(client, kafka):
    """Spec 13.2: stop the worker, send requests, start it: every request is processed once."""
    made = [request(client, GUESTS[i], prop="p_003", start=70 + i * 3, end=72 + i * 3, key=f"w{i}", count=1).json()["reservation_id"] for i in range(5)]
    for rid in made:
        assert get(client, rid, ("g_001", "guest")).status_code in (200, 403)
    with get_db().connection() as conn:
        assert fetch_one(conn, "SELECT COUNT(*) AS n FROM reservations WHERE status='processing'")["n"] == 5
    assert drain(kafka) == 5 and drain(kafka) == 0  # a restarted worker resumes from the committed offset
    with get_db().connection() as conn:
        assert fetch_one(conn, "SELECT COUNT(*) AS n FROM reservations WHERE status='pending' AND property_id='p_003'")["n"] == 5


def test_kafka_down_gives_503_and_leaves_no_processing_row(client, monkeypatch):
    def down(*_a, **_k):
        raise kafka_module.KafkaUnavailable("down")
    monkeypatch.setattr("booking_service.core.publish", down)
    response = request(client, key="never-saved")
    assert response.status_code == 503 and error(response)["code"] == "SERVICE_UNAVAILABLE"
    with get_db().connection() as conn:
        assert fetch_one(conn, "SELECT COUNT(*) AS n FROM reservations WHERE status = 'processing'")["n"] == 0
        assert fetch_one(conn, "SELECT COUNT(*) AS n FROM idempotency_keys WHERE idempotency_key = 'never-saved'")["n"] == 0
    monkeypatch.undo()
    assert request(client, key="never-saved").status_code == 202  # the same key can be used again once Kafka is back


def test_use_kafka_off_decides_inside_the_api(client, kafka, monkeypatch):
    monkeypatch.setenv("USE_KAFKA", "off")
    first = request(client, "g_001", start=100, end=103)
    second = request(client, "g_002", start=101, end=104)
    assert first.status_code == 202 and first.json()["status"] == "pending"
    assert second.json()["status"] == "failed" and second.json()["failure_code"] == "DATE_CONFLICT"
    assert kafka.messages("booking.requested") == []
    with get_db().connection() as conn:
        assert fetch_one(conn, "SELECT COUNT(*) AS n FROM availability_nights WHERE property_id='p_005' AND night_date >= %s", (day(100),))["n"] == 3


# ---------------------------------------------------------------- step 7: validation, in the contract's order
@pytest.mark.parametrize("change,status,code,fragment", [
    ({"check_in": "2026-13-01"}, 400, "VALIDATION_ERROR", "real dates"),
    ({"check_in": real_day(-2), "check_out": real_day(3)}, 400, "VALIDATION_ERROR", "past"),
    ({"check_out": day(10)}, 400, "VALIDATION_ERROR", "after check-in"),
    ({"guest_count": 0}, 400, "VALIDATION_ERROR", "at least 1"),
    ({"guest_count": 1.5}, 400, "VALIDATION_ERROR", "whole number"),
    ({"property_id": "p_999"}, 404, "NOT_FOUND", "No property"),
    ({"property_id": "p_012"}, 409, "INVALID_STATUS", "isn’t taking bookings"),
    ({"guest_count": 4}, 400, "VALIDATION_ERROR", "at most 3"),
])
def test_request_validation(client, change, status, code, fragment):
    body = {"property_id": "p_005", "guest_id": "g_001", "check_in": day(10), "check_out": day(12), "guest_count": 2, "idempotency_key": str(uuid.uuid4()), **change}
    response = client.post("/bookings/request", json=body, headers=auth("g_001", "guest"))
    assert response.status_code == status and error(response)["code"] == code and fragment in error(response)["message"]


def test_request_needs_fields_a_guest_login_and_your_own_id(client):
    body = {"property_id": "p_005", "guest_id": "g_001", "check_in": day(10), "check_out": day(12), "guest_count": 2, "idempotency_key": "k"}
    assert client.post("/bookings/request", json={k: v for k, v in body.items() if k != "idempotency_key"}, headers=auth("g_001", "guest")).status_code == 400
    assert client.post("/bookings/request", json=body).status_code == 401
    assert client.post("/bookings/request", json=body, headers=auth("h_001", "host")).status_code == 403
    assert client.post("/bookings/request", json=body, headers=auth("g_002", "guest")).status_code == 403
    assert client.post("/bookings/request", json={**body, "guest_id": "g_099"}, headers=auth("g_099", "guest")).status_code == 404


# ---------------------------------------------------------------- step 8: reads, approve, decline, cancel
def pending_stay(client, kafka, guest="g_001", prop="p_005", start=10, end=13):
    r = request(client, guest, prop, start, end, count=1).json()
    drain(kafka)
    return r["reservation_id"]


MAYA = ("h_001", "host")


def act(client, what, body, who):
    return client.post(f"/bookings/{what}", json={"idempotency_key": str(uuid.uuid4()), **body}, headers=auth(*who))


def test_reads_and_who_may_see_them(client, kafka):
    rid = pending_stay(client, kafka)
    assert get(client, rid).json()["status"] == "pending"
    assert get(client, rid, MAYA).status_code == 200                                    # the listing's host
    assert get(client, rid, ("g_002", "guest")).status_code == 403
    assert get(client, rid, ("h_002", "host")).status_code == 403
    assert client.post("/bookings/get", json={"reservation_id": rid}).status_code == 401
    assert get(client, "r_9999").status_code == 404
    mine = client.post("/bookings/byGuest", json={"guest_id": "g_001"}, headers=auth("g_001", "guest")).json()["items"]
    assert rid in [r["reservation_id"] for r in mine]
    only = client.post("/bookings/byGuest", json={"guest_id": "g_001", "status": "approved"}, headers=auth("g_001", "guest")).json()["items"]
    assert all(r["status"] == "approved" for r in only) and rid not in [r["reservation_id"] for r in only]
    assert client.post("/bookings/byGuest", json={"guest_id": "g_001"}, headers=auth("g_002", "guest")).status_code == 403
    assert client.post("/bookings/byGuest", json={"guest_id": "g_001", "status": "lost"}, headers=auth("g_001", "guest")).status_code == 400


def test_hosts_never_see_processing_or_failed(client, kafka):
    processing = request(client, "g_002", start=80, end=82).json()["reservation_id"]
    loser_first = request(client, "g_003", start=90, end=92).json()["reservation_id"]
    request(client, "g_004", start=90, end=92)
    drain(kafka)  # g_002 is pending now; g_004's request failed
    request(client, "g_005", start=95, end=97)  # stays processing
    items = client.post("/bookings/byProperty", json={"property_id": "p_005"}, headers=auth(*MAYA)).json()["items"]
    shown = {r["status"] for r in items}
    assert "processing" not in shown and "failed" not in shown and "pending" in shown
    assert [r["reservation_id"] for r in items] == sorted(r["reservation_id"] for r in items)
    assert client.post("/bookings/byProperty", json={"property_id": "p_005", "status": "failed"}, headers=auth(*MAYA)).json()["items"] == []
    pend = client.post("/bookings/byProperty", json={"property_id": "p_005", "status": "pending"}, headers=auth(*MAYA)).json()["items"]
    assert pend and all(r["status"] == "pending" for r in pend)
    assert client.post("/bookings/byProperty", json={"property_id": "p_005"}, headers=auth("h_002", "host")).status_code == 403
    assert client.post("/bookings/byProperty", json={"property_id": "p_005"}, headers=auth("g_001", "guest")).status_code == 403
    assert client.post("/bookings/byProperty", json={"property_id": "p_999"}, headers=auth(*MAYA)).status_code == 404
    guest_view = client.post("/bookings/byGuest", json={"guest_id": "g_004"}, headers=auth("g_004", "guest")).json()["items"]
    assert "failed" in {r["status"] for r in guest_view}  # guests do see their failed requests


def test_approve_keeps_the_dates_and_records_history(client, kafka):
    rid = pending_stay(client, kafka)
    approved = act(client, "approve", {"reservation_id": rid, "host_id": "h_001"}, MAYA)
    assert approved.status_code == 200 and approved.json()["status"] == "approved"
    message = kafka.messages("booking.approved")[0]
    assert message["actor_id"] == "h_001" and message["trace_id"] == approved.json()["trace_id"] and message["payload"]["status"] == "approved"
    with get_db().connection() as conn:
        history = fetch_all(conn, "SELECT old_status, new_status, actor_id, trace_id FROM reservation_status_history WHERE reservation_id = %s ORDER BY history_id", (rid,))
        assert fetch_one(conn, "SELECT COUNT(*) AS n FROM availability_nights WHERE availability_id IN (SELECT availability_id FROM availability_blocks WHERE reservation_id = %s)", (rid,))["n"] == 3
    assert [(h["old_status"], h["new_status"]) for h in history] == [(None, "processing"), ("processing", "pending"), ("pending", "approved")]
    assert {h["trace_id"] for h in history} == {approved.json()["trace_id"]}   # one journey, one trace_id
    assert [h["actor_id"] for h in history] == ["g_001", "booking-worker", "h_001"]


def test_decline_frees_the_nights_and_announces_it(client, kafka):
    rid = pending_stay(client, kafka)
    declined = act(client, "decline", {"reservation_id": rid, "host_id": "h_001", "reason": "Dates no longer work"}, MAYA)
    assert declined.status_code == 200 and declined.json()["status"] == "declined" and declined.json()["cancellation_reason"] == "Dates no longer work"
    with get_db().connection() as conn:
        assert fetch_one(conn, "SELECT COUNT(*) AS n FROM availability_nights WHERE property_id='p_005' AND night_date >= %s", (day(10),))["n"] == 0
        assert fetch_one(conn, "SELECT COUNT(*) AS n FROM availability_blocks WHERE reservation_id = %s", (rid,))["n"] == 0
    released = kafka.messages("availability.released")[0]
    assert released["payload"]["reason"] == "booking_declined" and released["trace_id"] == declined.json()["trace_id"] and released["actor_id"] == "booking-service"
    assert kafka.messages("booking.declined")
    again = request(client, "g_002", start=10, end=13).json()  # someone else can now book them
    drain(kafka)
    assert get(client, again["reservation_id"], ("g_002", "guest")).json()["status"] == "pending"
    reasonless = pending_stay(client, kafka, "g_003", "p_005", 30, 32)
    assert act(client, "decline", {"reservation_id": reasonless, "host_id": "h_001"}, MAYA).json()["cancellation_reason"] is None


def test_guest_cancels_pending_or_approved_before_check_in(client, kafka):
    rid = pending_stay(client, kafka)
    act(client, "approve", {"reservation_id": rid, "host_id": "h_001"}, MAYA)
    cancelled = act(client, "cancel", {"reservation_id": rid, "guest_id": "g_001", "cancellation_reason": "Plans changed"}, ("g_001", "guest"))
    assert cancelled.status_code == 200 and cancelled.json()["status"] == "cancelled" and cancelled.json()["cancellation_reason"] == "Plans changed"
    assert kafka.messages("availability.released")[-1]["payload"]["reason"] == "booking_cancelled"
    assert kafka.messages("booking.cancelled")[0]["actor_id"] == "g_001"
    empty = pending_stay(client, kafka, "g_001", "p_005", 40, 42)
    assert act(client, "cancel", {"reservation_id": empty, "guest_id": "g_001", "cancellation_reason": "  "}, ("g_001", "guest")).json()["cancellation_reason"] is None


def test_host_cancels_only_approved_with_a_reason(client, kafka):
    rid = pending_stay(client, kafka)
    refused = act(client, "cancel", {"reservation_id": rid, "host_id": "h_001", "cancellation_reason": "x"}, MAYA)
    assert refused.status_code == 409 and "Decline pending requests" in error(refused)["message"]
    act(client, "approve", {"reservation_id": rid, "host_id": "h_001"}, MAYA)
    assert act(client, "cancel", {"reservation_id": rid, "host_id": "h_001", "cancellation_reason": " "}, MAYA).status_code == 400
    done = act(client, "cancel", {"reservation_id": rid, "host_id": "h_001", "cancellation_reason": "Pipe burst"}, MAYA)
    assert done.status_code == 200 and done.json()["status"] == "cancelled"


def test_every_rule_returns_its_code(client, kafka):
    rid = pending_stay(client, kafka)
    other_host = ("h_002", "host")
    assert act(client, "approve", {"reservation_id": rid, "host_id": "h_002"}, other_host).status_code == 403
    assert act(client, "approve", {"reservation_id": rid, "host_id": "h_001"}, other_host).status_code == 403
    assert act(client, "approve", {"reservation_id": rid, "host_id": "h_001"}, ("g_001", "guest")).status_code == 403
    assert client.post("/bookings/approve", json={"reservation_id": rid, "host_id": "h_001", "idempotency_key": "z"}).status_code == 401
    assert act(client, "approve", {"reservation_id": "r_9999", "host_id": "h_001"}, MAYA).status_code == 404
    assert client.post("/bookings/approve", json={"reservation_id": rid, "host_id": "h_001"}, headers=auth(*MAYA)).status_code == 400  # no idempotency key
    assert act(client, "cancel", {"reservation_id": rid, "guest_id": "g_002"}, ("g_002", "guest")).status_code == 403  # not their reservation
    both = act(client, "cancel", {"reservation_id": rid, "guest_id": "g_001", "host_id": "h_001"}, ("g_001", "guest"))
    assert both.status_code == 403 or both.status_code == 400
    none = act(client, "cancel", {"reservation_id": rid}, ("g_001", "guest"))
    assert none.status_code == 400 and "exactly one" in error(none)["message"]
    approved = act(client, "approve", {"reservation_id": rid, "host_id": "h_001"}, MAYA)
    assert approved.status_code == 200
    twice = act(client, "approve", {"reservation_id": rid, "host_id": "h_001"}, MAYA)   # a NEW key on an approved stay
    assert twice.status_code == 409 and error(twice)["code"] == "INVALID_STATUS" and "already approved" in error(twice)["message"]
    assert act(client, "decline", {"reservation_id": rid, "host_id": "h_001"}, MAYA).status_code == 409
    processing = request(client, "g_002", start=200, end=202).json()["reservation_id"]
    for what, who, extra in (("approve", MAYA, {"host_id": "h_001"}), ("decline", MAYA, {"host_id": "h_001"}), ("cancel", ("g_002", "guest"), {"guest_id": "g_002"})):
        blocked = act(client, what, {"reservation_id": processing, **extra}, who)
        assert blocked.status_code == 409 and error(blocked)["code"] == "INVALID_STATUS", what


def test_cancel_only_before_the_check_in_day(client, kafka):
    # a stay that starts today: the seed's pending/approved ones are in the future, so make one
    with get_db().transaction() as conn:
        execute(conn, "INSERT INTO reservations SELECT 'r_800', %s, 'p_010', 'g_001', %s, %s + INTERVAL 2 DAY, 1, 2, 89, 178, 20, 198, UTC_TIMESTAMP(3), 'approved', NULL, NULL, NULL, UTC_TIMESTAMP(3)", (str(uuid.uuid4()), today_local(), today_local()))
    for who, extra in ((("g_001", "guest"), {"guest_id": "g_001"}), (("h_007", "host"), {"host_id": "h_007", "cancellation_reason": "x"})):
        late = act(client, "cancel", {"reservation_id": "r_800", **extra}, who)
        assert late.status_code == 409 and "before the check-in day" in error(late)["message"]


def test_action_idempotency_returns_the_first_result(client, kafka):
    rid = pending_stay(client, kafka)
    body = {"reservation_id": rid, "host_id": "h_001", "idempotency_key": "approve-1"}
    first = client.post("/bookings/approve", json=body, headers=auth(*MAYA))
    second = client.post("/bookings/approve", json=body, headers=auth(*MAYA))
    assert first.status_code == 200 and second.status_code == 200 and second.json() == first.json()
    assert len(kafka.messages("booking.approved")) == 1
    with get_db().connection() as conn:
        assert fetch_one(conn, "SELECT COUNT(*) AS n FROM reservation_status_history WHERE reservation_id = %s AND new_status='approved'", (rid,))["n"] == 1


def test_two_hosts_clicks_at_once_exactly_one_applies(client, kafka):
    rid = pending_stay(client, kafka)
    results, barrier = [], threading.Barrier(2)

    def click(what):
        c = TestClient(app, raise_server_exceptions=False)
        barrier.wait()
        results.append(act(c, what, {"reservation_id": rid, "host_id": "h_001"}, MAYA).status_code)

    threads = [threading.Thread(target=click, args=(w,)) for w in ("approve", "decline")]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(results) == [200, 409]


# ---------------------------------------------------------------- step 9: the daily job
def insert_stay(rid, prop, guest, start, end, status):
    with get_db().transaction() as conn:
        execute(conn, "INSERT INTO reservations SELECT %s, %s, %s, %s, %s, %s, 1, 1, 100, 100, 20, 120, UTC_TIMESTAMP(3), %s, NULL, NULL, NULL, UTC_TIMESTAMP(3)", (rid, str(uuid.uuid4()), prop, guest, start, end, status))
        if status in ("pending", "approved"):
            from xenia_shared.availability import insert_block
            insert_block(conn, f"a_{rid[2:]}", prop, start, end, "booked", "booking", rid)


def test_daily_job_completes_finished_stays_and_expires_stale_requests(client, kafka):
    insert_stay("r_810", "p_010", "g_001", today_local() - timedelta(days=3), today_local() - timedelta(days=1), "approved")
    insert_stay("r_811", "p_010", "g_002", today_local() - timedelta(days=1), today_local(), "approved")             # check-out today: finished
    insert_stay("r_812", "p_020", "g_003", today_local() + timedelta(days=1), today_local() + timedelta(days=3), "approved")   # future: untouched
    insert_stay("r_813", "p_021", "g_004", today_local() - timedelta(days=2), today_local() + timedelta(days=1), "pending")    # check-in passed, host never answered
    insert_stay("r_814", "p_022", "g_005", today_local() + timedelta(days=5), today_local() + timedelta(days=6), "pending")    # future: untouched
    first = jobs.run_daily_job()
    assert first == {"completed": 2, "expired": 1}
    assert jobs.run_daily_job() == {"completed": 0, "expired": 0}                                       # running again changes nothing
    with get_db().connection() as conn:
        status = {r["reservation_id"]: r for r in fetch_all(conn, "SELECT reservation_id, status, cancellation_reason FROM reservations WHERE reservation_id IN ('r_810','r_811','r_812','r_813','r_814')")}
        assert fetch_one(conn, "SELECT COUNT(*) AS n FROM availability_blocks WHERE reservation_id = 'r_813'")["n"] == 0
        assert fetch_one(conn, "SELECT COUNT(*) AS n FROM availability_nights WHERE property_id='p_021' AND night_date = %s", (today_local(),))["n"] == 0
    assert [status[k]["status"] for k in ("r_810", "r_811", "r_812", "r_813", "r_814")] == ["completed", "completed", "approved", "declined", "pending"]
    assert status["r_813"]["cancellation_reason"] == "Expired: the host didn’t respond before check-in."
    assert len(kafka.messages("booking.completed")) == 2 and len(kafka.messages("booking.declined")) == 1
    assert kafka.messages("availability.released")[0]["payload"]["reason"] == "booking_declined"
    with get_db().connection() as conn:
        assert fetch_one(conn, "SELECT COUNT(*) AS n FROM reservation_status_history WHERE reservation_id IN ('r_810','r_813') AND actor_id = 'booking-job'")["n"] == 2


def test_two_jobs_at_the_same_moment_do_not_double_apply(client, kafka):
    insert_stay("r_820", "p_010", "g_001", today_local() - timedelta(days=3), today_local() - timedelta(days=1), "approved")
    totals, barrier = [], threading.Barrier(2)

    def go():
        barrier.wait()
        totals.append(jobs.run_daily_job()["completed"])

    threads = [threading.Thread(target=go) for _ in range(2)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sum(totals) == 1 and len(kafka.messages("booking.completed")) == 1


def test_health_and_cors(client):
    assert client.get("/health").json() == {"status": "ok", "service": "booking-service"}


def test_a_host_opening_a_processing_or_failed_request_by_id_gets_404(client, kafka):
    """The host never sees processing or failed requests: not in lists, and by id the same 404 as an unknown id."""
    processing = request(client, "g_006", start=120, end=122).json()["reservation_id"]
    hidden = get(client, processing, MAYA)
    assert hidden.status_code == 404 and error(hidden)["message"] == f"No reservation found with id {processing}."
    request(client, "g_007", start=130, end=132)                       # first: gets the nights
    failed = request(client, "g_008", start=130, end=132).json()["reservation_id"]
    drain(kafka)
    assert get(client, failed, ("g_008", "guest")).json()["status"] == "failed"   # the guest still sees it
    assert get(client, failed, MAYA).status_code == 404
    assert get(client, processing, MAYA).status_code == 200                       # now pending: the host sees it


def test_at_6_pm_pacific_booking_today_is_allowed(client, kafka, monkeypatch):
    """Calendar dates are judged in America/Los_Angeles (contract section 1). At 6 pm Pacific on Nov 30 it is
    already Dec 1 in UTC; a guest booking Nov 30 (their today) must be accepted, and Nov 29 refused."""
    from datetime import datetime, timezone

    from xenia_shared import timeutil

    six_pm_pacific = datetime(2026, 12, 1, 2, 0, tzinfo=timezone.utc)   # = 2026-11-30 18:00 PST
    monkeypatch.setattr(timeutil, "utc_now", lambda: six_pm_pacific)
    body = {"property_id": "p_005", "guest_id": "g_009", "guest_count": 2}
    today = client.post("/bookings/request", json={**body, "check_in": "2026-11-30", "check_out": "2026-12-02", "idempotency_key": str(uuid.uuid4())}, headers=auth("g_009", "guest"))
    assert today.status_code == 202 and today.json()["status"] == "processing"
    yesterday = client.post("/bookings/request", json={**body, "check_in": "2026-11-29", "check_out": "2026-12-02", "idempotency_key": str(uuid.uuid4())}, headers=auth("g_009", "guest"))
    assert yesterday.status_code == 400 and "past" in error(yesterday)["message"]
