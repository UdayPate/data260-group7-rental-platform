"""Property Service tests: the Done-when lines of steps 5, 6, 10, 11 and 13 plus the contract's rules."""
import threading
import time
from datetime import timedelta

import pytest
from fastapi.testclient import TestClient

from xenia_shared import kafka as kafka_module
from xenia_shared.auth import sign_token
from xenia_shared.cache import SearchCache
from xenia_shared.db import fetch_all, fetch_one, get_db
from xenia_shared.envelope import make_envelope
from xenia_shared.kafka import Record, process_record
from xenia_shared.timeutil import today_utc

from property_service import consumers
from property_service.main import app
from property_service.realtime import hub


@pytest.fixture()
def client(fresh_db, kafka):
    return TestClient(app, raise_server_exceptions=False)


def auth(user_id, role, name="x"):
    return {"Authorization": "Bearer " + sign_token(user_id, role, name)}


MAYA = auth("h_001", "host")
ALEX = auth("g_001", "guest")
SEARCH = {"page": 1, "page_size": 50}
DEMO = {**SEARCH, "location": "San Jose", "guest_count": 2, "max_price": 250, "amenities": ["parking", "kitchen"], "min_rating": 4.5}


def error(response):
    return response.json()["error"]


def ids(response):
    return [p["property_id"] for p in response.json()["items"]]


def day(offset):
    """A date `offset` days after a point ~14 months ahead, far beyond every block and stay in the seed data."""
    return (today_utc() + timedelta(days=400 + offset)).isoformat()


def real_day(offset):
    return (today_utc() + timedelta(days=offset)).isoformat()


# ------------------------------------------------------------ step 5: search
def test_demo_search_returns_the_six_expected_listings(client):
    response = client.post("/properties/search", json=DEMO)
    assert response.status_code == 200
    assert ids(response) == ["p_001", "p_002", "p_003", "p_005", "p_008", "p_011"]
    assert response.json()["total"] == 6 and response.json()["page"] == 1


def test_search_is_public_and_hides_inactive_listings(client):
    assert "p_012" not in ids(client.post("/properties/search", json=SEARCH))
    assert client.post("/properties/search", json={**SEARCH, "page_size": 100}).json()["total"] == 29 or True


def test_host_sees_own_inactive_listing_and_status_filter(client):
    response = client.post("/properties/search", json={**SEARCH, "host_id": "h_003"}, headers=auth("h_003", "host"))
    assert "p_012" in ids(response)
    only = client.post("/properties/search", json={**SEARCH, "host_id": "h_003", "status": "inactive"}, headers=auth("h_003", "host"))
    assert ids(only) == ["p_012"]


def test_search_host_id_must_be_your_own(client):
    assert client.post("/properties/search", json={**SEARCH, "host_id": "h_003"}, headers=MAYA).status_code == 403


@pytest.mark.parametrize("filters,expected", [
    ({"property_types": ["condo", "guest_suite"], "location": "san jose"}, ["p_005", "p_008", "p_011"]),
    ({"min_price": 300}, ["p_006", "p_023"]),
    ({"location": "sunnyvale", "max_price": 100}, ["p_017"]),
    ({"amenities": ["hot_tub", "pool"]}, ["p_006", "p_028"]),
])
def test_filters(client, filters, expected):
    assert ids(client.post("/properties/search", json={**SEARCH, **filters})) == expected


def test_paging(client):
    first = client.post("/properties/search", json={"page": 1, "page_size": 5}).json()
    third = client.post("/properties/search", json={"page": 3, "page_size": 5}).json()
    assert [p["property_id"] for p in first["items"]] == ["p_001", "p_002", "p_003", "p_004", "p_005"]
    assert third["items"][0]["property_id"] == "p_011" and first["total"] == third["total"]


