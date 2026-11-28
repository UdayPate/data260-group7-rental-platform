"""User Service tests: the Done-when line of step 4 plus every rule of contract "User Service"."""
import pytest
from fastapi.testclient import TestClient

from xenia_shared.auth import sign_token
from xenia_shared.timeutil import today_local
from user_service.main import app


@pytest.fixture()
def client(fresh_db):
    return TestClient(app, raise_server_exceptions=False)


def login(client, email="alex.chen@example.com", password="demo1234"):
    return client.post("/auth/login", json={"email": email, "password": password})


def auth(user_id, role, name="x"):
    return {"Authorization": "Bearer " + sign_token(user_id, role, name)}


def error(response):
    return response.json()["error"]


# ---------------------------------------------------------------- login
def test_demo_account_logs_in_and_the_token_works(client):
    response = login(client)
    assert response.status_code == 200
    body = response.json()
    assert body["user"] == {"id": "g_001", "role": "guest", "name": "Alex Chen"}
    profile = client.post("/guests/get", json={"guest_id": "g_001"}, headers={"Authorization": f"Bearer {body['token']}"})
    assert profile.status_code == 200 and profile.json()["email"] == "alex.chen@example.com"


@pytest.mark.parametrize("email,role,user_id,name", [
    ("maya.ortiz@example.com", "host", "h_001", "Maya Ortiz"),
    ("admin@example.com", "admin", "adm_001", "Platform Admin"),
    ("ALEX.CHEN@EXAMPLE.COM", "guest", "g_001", "Alex Chen"),   # email compared ignoring upper/lower case
])
def test_every_kind_of_account_logs_in(client, email, role, user_id, name):
    assert login(client, email).json()["user"] == {"id": user_id, "role": role, "name": name}


def test_all_21_demo_accounts_log_in(client, fresh_db):
    with fresh_db.connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT email FROM accounts")
        emails = [r["email"] for r in cur.fetchall()]
    assert len(emails) == 21
    assert all(login(client, e).status_code == 200 for e in emails)


def test_wrong_password_and_unknown_email_give_the_same_401(client):
    wrong = login(client, password="nope-nope")
    unknown = login(client, email="nobody@example.com")
    assert wrong.status_code == unknown.status_code == 401
    assert error(wrong) == error(unknown)
    assert error(wrong)["code"] == "UNAUTHENTICATED" and error(wrong)["message"] == "Wrong email or password."


def test_login_validates_fields(client):
    response = client.post("/auth/login", json={"email": "a@b.com"})
    assert response.status_code == 400 and error(response)["details"]["missing_fields"] == ["password"]


def test_token_claims(client):
    import jwt as pyjwt
    from xenia_shared.auth import get_secret
    claims = pyjwt.decode(login(client).json()["token"], get_secret(), algorithms=["HS256"])
    assert claims["sub"] == "g_001" and claims["role"] == "guest" and claims["name"] == "Alex Chen"
    assert claims["exp"] - claims["iat"] == 8 * 3600


# ---------------------------------------------------------------- signup
GUEST = {"role": "guest", "email": "new.guest@example.com", "password": "longenough1", "first_name": "Nia", "last_name": "Park", "phone": "(408) 555-0199", "location": "Austin, TX"}
HOST = {"role": "host", "email": "new.host@example.com", "password": "longenough1", "name": "Hal Host", "phone": "(408) 555-0198"}


def test_guest_signup_logs_you_in_and_creates_a_guest_and_a_login(client):
    response = client.post("/auth/signup", json=GUEST)
    assert response.status_code == 201
    user = response.json()["user"]
    assert user["role"] == "guest" and user["name"] == "Nia Park" and user["id"] == "g_013"
    assert login(client, GUEST["email"], GUEST["password"]).status_code == 200
    profile = client.post("/guests/get", json={"guest_id": "g_013"}, headers={"Authorization": f"Bearer {response.json()['token']}"}).json()
    assert profile["booking_count"] == 0 and profile["saved_properties_count"] == 0
    assert profile["preferences"] == {"preferred_locations": [], "max_nightly_price": None, "property_types": [], "amenities": []}


