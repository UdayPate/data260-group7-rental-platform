"""Xenia User Service (port 8001).

    POST /auth/signup  /auth/login
    POST /guests/create (sign-up only) /get /update /delete /search
    POST /hosts/create (sign-up only) /get /update

Rules: docs/api/data-contract.md ("User Service", "Authentication and roles").
Reference behaviour: frontend/src/mocks/handlers/auth.ts and users.ts.
Run:   uvicorn user_service.main:app --port 8001
"""
from __future__ import annotations

import json
import logging
from typing import Any

import bcrypt
from fastapi import Depends

from xenia_shared.app import create_app
from xenia_shared.auth import Claims, require, sign_token
from xenia_shared.config import load_env
from xenia_shared.db import get_db, is_duplicate_key
from xenia_shared.errors import ApiError
from xenia_shared.validation import check_paging, json_body, paged, require_fields

from . import models, repository

load_env()
log = logging.getLogger("xenia.user")
app = create_app("user-service")

BCRYPT_COST = 10  # contract: bcrypt, cost 10
ADMIN_NAME = "Platform Admin"
# A real bcrypt hash of nothing in particular. Comparing against it when the email is unknown makes
# "unknown email" take as long as "wrong password", so response time does not reveal which emails exist.
_DUMMY_HASH = bcrypt.hashpw(b"not-a-real-password", bcrypt.gensalt(BCRYPT_COST))


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(BCRYPT_COST)).decode()


def password_matches(password: str, password_hash: str | bytes) -> bool:
    try:
        return bcrypt.checkpw(password.encode()[: models.MAX_PASSWORD_BYTES], password_hash.encode() if isinstance(password_hash, str) else password_hash)
    except ValueError:
        return False


def guest_not_found(guest_id: Any) -> ApiError:
    return ApiError("NOT_FOUND", f"No guest found with id {guest_id}.")


def host_not_found(host_id: Any) -> ApiError:
    return ApiError("NOT_FOUND", f"No host found with id {host_id}.")


def display_name(account: dict[str, Any], conn) -> str | None:
    """The name shown in the header and put in the token; None if the profile no longer exists."""
    if account["role"] == "admin":
        return ADMIN_NAME
    if account["role"] == "guest":
        guest = repository.get_guest(conn, account["user_id"])
        return f"{guest['first_name']} {guest['last_name']}" if guest else None
    host = repository.get_host(conn, account["user_id"])
    return host["name"] if host else None


def login_response(user_id: str, role: str, name: str, status: int = 200):
    from fastapi.responses import JSONResponse

    return JSONResponse({"token": sign_token(user_id, role, name), "user": {"id": user_id, "role": role, "name": name}}, status_code=status)


# ------------------------------------------------------------------ auth
@app.post("/auth/signup")
def signup(body: dict[str, Any] = Depends(json_body)):
    if body.get("role") not in ("guest", "host"):
        raise ApiError("VALIDATION_ERROR", "Choose whether this is a guest or a host account.")
    role = body["role"]
    require_fields(body, ["email", "password", "first_name", "last_name", "phone", "location"] if role == "guest" else ["email", "password", "name", "phone"])
    models.check_email(body["email"])
    password = body["password"]
    if not isinstance(password, str) or len(password) < models.MIN_PASSWORD_LENGTH:
        raise ApiError("VALIDATION_ERROR", f"The password must be at least {models.MIN_PASSWORD_LENGTH} characters.")
    if len(password.encode()) > models.MAX_PASSWORD_BYTES:
        raise ApiError("VALIDATION_ERROR", f"The password must be at most {models.MAX_PASSWORD_BYTES} characters.")
    models.check_text_fields(body, ["first_name", "last_name", "name", "phone", "location"])

    db = get_db()
    taken = ApiError("EMAIL_TAKEN", "An account with this email already exists. Log in instead.")
    with db.connection() as conn:
        if repository.email_taken(conn, body["email"]):
            raise taken
    password_hash = hash_password(password)  # slow on purpose; done outside the transaction
    try:
        # The guest or host AND its login are created together, or not at all.
        with db.transaction() as conn:
            if role == "guest":
                user_id = repository.insert_guest(conn, db, body, json.dumps(models.default_preferences()))
                name = f"{body['first_name']} {body['last_name']}"
            else:
                user_id = repository.insert_host(conn, db, body)
                name = body["name"]
            repository.insert_account(conn, body["email"], password_hash, role, user_id)
    except Exception as problem:  # noqa: BLE001
        if is_duplicate_key(problem):  # two sign-ups with the same email at the same instant
            raise taken from problem
        raise
    return login_response(user_id, role, name, 201)


@app.post("/auth/login")
def login(body: dict[str, Any] = Depends(json_body)):
    require_fields(body, ["email", "password"])
    wrong = ApiError("UNAUTHENTICATED", "Wrong email or password.")
    if not isinstance(body["email"], str) or not isinstance(body["password"], str):
        raise wrong
    with get_db().connection() as conn:
        account = repository.find_account(conn, body["email"])
        if account is None:
            password_matches(body["password"], _DUMMY_HASH)  # spend the same time as a real check
            raise wrong
        ok = password_matches(body["password"], account["password_hash"])
        name = display_name(account, conn) if ok else None
    if not ok or name is None:  # same answer for an unknown email and a wrong password
        raise wrong
    return login_response(account["user_id"], account["role"], name)


# ------------------------------------------------------------------ guests
def _guest_get_rule(claims: Claims, body: dict[str, Any], _request) -> str | None:
    refusal = "You can only see your own profile, or guests who booked one of your listings."
    if claims.role == "guest":
        return None if claims.sub == body.get("guest_id") else refusal
    with get_db().connection() as conn:
        return None if repository.host_has_guest(conn, claims.sub, str(body.get("guest_id"))) else refusal