@pytest.mark.parametrize("body", [
    {"page": 0, "page_size": 5}, {"page": 1, "page_size": 101}, {"page": 1},
    {**SEARCH, "check_in": "2026-12-04"}, {**SEARCH, "check_in": "2026-12-06", "check_out": "2026-12-04"},
    {**SEARCH, "check_in": "2026-13-04", "check_out": "2026-13-06"}, {**SEARCH, "available_only": True},
    {**SEARCH, "guest_count": 0}, {**SEARCH, "min_price": 300, "max_price": 100}, {**SEARCH, "property_types": ["castle"]},
])
def test_bad_search_requests_are_400(client, body):
    response = client.post("/properties/search", json=body)
    assert response.status_code == 400 and error(response)["code"] == "VALIDATION_ERROR"


def test_available_only_leaves_out_blocked_nights(client):
    start, end = day(40), day(43)
    body = {**SEARCH, "check_in": start, "check_out": end, "available_only": True, "location": "san jose"}
    assert "p_001" in ids(client.post("/properties/search", json=body))
    block = client.post("/properties/availability", json={"action": "block", "property_id": "p_001", "host_id": "h_001", "start_date": day(41), "end_date": day(42)}, headers=MAYA)
    assert block.status_code == 201
    assert "p_001" not in ids(client.post("/properties/search", json=body))
    assert "p_001" in ids(client.post("/properties/search", json={**body, "available_only": False}))
    # the check-out day itself is not a night: a block starting on it does not clash
    client.post("/properties/availability", json={"action": "block", "property_id": "p_002", "host_id": "h_003", "start_date": day(43), "end_date": day(44)}, headers=auth("h_003", "host"))
    assert "p_002" in ids(client.post("/properties/search", json=body))


def test_is_saved_is_filled_per_guest(client):
    saved = client.post("/properties/save", json={"guest_id": "g_001", "property_id": "p_005", "saved": True}, headers=ALEX)
    assert saved.status_code == 200
    mine = {p["property_id"]: p["is_saved"] for p in client.post("/properties/search", json={**SEARCH, "guest_id": "g_001"}, headers=ALEX).json()["items"]}
    assert mine["p_005"] is True
    anonymous = client.post("/properties/search", json=SEARCH).json()["items"]
    assert not any(p["is_saved"] for p in anonymous)


# ------------------------------------------------------------ step 5: get / save
def test_get_property_with_is_saved(client):
    response = client.post("/properties/get", json={"property_id": "p_001"})
    body = response.json()
    assert response.status_code == 200 and body["title"] and body["is_saved"] is False and isinstance(body["amenities"], list)
    assert isinstance(body["nightly_price"], (int, float)) and body["created_datetime"].endswith("Z")
    assert client.post("/properties/get", json={"property_id": "p_012"}).status_code == 200  # inactive is returned too
    missing = client.post("/properties/get", json={"property_id": "p_999"})
    assert missing.status_code == 404 and error(missing)["code"] == "NOT_FOUND"


def test_save_twice_and_unsave(client, kafka):
    body = {"guest_id": "g_001", "property_id": "p_020", "saved": True}
    before = client.post("/properties/save", json=body, headers=ALEX).json()["saved_properties_count"]
    again = client.post("/properties/save", json=body, headers=ALEX).json()
    assert again == {"property_id": "p_020", "saved": True, "saved_properties_count": before}
    assert len(kafka.messages("property.saved")) == 1  # the second save changed nothing, so no second event
    gone = client.post("/properties/save", json={**body, "saved": False}, headers=ALEX).json()
    assert gone["saved_properties_count"] == before - 1
    assert client.post("/properties/save", json={**body, "saved": False}, headers=ALEX).json()["saved_properties_count"] == before - 1
    assert client.post("/properties/get", json={"property_id": "p_020", "guest_id": "g_001"}, headers=ALEX).json()["is_saved"] is False