def test_host_signup_starts_unverified_and_standard(client):
    response = client.post("/auth/signup", json=HOST)
    assert response.status_code == 201 and response.json()["user"]["id"] == "h_009"
    host = client.post("/hosts/get", json={"host_id": "h_009"}).json()
    assert host["verification_status"] == "unverified" and host["access_level"] == "standard" and host["response_rate"] == 0


@pytest.mark.parametrize("change,message", [
    ({"role": "admin"}, "Choose whether this is a guest or a host account."),
    ({"role": None}, "Choose whether this is a guest or a host account."),
    ({"password": "short"}, "The password must be at least 8 characters."),
    ({"email": "not-an-email"}, "Please enter a valid email address."),
])
def test_signup_validation(client, change, message):
    response = client.post("/auth/signup", json={**GUEST, **change})
    assert response.status_code == 400 and error(response)["message"] == message


def test_signup_missing_fields(client):
    body = {k: v for k, v in GUEST.items() if k not in ("first_name", "phone")}
    response = client.post("/auth/signup", json=body)
    assert response.status_code == 400 and error(response)["details"]["missing_fields"] == ["first_name", "phone"]


def test_signup_email_taken_ignoring_case(client):
    response = client.post("/auth/signup", json={**GUEST, "email": "ALEX.CHEN@example.com"})
    assert response.status_code == 409 and error(response)["code"] == "EMAIL_TAKEN"


def test_two_signups_at_the_same_instant_make_one_account(client, fresh_db):
    from concurrent.futures import ThreadPoolExecutor
    with ThreadPoolExecutor(8) as pool:
        codes = sorted(r.status_code for r in pool.map(lambda _: client.post("/auth/signup", json=GUEST), range(8)))
    assert codes == [201] + [409] * 7


def test_password_is_stored_as_bcrypt_never_plain(client, fresh_db):
    client.post("/auth/signup", json=GUEST)
    with fresh_db.connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT password_hash FROM accounts WHERE email=%s", (GUEST["email"],))
        stored = cur.fetchone()["password_hash"]
    assert stored.startswith("$2") and GUEST["password"] not in stored and stored.split("$")[2] == "10"


def test_over_long_password_is_refused_not_silently_cut(client):
    assert client.post("/auth/signup", json={**GUEST, "password": "x" * 73}).status_code == 400


# ---------------------------------------------------------------- guests
def test_guest_create_and_host_create_are_refused_from_outside(client):
    assert client.post("/guests/create", json=GUEST).status_code == 401
    assert client.post("/guests/create", json=GUEST, headers=auth("g_001", "guest")).status_code == 403
    assert client.post("/hosts/create", json=HOST, headers=auth("h_001", "host")).status_code == 403


def test_guest_get_rules(client):
    assert client.post("/guests/get", json={"guest_id": "g_001"}).status_code == 401
    assert client.post("/guests/get", json={"guest_id": "g_001"}, headers=auth("g_002", "guest")).status_code == 403       # someone else's profile
    assert client.post("/guests/get", json={"guest_id": "g_001"}, headers=auth("adm_001", "admin")).status_code == 403      # admin has no use for it
    # h_001 (Maya) hosts p_005, where g_001 booked (r_008): she may read Alex's profile.
    assert client.post("/guests/get", json={"guest_id": "g_001"}, headers=auth("h_001", "host")).status_code == 200
    # h_008 (Aisha) has had only two guests; Alex is not one of them.
    refused = client.post("/guests/get", json={"guest_id": "g_001"}, headers=auth("h_008", "host"))
    assert refused.status_code == 403 and "guests who booked one of your listings" in error(refused)["message"]