@app.post("/guests/create")
def guests_create(_claims=Depends(require("any", check=lambda *_: "Accounts are created with /auth/signup."))):
    raise ApiError("UNAUTHORIZED", "Accounts are created with /auth/signup.")  # never reached: the check above refuses first


@app.post("/guests/get")
def guests_get(_claims=Depends(require(["guest", "host"], check=_guest_get_rule)), body: dict[str, Any] = Depends(json_body)):
    require_fields(body, ["guest_id"])
    with get_db().connection() as conn:
        guest = repository.get_guest(conn, body["guest_id"])
    if guest is None:
        raise guest_not_found(body["guest_id"])
    return models.guest_json(guest)


@app.post("/guests/update")
def guests_update(_claims=Depends(require(["guest"], own=["guest_id"])), body: dict[str, Any] = Depends(json_body)):
    require_fields(body, ["guest_id"])
    db = get_db()
    changes: dict[str, Any] = {}
    with db.connection() as conn:
        if repository.get_guest(conn, body["guest_id"]) is None:
            raise guest_not_found(body["guest_id"])
        models.check_text_fields(body, ["first_name", "last_name", "phone", "location", "profile_photo_url"])
        if body.get("email") is not None:
            models.check_email(body["email"])
            if repository.email_taken(conn, body["email"], body["guest_id"]):
                raise ApiError("EMAIL_TAKEN", "Another account already uses this email.")
        for field in models.GUEST_EDITABLE:
            if field in body and body[field] is not None:
                changes[field] = json.dumps(models.clean_preferences(body[field])) if field == "preferences" else body[field]
    try:
        with db.transaction() as conn:
            repository.update_guest(conn, body["guest_id"], changes)
            if "email" in changes:
                repository.update_account_email(conn, body["guest_id"], changes["email"])  # the login email follows the profile email
            guest = repository.get_guest(conn, body["guest_id"])
    except Exception as problem:  # noqa: BLE001
        if is_duplicate_key(problem):
            raise ApiError("EMAIL_TAKEN", "Another account already uses this email.") from problem
        raise
    return models.guest_json(guest)


@app.post("/guests/delete")
def guests_delete(_claims=Depends(require(["guest"], own=["guest_id"])), body: dict[str, Any] = Depends(json_body)):
    require_fields(body, ["guest_id"])
    with get_db().transaction() as conn:
        if repository.get_guest(conn, body["guest_id"]) is None:
            raise guest_not_found(body["guest_id"])
        upcoming = repository.upcoming_reservation_ids_for_guest(conn, body["guest_id"])
        if upcoming:
            raise ApiError(
                "INVALID_STATUS",
                f"You have {len(upcoming)} upcoming trip(s). Cancel them before deleting your profile.",
                {"reservation_ids": upcoming},
            )
        repository.delete_account(conn, body["guest_id"])  # the login goes too
        repository.delete_guest(conn, body["guest_id"])    # saved properties cascade; past reservations stay
    return {"guest_id": body["guest_id"], "deleted": True}


@app.post("/guests/search")
def guests_search(_claims=Depends(require(["admin"])), body: dict[str, Any] = Depends(json_body)):
    check_paging(body.get("page"), body.get("page_size"))
    query = body.get("query") if isinstance(body.get("query"), str) else None
    location = body.get("location") if isinstance(body.get("location"), str) else None
    with get_db().connection() as conn:
        rows, total = repository.search_guests(conn, query, location, int(body["page"]), int(body["page_size"]))
    return paged([models.guest_json(r) for r in rows], total, body["page"], body["page_size"])


# ------------------------------------------------------------------ hosts
@app.post("/hosts/create")
def hosts_create(_claims=Depends(require("any", check=lambda *_: "Accounts are created with /auth/signup."))):
    raise ApiError("UNAUTHORIZED", "Accounts are created with /auth/signup.")


@app.post("/hosts/get")
def hosts_get(_claims=Depends(require("public")), body: dict[str, Any] = Depends(json_body)):
    require_fields(body, ["host_id"])
    with get_db().connection() as conn:
        host = repository.get_host(conn, body["host_id"])
    if host is None:
        raise host_not_found(body["host_id"])
    return models.host_json(host)


@app.post("/hosts/update")
def hosts_update(_claims=Depends(require(["host"], own=["host_id"])), body: dict[str, Any] = Depends(json_body)):
    require_fields(body, ["host_id"])
    db = get_db()
    changes: dict[str, Any] = {}
    with db.connection() as conn:
        if repository.get_host(conn, body["host_id"]) is None:
            raise host_not_found(body["host_id"])
        models.check_text_fields(body, ["name", "phone", "profile_photo_url"])
        if body.get("email") is not None:
            models.check_email(body["email"])
            if repository.email_taken(conn, body["email"], body["host_id"]):
                raise ApiError("EMAIL_TAKEN", "Another account already uses this email.")
        for field in models.HOST_EDITABLE:
            if field in body and body[field] is not None:
                changes[field] = body[field]
    try:
        with db.transaction() as conn:
            repository.update_host(conn, body["host_id"], changes)
            if "email" in changes:
                repository.update_account_email(conn, body["host_id"], changes["email"])
            host = repository.get_host(conn, body["host_id"])
    except Exception as problem:  # noqa: BLE001
        if is_duplicate_key(problem):
            raise ApiError("EMAIL_TAKEN", "Another account already uses this email.") from problem
        raise
    return models.host_json(host)