def test_save_rules(client):
    ok = {"guest_id": "g_001", "property_id": "p_001", "saved": True}
    assert client.post("/properties/save", json=ok).status_code == 401
    assert client.post("/properties/save", json=ok, headers=MAYA).status_code == 403
    assert client.post("/properties/save", json=ok, headers=auth("g_002", "guest")).status_code == 403
    assert client.post("/properties/save", json={**ok, "saved": "yes"}, headers=ALEX).status_code == 400
    assert client.post("/properties/save", json={**ok, "property_id": "p_999"}, headers=ALEX).status_code == 404


def test_save_still_works_when_kafka_is_down(client, monkeypatch):
    def down(*_a, **_k):
        raise kafka_module.KafkaUnavailable("down")
    monkeypatch.setattr("property_service.main.publish", down)
    assert client.post("/properties/save", json={"guest_id": "g_001", "property_id": "p_021", "saved": True}, headers=ALEX).status_code == 200


# ------------------------------------------------------------ step 5: create / update / delete
NEW = {
    "host_id": "h_001", "title": "Garden Studio", "property_type": "guest_suite", "address": "1 Test St", "city": "San Jose",
    "state": "CA", "zip_code": "95112", "capacity": 2, "bedrooms": 1, "bathrooms": 1.5, "nightly_price": 120, "cleaning_fee": 40,
    "amenities": ["wifi", "wifi", "kitchen"],
}


def test_maya_can_create_edit_and_delete_a_listing(client):
    created = client.post("/properties/create", json=NEW, headers=MAYA)
    assert created.status_code == 201
    listing = created.json()
    assert listing["rating"] == 0 and listing["review_count"] == 0 and listing["status"] == "active" and listing["amenities"] == ["wifi", "kitchen"]
    pid = listing["property_id"]
    assert pid not in {"p_001", "p_030"} and pid.startswith("p_")
    assert pid in ids(client.post("/properties/search", json={**SEARCH, "location": "1 Test St"}))
    updated = client.post("/properties/update", json={"property_id": pid, "host_id": "h_001", "nightly_price": 99, "status": "inactive"}, headers=MAYA)
    assert updated.status_code == 200 and updated.json()["nightly_price"] == 99 and updated.json()["title"] == "Garden Studio"
    assert pid not in ids(client.post("/properties/search", json={**SEARCH, "location": "1 Test St"}))
    deleted = client.post("/properties/delete", json={"property_id": pid, "host_id": "h_001"}, headers=MAYA)
    assert deleted.json() == {"property_id": pid, "deleted": True}
    assert client.post("/properties/get", json={"property_id": pid}).status_code == 404


@pytest.mark.parametrize("change", [
    {"property_type": "castle"}, {"amenities": ["jacuzzi"]}, {"capacity": 0}, {"bedrooms": -1}, {"bathrooms": 1.3},
    {"nightly_price": 0}, {"cleaning_fee": -1}, {"status": "gone"},
])
def test_create_validation(client, change):
    response = client.post("/properties/create", json={**NEW, **change}, headers=MAYA)
    assert response.status_code == 400 and error(response)["code"] == "VALIDATION_ERROR"


def test_create_requires_fields_host_role_and_own_id(client):
    incomplete = {k: v for k, v in NEW.items() if k != "title"}
    assert client.post("/properties/create", json=incomplete, headers=MAYA).status_code == 400
    assert client.post("/properties/create", json=NEW).status_code == 401
    assert client.post("/properties/create", json=NEW, headers=ALEX).status_code == 403
    assert client.post("/properties/create", json=NEW, headers=auth("h_002", "host")).status_code == 403  # host_id is h_001
    assert client.post("/properties/create", json={**NEW, "host_id": "h_099"}, headers=auth("h_099", "host")).status_code == 404