def test_guest_get_unknown_is_404_and_counters_are_counted(client):
    assert client.post("/guests/get", json={"guest_id": "g_099"}, headers=auth("g_099", "guest")).status_code == 404
    alex = client.post("/guests/get", json={"guest_id": "g_001"}, headers=auth("g_001", "guest")).json()
    assert alex["saved_properties_count"] == 3 and alex["booking_count"] == 3   # r_008, r_012, r_017
    assert alex["preferences"]["max_nightly_price"] == 250 and alex["profile_created_datetime"].endswith("Z")


def test_guest_update_edits_profile_and_login_email(client):
    h = auth("g_001", "guest")
    response = client.post("/guests/update", json={"guest_id": "g_001", "phone": "(408) 555-0000", "email": "alex.new@example.com", "preferences": {"max_nightly_price": 300}}, headers=h)
    assert response.status_code == 200
    body = response.json()
    assert body["phone"] == "(408) 555-0000" and body["preferences"]["max_nightly_price"] == 300 and body["preferences"]["amenities"] == []
    assert login(client, "alex.new@example.com").status_code == 200       # the login email followed the profile email
    assert login(client, "alex.chen@example.com").status_code == 401


def test_guest_update_rules(client):
    h = auth("g_001", "guest")
    assert client.post("/guests/update", json={"guest_id": "g_002", "phone": "1"}, headers=h).status_code == 403
    taken = client.post("/guests/update", json={"guest_id": "g_001", "email": "sam.rivera@example.com"}, headers=h)
    assert taken.status_code == 409 and error(taken)["message"] == "Another account already uses this email."
    assert client.post("/guests/update", json={"guest_id": "g_001", "email": "bad"}, headers=h).status_code == 400
    same = client.post("/guests/update", json={"guest_id": "g_001", "email": "alex.chen@example.com"}, headers=h)
    assert same.status_code == 200                                         # keeping your own email is fine
    ignored = client.post("/guests/update", json={"guest_id": "g_001", "booking_count": 99, "saved_properties_count": 99}, headers=h).json()
    assert ignored["booking_count"] == 3                                   # server-maintained fields cannot be edited


def test_guest_delete_is_blocked_by_upcoming_stays(client):
    response = client.post("/guests/delete", json={"guest_id": "g_001"}, headers=auth("g_001", "guest"))
    assert response.status_code == 409 and error(response)["code"] == "INVALID_STATUS"
    assert error(response)["details"]["reservation_ids"] == ["r_008"]
    assert error(response)["message"] == "You have 1 upcoming trip(s). Cancel them before deleting your profile."


def test_guest_delete_removes_login_and_saves_but_keeps_past_reservations(client, fresh_db):
    # g_006 (Kenji) has saved properties and only a completed stay... check what he has first.
    with fresh_db.connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM reservations WHERE guest_id='g_005'")
        before = cur.fetchone()["n"]
        cur.execute("SELECT COUNT(*) AS n FROM reservations WHERE guest_id='g_005' AND status IN ('pending','approved') AND check_out > %s", (today_local(),))
        assert cur.fetchone()["n"] == 0                          # g_005 can be deleted
    response = client.post("/guests/delete", json={"guest_id": "g_005"}, headers=auth("g_005", "guest"))
    assert response.status_code == 200 and response.json() == {"guest_id": "g_005", "deleted": True}
    assert login(client, "hannah.schmidt@example.com").status_code == 401
    with fresh_db.connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM reservations WHERE guest_id='g_005'")
        assert cur.fetchone()["n"] == before                    # history kept


def test_guest_delete_removes_saved_properties(client, fresh_db):
    with fresh_db.transaction() as conn, conn.cursor() as cur:   # g_005 has no upcoming stays; give them two saves
        cur.execute("INSERT INTO saved_properties VALUES ('g_005','p_001',UTC_TIMESTAMP(3)),('g_005','p_002',UTC_TIMESTAMP(3))")
    assert client.post("/guests/delete", json={"guest_id": "g_005"}, headers=auth("g_005", "guest")).status_code == 200
    with fresh_db.connection() as conn, conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) AS n FROM saved_properties WHERE guest_id='g_005'")
        assert cur.fetchone()["n"] == 0


