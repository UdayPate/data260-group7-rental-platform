"""Spec 12 / guide step 2: 401 vs 403, roles, and "own id" rules."""
import time

import jwt
import pytest
from fastapi import Depends
from fastapi.testclient import TestClient

from xenia_shared.app import create_app
from xenia_shared.auth import get_secret, require, sign_token
from xenia_shared.validation import json_body


@pytest.fixture(scope="module")
def client():
    app = create_app("auth-test")

    @app.post("/host-only")
    def host_only(body=Depends(json_body), claims=Depends(require(["host"], own=["host_id"]))):
        return {"ok": True, "sub": claims.sub}

    @app.post("/guest-or-host")
    def either(claims=Depends(require(["guest", "host"]))):
        return {"ok": True}

    @app.post("/public")
    def public(body=Depends(json_body), claims=Depends(require("public", own=["guest_id"]))):
        return {"ok": True, "who": claims.sub if claims else None}

    @app.post("/admin-only")
    def admin_only(claims=Depends(require(["admin"]))):
        return {"ok": True}

    @app.post("/boom")
    def boom():
        raise RuntimeError("a bug")

    return TestClient(app, raise_server_exceptions=False)


def token(user_id="h_001", role="host", name="Maya Ortiz"):
    return {"Authorization": "Bearer " + sign_token(user_id, role, name)}


def code(response):
    return response.json()["error"]["code"]


def test_no_token_is_401(client):
    response = client.post("/host-only", json={})
    assert response.status_code == 401 and code(response) == "UNAUTHENTICATED"
    assert response.json()["error"]["message"] == "Please log in to continue."


def test_garbage_token_is_401(client):
    assert client.post("/host-only", json={}, headers={"Authorization": "Bearer not.a.token"}).status_code == 401


def test_wrong_signature_is_401(client):
    forged = jwt.encode({"sub": "h_001", "role": "host", "name": "x", "iat": 1, "exp": int(time.time()) + 999}, "another-secret-that-is-long-enough-123456", algorithm="HS256")
    assert client.post("/host-only", json={}, headers={"Authorization": f"Bearer {forged}"}).status_code == 401


def test_the_frontend_mock_secret_cannot_forge_a_token(client):
    mock = jwt.encode({"sub": "h_001", "role": "host", "name": "x", "iat": 1, "exp": int(time.time()) + 999}, "xenia-mock-secret-DO-NOT-USE-IN-REAL-SERVICES", algorithm="HS256")
    assert client.post("/host-only", json={}, headers={"Authorization": f"Bearer {mock}"}).status_code == 401


def test_expired_token_is_401_with_its_own_message(client):
    expired = jwt.encode({"sub": "h_001", "role": "host", "name": "x", "iat": 1, "exp": int(time.time()) - 5}, get_secret(), algorithm="HS256")
    response = client.post("/host-only", json={}, headers={"Authorization": f"Bearer {expired}"})
    assert response.status_code == 401
    assert response.json()["error"]["message"] == "Your session has expired. Please log in again."


def test_guest_token_on_a_host_endpoint_is_403(client):
    response = client.post("/host-only", json={}, headers=token("g_001", "guest", "Alex Chen"))
    assert response.status_code == 403 and code(response) == "UNAUTHORIZED"
    assert response.json()["error"]["message"] == "This is only for host accounts. You’re logged in as a guest."


def test_admin_message_uses_an(client):
    response = client.post("/host-only", json={}, headers=token("adm_001", "admin", "Platform Admin"))
    assert response.json()["error"]["message"].endswith("You’re logged in as an admin.")


def test_another_hosts_id_is_403(client):
    response = client.post("/host-only", json={"host_id": "h_002"}, headers=token())
    assert response.status_code == 403
    assert response.json()["error"]["message"] == "You can only do this for your own account."


def test_own_id_passes(client):
    assert client.post("/host-only", json={"host_id": "h_001"}, headers=token()).json()["sub"] == "h_001"


def test_a_list_of_roles_names_both(client):
    response = client.post("/guest-or-host", headers=token("adm_001", "admin", "A"))
    assert "guest or host" in response.json()["error"]["message"]


def test_public_endpoint_needs_no_token(client):
    assert client.post("/public", json={}).json() == {"ok": True, "who": None}


def test_public_endpoint_with_a_guest_id_needs_a_token_and_it_must_be_yours(client):
    assert client.post("/public", json={"guest_id": "g_001"}).status_code == 401
    assert client.post("/public", json={"guest_id": "g_002"}, headers=token("g_001", "guest", "A")).status_code == 403
    assert client.post("/public", json={"guest_id": "g_001"}, headers=token("g_001", "guest", "A")).status_code == 200


def test_public_endpoint_with_a_bad_token_is_401(client):
    assert client.post("/public", json={}, headers={"Authorization": "Bearer nope"}).status_code == 401


def test_bad_json_with_a_valid_token_is_400_not_403(client):
    response = client.post("/host-only", content=b"not json", headers={**token(), "Content-Type": "application/json"})
    assert response.status_code == 400 and code(response) == "VALIDATION_ERROR"


def test_error_body_shape_and_unexpected_errors_are_500_in_the_same_shape(client):
    response = client.post("/boom")
    assert response.status_code == 500
    assert set(response.json()["error"]) == {"code", "message", "details"}


def test_unknown_path_is_404_in_the_error_shape(client):
    response = client.post("/nothing-here")
    assert response.status_code == 404 and code(response) == "NOT_FOUND"


def test_cors_allows_the_react_app(client):
    response = client.options("/public", headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization,content-type"})
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"


def test_health(client):
    assert client.get("/health").json()["status"] == "ok"


def test_secret_must_not_be_the_mock_secret(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "xenia-mock-secret-DO-NOT-USE-IN-REAL-SERVICES")
    with pytest.raises(RuntimeError):
        get_secret()