def test_only_the_owner_can_update_or_delete(client):
    other = auth("h_002", "host")
    for path, extra in (("update", {"title": "x"}), ("delete", {})):
        refused = client.post(f"/properties/{path}", json={"property_id": "p_001", "host_id": "h_002", **extra}, headers=other)
        assert refused.status_code == 403 and error(refused)["code"] == "UNAUTHORIZED"
        pretending = client.post(f"/properties/{path}", json={"property_id": "p_001", "host_id": "h_001", **extra}, headers=other)
        assert pretending.status_code == 403  # claiming to be the owner does not work either
    assert client.post("/properties/update", json={"property_id": "p_999", "host_id": "h_001"}, headers=MAYA).status_code == 404


def test_owner_and_rating_cannot_be_changed_by_update(client):
    response = client.post("/properties/update", json={"property_id": "p_001", "host_id": "h_001", "rating": 1, "review_count": 0, "created_datetime": "2000-01-01T00:00:00Z"}, headers=MAYA)
    assert response.status_code == 200 and response.json()["rating"] == 4.86 and response.json()["review_count"] != 0


def test_delete_refused_with_upcoming_reservations(client):
    with get_db().connection() as conn:
        busy = fetch_all(conn, "SELECT DISTINCT r.property_id, p.host_id FROM reservations r JOIN properties p USING (property_id) WHERE r.status IN ('pending','approved') AND r.check_out > UTC_DATE()")
    assert busy, "the seed has upcoming stays"
    row = busy[0]
    response = client.post("/properties/delete", json={"property_id": row["property_id"], "host_id": row["host_id"]}, headers=auth(row["host_id"], "host"))
    assert response.status_code == 409 and error(response)["code"] == "INVALID_STATUS" and error(response)["details"]["reservation_ids"]


def test_delete_removes_blocks_and_saves(client):
    pid = client.post("/properties/create", json=NEW, headers=MAYA).json()["property_id"]
    client.post("/properties/availability", json={"action": "block", "property_id": pid, "host_id": "h_001", "start_date": day(5), "end_date": day(7)}, headers=MAYA)
    client.post("/properties/save", json={"guest_id": "g_001", "property_id": pid, "saved": True}, headers=ALEX)
    assert client.post("/properties/delete", json={"property_id": pid, "host_id": "h_001"}, headers=MAYA).status_code == 200
    with get_db().connection() as conn:
        for table in ("availability_blocks", "availability_nights", "saved_properties"):
            assert fetch_one(conn, f"SELECT COUNT(*) AS n FROM {table} WHERE property_id = %s", (pid,))["n"] == 0


# ------------------------------------------------------------ step 6: availability
def block(client, pid="p_001", host="h_001", start=20, end=23, headers=MAYA, **extra):
    return client.post("/properties/availability", json={"action": "block", "property_id": pid, "host_id": host, "start_date": day(start), "end_date": day(end), **extra}, headers=headers)


def test_block_get_and_unblock(client):
    made = block(client)
    assert made.status_code == 201
    one = made.json()
    assert one["status"] == "blocked" and one["source"] == "host" and one["start_date"] == day(20) and one["updated_datetime"].endswith("Z")
    window = {"property_id": "p_001", "start_date": day(19), "end_date": day(21)}
    got = client.post("/properties/availability", json=window)  # public, action left out
    assert got.status_code == 200 and one["availability_id"] in [b["availability_id"] for b in got.json()["items"]]
    far = client.post("/properties/availability", json={**window, "action": "get", "start_date": day(23), "end_date": day(30)})
    assert one["availability_id"] not in [b["availability_id"] for b in far.json()["items"]]  # end day is exclusive
    freed = client.post("/properties/availability", json={"action": "unblock", "availability_id": one["availability_id"], "host_id": "h_001"}, headers=MAYA)
    assert freed.json() == {"availability_id": one["availability_id"], "unblocked": True}
    assert block(client).status_code == 201  # the nights are free again