def test_guest_search_is_admin_only_and_filters(client):
    body = {"page": 1, "page_size": 5}
    assert client.post("/guests/search", json=body, headers=auth("g_001", "guest")).status_code == 403
    admin = auth("adm_001", "admin")
    everyone = client.post("/guests/search", json=body, headers=admin).json()
    assert everyone["total"] == 12 and len(everyone["items"]) == 5 and everyone["page_size"] == 5
    assert [g["guest_id"] for g in everyone["items"]] == ["g_001", "g_002", "g_003", "g_004", "g_005"]
    by_name = client.post("/guests/search", json={**body, "query": "RIVERA"}, headers=admin).json()
    assert [g["guest_id"] for g in by_name["items"]] == ["g_002"]
    by_email = client.post("/guests/search", json={**body, "query": "oconnor@"}, headers=admin).json()
    assert by_email["total"] == 1
    san_jose = client.post("/guests/search", json={**body, "location": "san jose"}, headers=admin).json()
    assert {g["guest_id"] for g in san_jose["items"]} == {"g_001", "g_012"}
    assert client.post("/guests/search", json={"page": 0, "page_size": 5}, headers=admin).status_code == 400
    assert client.post("/guests/search", json={"page": 1, "page_size": 101}, headers=admin).status_code == 400
    assert client.post("/guests/search", json={**body, "query": "%"}, headers=admin).json()["total"] == 0   # % is not a wildcard


# ---------------------------------------------------------------- hosts
def test_host_get_is_public(client):
    response = client.post("/hosts/get", json={"host_id": "h_003"})
    assert response.status_code == 200
    assert response.json() == {"host_id": "h_003", "name": "Rob Feeney", "email": "rob.feeney@example.com", "phone": "(408) 555-0103", "profile_photo_url": "",
                               "verification_status": "pending", "response_rate": 62, "response_time": 540, "host_since": response.json()["host_since"], "access_level": "standard"}
    assert client.post("/hosts/get", json={"host_id": "h_099"}).status_code == 404
    assert client.post("/hosts/get", json={}).status_code == 400


def test_host_update_rules(client):
    h = auth("h_001", "host")
    ok = client.post("/hosts/update", json={"host_id": "h_001", "phone": "(408) 555-9999", "response_rate": 1}, headers=h)
    assert ok.status_code == 200 and ok.json()["phone"] == "(408) 555-9999" and ok.json()["response_rate"] == 98   # response_rate is not editable
    assert client.post("/hosts/update", json={"host_id": "h_002", "phone": "1"}, headers=h).status_code == 403
    assert client.post("/hosts/update", json={"host_id": "h_001", "phone": "1"}, headers=auth("g_001", "guest")).status_code == 403
    assert client.post("/hosts/update", json={"host_id": "h_001", "email": "daniel.kim@example.com"}, headers=h).status_code == 409
    changed = client.post("/hosts/update", json={"host_id": "h_001", "email": "maya.new@example.com"}, headers=h)
    assert changed.status_code == 200 and login(client, "maya.new@example.com").status_code == 200


def test_no_token_on_protected_endpoints_is_401(client):
    for path, body in [("/guests/update", {"guest_id": "g_001"}), ("/guests/delete", {"guest_id": "g_001"}), ("/guests/search", {"page": 1, "page_size": 5}), ("/hosts/update", {"host_id": "h_001"})]:
        assert client.post(path, json=body).status_code == 401, path


def test_bad_json_is_400(client):
    response = client.post("/auth/login", content=b"{nope", headers={"Content-Type": "application/json"})
    assert response.status_code == 400 and error(response)["message"] == "The request body must be a JSON object."
