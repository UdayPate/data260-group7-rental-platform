"""The shared token check (contract: "Authentication and roles"). Every service runs it BEFORE
the endpoint, by adding one dependency:

    @app.post("/properties/create")
    def create(body=Depends(json_body), claims=Depends(require(["host"], own=["host_id"]))): ...

The order of the checks (same as the frontend mock, frontend/src/mocks/auth/gate.ts):
  1. No token, bad signature, malformed or expired            -> 401 UNAUTHENTICATED
  2. The token's role is not allowed for this endpoint         -> 403 UNAUTHORIZED
  3. A field marked "own" (guest_id, host_id...) is not the token's own id -> 403 UNAUTHORIZED
  4. An optional extra check (e.g. "is this your reservation?")             -> 403 UNAUTHORIZED
401 means "log in"; the UI sends the user to the login page ONLY on 401. 403 means "you may not".
"""
from __future__ import annotations

import json
import logging
import os
import time
from dataclasses import dataclass
from typing import Any, Callable, Iterable, Literal

import jwt
from fastapi import Request
from starlette.concurrency import run_in_threadpool

from .errors import ApiError

log = logging.getLogger("xenia.auth")

TOKEN_LIFETIME_SECONDS = 8 * 60 * 60  # one fixed expiry: 8 hours, no refresh tokens
ALGORITHM = "HS256"

# The frontend mock's development secret. It is public (it sits in frontend code), so a real
# service must refuse to start with it: anyone could forge a token.
FORBIDDEN_SECRETS = {"xenia-mock-secret-DO-NOT-USE-IN-REAL-SERVICES"}

Role = Literal["guest", "host", "admin"]


@dataclass(frozen=True)
class Claims:
    sub: str  # the user's id: g_001, h_001 or adm_001
    role: str
    name: str
    iat: int
    exp: int


def get_secret() -> str:
    """JWT_SECRET from the environment (each service's .env). Never hard-coded, never the mock's."""
    secret = os.environ.get("JWT_SECRET", "")
    if not secret:
        raise RuntimeError("JWT_SECRET is not set. Copy .env.example to .env and set a long random value.")
    if secret in FORBIDDEN_SECRETS:
        raise RuntimeError("JWT_SECRET is the frontend mock's public development secret. Use your own secret.")
    return secret


def sign_token(user_id: str, role: str, name: str, now: int | None = None) -> str:
    """Make a login token (used only by the User Service)."""
    issued = int(time.time()) if now is None else now
    claims = {"sub": user_id, "role": role, "name": name, "iat": issued, "exp": issued + TOKEN_LIFETIME_SECONDS}
    return jwt.encode(claims, get_secret(), algorithm=ALGORITHM)


_MESSAGES = {
    "missing": "Please log in to continue.",
    "invalid": "Your login is not valid any more. Please log in again.",
    "expired": "Your session has expired. Please log in again.",
}


def verify_token(token: str | None) -> Claims:
    """Return the token's claims, or raise 401 UNAUTHENTICATED."""
    if not token:
        raise ApiError("UNAUTHENTICATED", _MESSAGES["missing"])
    try:
        # Signature and expiry are both checked here. We require exp, sub and role to be present.
        data = jwt.decode(token, get_secret(), algorithms=[ALGORITHM], options={"require": ["exp", "sub"]})
    except jwt.ExpiredSignatureError as problem:
        raise ApiError("UNAUTHENTICATED", _MESSAGES["expired"]) from problem
    except jwt.PyJWTError as problem:
        raise ApiError("UNAUTHENTICATED", _MESSAGES["invalid"]) from problem
    if data.get("role") not in ("guest", "host", "admin"):
        raise ApiError("UNAUTHENTICATED", _MESSAGES["invalid"])
    return Claims(sub=str(data["sub"]), role=data["role"], name=str(data.get("name", "")), iat=int(data.get("iat", 0)), exp=int(data["exp"]))


def bearer_token(request: Request) -> str | None:
    """'Authorization: Bearer <token>' -> the token, else None."""
    header = request.headers.get("authorization", "")
    return header[7:].strip() if header.startswith("Bearer ") else None


def _role_words(roles: Iterable[str]) -> str:
    return " or ".join(roles)


def refuse_wrong_role(claims: Claims, roles: list[str]) -> None:
    if claims.role not in roles:
        article = "an" if claims.role == "admin" else "a"
        raise ApiError("UNAUTHORIZED", f"This is only for {_role_words(roles)} accounts. You’re logged in as {article} {claims.role}.")


CheckFn = Callable[[Claims, dict[str, Any], Request], "str | None"]


def require(
    roles: "list[str] | Literal['public', 'any'] | Callable[[dict[str, Any]], list[str] | Literal['public', 'any']]" = "any",
    own: Iterable[str] = (),
    check: CheckFn | None = None,
):
    """Build the FastAPI dependency for one endpoint.

    roles  "public" = anyone (a token that IS sent must still be valid); "any" = any logged-in
           user; or a list such as ["host"] / ["guest", "host"]. Or a function of the request body
           that returns one of those (for an endpoint with several actions, like /properties/availability).
    own    body (or query) fields that must equal the caller's id when present, e.g. ["guest_id"].
    check  optional extra rule, may query the database: returns a refusal message or None.
           Runs in a worker thread, so it may use blocking database calls.
    The dependency returns the caller's Claims, or None for a public call without a token.
    """
    own_fields = tuple(own)

    async def dependency(request: Request) -> Claims | None:
        body: dict[str, Any] | None = None
        if request.method == "POST":
            try:
                parsed = json.loads(await request.body())
                body = parsed if isinstance(parsed, dict) else None
            except ValueError:
                body = None
        own_values = [
            value
            for field in own_fields
            for value in [(body or {}).get(field, request.query_params.get(field))]
            if value is not None and value != ""
        ]
        token = bearer_token(request)
        allowed = roles(body or {}) if callable(roles) else roles

        # Public, and nothing in the request needs a login: no token required.
        if allowed == "public" and not own_values and not token:
            return None

        claims = verify_token(token)  # 1. who is calling? (401)
        if isinstance(allowed, list):
            refuse_wrong_role(claims, allowed)  # 2. right role? (403)
        if body is None and request.method == "POST":
            return claims  # not a JSON object: the endpoint itself answers 400 (after the login check above)
        if any(value != claims.sub for value in own_values):  # 3. your own id? (403)
            raise ApiError("UNAUTHORIZED", "You can only do this for your own account.")
        if check is not None:  # 4. endpoint-specific rule (403)
            refusal = await run_in_threadpool(check, claims, body or {}, request)
            if refusal:
                raise ApiError("UNAUTHORIZED", refusal)
        return claims

    return dependency


def claims_from_websocket_token(token: str | None) -> Claims | None:
    """For WebSockets (browsers can't set headers, so the token comes in ?token=).

    Returns None when no token was sent; raises ApiError(401) when one was sent but is bad, so the
    caller can close the socket with code 4401.
    """
    if not token:
        return None
    return verify_token(token)