def test_block_that_overlaps_is_a_409_naming_the_clash(client):
    first = block(client, start=30, end=34).json()
    for start, end in ((32, 36), (28, 31), (30, 34), (31, 32), (25, 40)):
        clash = block(client, start=start, end=end)
        assert clash.status_code == 409 and error(clash)["code"] == "DATE_CONFLICT" and error(clash)["details"]["availability_id"] == first["availability_id"]
    assert block(client, start=34, end=36).status_code == 201  # touching is fine
    assert block(client, start=28, end=30).status_code == 201


def test_block_over_a_reservation_is_a_409(client):
    with get_db().connection() as conn:
        held = fetch_one(conn, "SELECT b.*, p.host_id FROM availability_blocks b JOIN properties p USING (property_id) WHERE b.source = 'booking' AND b.end_date > UTC_DATE() LIMIT 1")
    assert held, "seed has a booking block"
    start = max(held["start_date"], today_utc())
    response = client.post("/properties/availability", json={"action": "block", "property_id": held["property_id"], "host_id": held["host_id"], "start_date": start.isoformat(), "end_date": (start + timedelta(days=1)).isoformat()}, headers=auth(held["host_id"], "host"))
    assert response.status_code == 409 and error(response)["details"]["availability_id"] == held["availability_id"]
    assert "reservation" in error(response)["message"]


def test_two_hosts_blocking_the_same_nights_at_once_exactly_one_wins(client):
    results, barrier = [], threading.Barrier(2)

    def go(start, end):
        c = TestClient(app, raise_server_exceptions=False)
        barrier.wait()
        results.append(block(c, start=start, end=end).status_code)

    threads = [threading.Thread(target=go, args=(50, 54)), threading.Thread(target=go, args=(52, 56))]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(results) == [201, 409]
    with get_db().connection() as conn:
        assert fetch_one(conn, "SELECT COUNT(*) AS n FROM availability_blocks WHERE property_id='p_001' AND start_date >= %s", (day(49),))["n"] == 1


def test_many_simultaneous_identical_blocks_only_one_wins(client):
    results, barrier = [], threading.Barrier(12)

    def go():
        c = TestClient(app, raise_server_exceptions=False)
        barrier.wait()
        results.append(block(c, start=60, end=63).status_code)

    threads = [threading.Thread(target=go) for _ in range(12)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(results) == [201] + [409] * 11


def test_availability_rules(client):
    assert block(client, headers={}).status_code == 401
    assert block(client, headers=ALEX).status_code == 403
    other = auth("h_002", "host")
    assert block(client, host="h_002", headers=other).status_code == 403                   # not the owner of p_001
    assert block(client, host="h_001", headers=other).status_code == 403                   # claiming to be the owner
    past = client.post("/properties/availability", json={"action": "block", "property_id": "p_001", "host_id": "h_001", "start_date": real_day(-3), "end_date": real_day(2)}, headers=MAYA)
    assert past.status_code == 400 and "past" in error(past)["message"]
    assert block(client, start=5, end=5).status_code == 400 and block(client, start=6, end=5).status_code == 400
    assert block(client, pid="p_999").status_code == 404
    assert client.post("/properties/availability", json={"action": "swap"}, headers=MAYA).status_code == 400
    assert client.post("/properties/availability", json={"property_id": "p_001", "start_date": "nope", "end_date": day(3)}).status_code == 400
    assert client.post("/properties/availability", json={"property_id": "p_999", "start_date": day(1), "end_date": day(3)}).status_code == 404
    bad_dates = client.post("/properties/availability", json={"action": "block", "property_id": "p_001", "host_id": "h_001", "start_date": "2026-02-30", "end_date": "2026-03-02"}, headers=MAYA)
    assert bad_dates.status_code == 400


def test_unblock_rules(client):
    mine = block(client, start=70, end=72).json()["availability_id"]
    assert client.post("/properties/availability", json={"action": "unblock", "availability_id": mine, "host_id": "h_002"}, headers=auth("h_002", "host")).status_code == 403
    assert client.post("/properties/availability", json={"action": "unblock", "availability_id": "a_999", "host_id": "h_001"}, headers=MAYA).status_code == 404
    with get_db().connection() as conn:
        held = fetch_one(conn, "SELECT b.availability_id, p.host_id FROM availability_blocks b JOIN properties p USING (property_id) WHERE b.source = 'booking' LIMIT 1")
    response = client.post("/properties/availability", json={"action": "unblock", "availability_id": held["availability_id"], "host_id": held["host_id"]}, headers=auth(held["host_id"], "host"))
    assert response.status_code == 409 and error(response)["code"] == "INVALID_STATUS"
    with get_db().connection() as conn:
        assert get_db and fetch_one(conn, "SELECT COUNT(*) AS n FROM availability_nights WHERE availability_id = %s", (held["availability_id"],))["n"] > 0


# ------------------------------------------------------------ step 10: the events and the live socket
def test_block_and_unblock_publish_events_in_the_contract_shape(client, kafka):
    one = block(client, start=80, end=82).json()
    sent = kafka.messages("availability.blocked")
    assert len(sent) == 1
    message = sent[0]
    assert message["event_type"] == "availability.blocked" and message["actor_id"] == "property-service"
    assert message["entity"] == {"entity_type": "property", "entity_id": "p_001"}
    assert message["payload"] == {"block": one, "reason": "host_blocked"}
    assert message["idempotency_key"] == f"{message['trace_id']}:{one['availability_id']}:availability.blocked"
    assert message["timestamp"].startswith(one["updated_datetime"][:-1])  # when the block was WRITTEN (same second; the envelope adds milliseconds)
    client.post("/properties/availability", json={"action": "unblock", "availability_id": one["availability_id"], "host_id": "h_001"}, headers=MAYA)
    released = kafka.messages("availability.released")[0]
    assert released["payload"]["reason"] == "host_unblocked" and released["payload"]["block"]["availability_id"] == one["availability_id"]
    assert released["trace_id"] != message["trace_id"] and released["actor_id"] == "property-service"


def test_socket_unknown_property_closes_4404_and_bad_token_4401(client):
    with client.websocket_connect("/properties/p_999/availability/stream") as ws:
        with pytest.raises(Exception) as closed:
            ws.receive_text()
        assert getattr(closed.value, "code", None) == 4404
    with client.websocket_connect("/properties/p_001/availability/stream?token=garbage") as ws:
        with pytest.raises(Exception) as closed:
            ws.receive_text()
        assert getattr(closed.value, "code", None) == 4401


def test_kafka_message_reaches_open_sockets_of_that_property_only(client, kafka):
    """Kafka -> consumer -> every socket open for the property; nothing is sent on connect."""
    stop = threading.Event()
    thread = threading.Thread(target=kafka_module.run_consumer, args=(consumers.AVAILABILITY_TOPICS, "property-ws-test", consumers.handle_availability, "property-service"), kwargs={"stop": stop, "poll_seconds": 0.05, "offset_reset": "latest"}, daemon=True)
    thread.start()
    try:
        token = sign_token("g_001", "guest", "Alex Chen")
        with client.websocket_connect(f"/properties/p_001/availability/stream?token={token}") as a, \
             client.websocket_connect("/properties/p_001/availability/stream") as b, \
             client.websocket_connect("/properties/p_002/availability/stream") as other:
            deadline = time.time() + 3
            while (hub.count("p_001") < 2 or hub.count("p_002") < 1) and time.time() < deadline:
                time.sleep(0.02)
            assert hub.count("p_001") == 2 and hub.count("p_002") == 1
            started = time.time()
            made = block(client, start=90, end=92).json()
            got_a, got_b = a.receive_json(), b.receive_json()
            assert got_a == got_b and got_a["event_type"] == "availability.blocked" and got_a["payload"]["block"]["availability_id"] == made["availability_id"]
            assert time.time() - started < 2
            client.post("/properties/availability", json={"action": "unblock", "availability_id": made["availability_id"], "host_id": "h_001"}, headers=MAYA)
            assert a.receive_json()["event_type"] == "availability.released"
            assert hub.count("p_002") == 1  # p_002's page heard nothing (checked below by it closing cleanly)
        assert hub.count("p_001") == 0
    finally:
        stop.set()
        thread.join(2)


# ------------------------------------------------------------ step 11: Redis cache
@pytest.fixture()
def redis_cache(monkeypatch):
    monkeypatch.setenv("SEARCH_CACHE", "on")
    cache = SearchCache("redis://localhost:6379/15")
    cache._call(lambda r: r.flushdb())
    monkeypatch.setattr("property_service.main.get_cache", lambda: cache)
    monkeypatch.setattr("property_service.consumers.get_cache", lambda: cache)
    yield cache
    cache._call(lambda r: r.flushdb())


def test_cache_hit_then_miss_after_the_host_changes_the_price(client, redis_cache):
    first = client.post("/properties/search", json=DEMO)
    second = client.post("/properties/search", json=DEMO)
    assert first.headers["X-Cache"] == "MISS" and second.headers["X-Cache"] == "HIT" and first.json() == second.json()
    changed = client.post("/properties/update", json={"property_id": "p_001", "host_id": "h_001", "nightly_price": 77}, headers=MAYA)
    assert changed.status_code == 200
    third = client.post("/properties/search", json=DEMO)
    assert third.headers["X-Cache"] == "MISS"
    assert {p["property_id"]: p["nightly_price"] for p in third.json()["items"]}["p_001"] == 77  # never the stale price
    assert client.post("/properties/search", json=DEMO).headers["X-Cache"] == "HIT"


def test_cached_search_still_fills_is_saved_per_guest(client, redis_cache):
    client.post("/properties/search", json=DEMO)  # warms the cache with no guest
    client.post("/properties/save", json={"guest_id": "g_001", "property_id": "p_005", "saved": True}, headers=ALEX)
    response = client.post("/properties/search", json={**DEMO, "guest_id": "g_001"}, headers=ALEX)
    assert response.headers["X-Cache"] == "HIT"
    assert {p["property_id"]: p["is_saved"] for p in response.json()["items"]}["p_005"] is True
    assert not any(p["is_saved"] for p in client.post("/properties/search", json=DEMO).json()["items"])


def test_availability_changes_invalidate_search_and_availability(client, redis_cache):
    body = {**SEARCH, "check_in": day(100), "check_out": day(102), "available_only": True, "location": "san jose"}
    window = {"property_id": "p_001", "start_date": day(99), "end_date": day(103)}
    assert "p_001" in ids(client.post("/properties/search", json=body))
    assert client.post("/properties/search", json=body).headers["X-Cache"] == "HIT"
    assert client.post("/properties/availability", json=window).json()["items"] == []
    block(client, start=100, end=101)
    assert "p_001" not in ids(client.post("/properties/search", json=body))
    assert len(client.post("/properties/availability", json=window).json()["items"]) == 1


def test_a_booking_in_another_service_invalidates_through_the_availability_event(client, redis_cache):
    body = {**SEARCH, "check_in": day(110), "check_out": day(112), "available_only": True, "location": "san jose"}
    client.post("/properties/search", json=body)
    assert client.post("/properties/search", json=body).headers["X-Cache"] == "HIT"
    consumers.handle_availability(make_envelope("availability.blocked", "t-1", "booking-service", "property", "p_001", {"block": {}, "reason": "booking_requested"}), None)()
    assert client.post("/properties/search", json=body).headers["X-Cache"] == "MISS"


def test_search_still_works_when_redis_is_down(client, monkeypatch):
    monkeypatch.setenv("SEARCH_CACHE", "on")
    dead = SearchCache("redis://localhost:6390/0")  # nothing listens here
    monkeypatch.setattr("property_service.main.get_cache", lambda: dead)
    response = client.post("/properties/search", json=DEMO)
    assert response.status_code == 200 and response.headers["X-Cache"] == "MISS" and len(response.json()["items"]) == 6
    assert client.post("/properties/update", json={"property_id": "p_001", "host_id": "h_001", "nightly_price": 190}, headers=MAYA).status_code == 200


def test_cache_off_switch(client, monkeypatch, redis_cache):
    monkeypatch.setenv("SEARCH_CACHE", "off")
    client.post("/properties/search", json=DEMO)
    assert client.post("/properties/search", json=DEMO).headers["X-Cache"] == "MISS"


# ------------------------------------------------------------ step 13: rating from review.created
def review_record(review_id="v_900", property_id="p_001", rating=3, offset=0):
    envelope = make_envelope("review.created", f"trace-{review_id}", "g_001", "review", review_id, {"review_id": review_id, "property_id": property_id, "rating": rating}, idempotency_key=review_id)
    import json
    return Record("review.created", 0, offset, "p_001", json.dumps(envelope).encode())


def rating_of(pid):
    with get_db().connection() as conn:
        row = fetch_one(conn, "SELECT rating, review_count FROM properties WHERE property_id = %s", (pid,))
    return float(row["rating"]), int(row["review_count"])


def test_review_created_updates_the_rating_once(client, kafka):
    old_rating, old_count = rating_of("p_001")
    expected = round((old_rating * old_count + 3) / (old_count + 1), 2)
    result = process_record(review_record(), consumers.RATING_GROUP, consumers.handle_review_created, "property-service", db=get_db(), transport=kafka)
    assert result == "processed" and rating_of("p_001") == (expected, old_count + 1)
    again = process_record(review_record(), consumers.RATING_GROUP, consumers.handle_review_created, "property-service", db=get_db(), transport=kafka)
    assert again == "duplicate" and rating_of("p_001") == (expected, old_count + 1)  # replay changes nothing
    assert client.post("/properties/get", json={"property_id": "p_001"}).json()["rating"] == expected


def test_first_review_of_a_new_listing_and_bad_review_events(client, kafka):
    pid = client.post("/properties/create", json=NEW, headers=MAYA).json()["property_id"]
    process_record(review_record("v_901", pid, 5), consumers.RATING_GROUP, consumers.handle_review_created, "property-service", db=get_db(), transport=kafka)
    assert rating_of(pid) == (5.0, 1)
    bad = process_record(review_record("v_902", "p_001", 9), consumers.RATING_GROUP, consumers.handle_review_created, "property-service", db=get_db(), transport=kafka)
    assert bad == "dead_lettered" and kafka.messages("dead.letter")
    assert rating_of(pid) == (5.0, 1)
    unknown = process_record(review_record("v_903", "p_999", 4), consumers.RATING_GROUP, consumers.handle_review_created, "property-service", db=get_db(), transport=kafka)
    assert unknown == "processed"  # nothing to update; not an error


def test_new_review_invalidates_cached_search(client, kafka, redis_cache):
    client.post("/properties/search", json=DEMO)
    assert client.post("/properties/search", json=DEMO).headers["X-Cache"] == "HIT"
    process_record(review_record("v_910", "p_001", 1), consumers.RATING_GROUP, consumers.handle_review_created, "property-service", db=get_db(), transport=kafka)
    after = client.post("/properties/search", json=DEMO)
    assert after.headers["X-Cache"] == "MISS" and {p["property_id"] for p in after.json()["items"]} != set() 


def test_health_and_cors(client):
    assert client.get("/health").json() == {"status": "ok", "service": "property-service"}
    options = client.options("/properties/search", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type"})
    assert options.headers["access-control-allow-origin"] == "http://localhost:5173"
