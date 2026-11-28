"""The error format (contract section 2). Every non-2xx response has this body:

    { "error": { "code": "DATE_CONFLICT", "message": "A readable sentence.", "details": { ... } } }

The UI shows `message` to the user exactly as sent, so it is written for a guest or host.
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger("xenia.errors")

STATUS_FOR_CODE: dict[str, int] = {
    "VALIDATION_ERROR": 400,
    "UNAUTHENTICATED": 401,
    "UNAUTHORIZED": 403,
    "NOT_FOUND": 404,
    "DATE_CONFLICT": 409,
    "DUPLICATE_BOOKING": 409,
    "INVALID_STATUS": 409,
    "DUPLICATE_REVIEW": 409,
    "EMAIL_TAKEN": 409,
    "SERVICE_UNAVAILABLE": 503,
    "INTERNAL_ERROR": 500,  # not in the contract; only for real bugs
}


class ApiError(Exception):
    """Raise this anywhere in an endpoint; the handler below turns it into the error response."""

    def __init__(self, code: str, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.code = code
        self.status = STATUS_FOR_CODE[code]
        self.message = message
        self.details = details


def error_body(code: str, message: str, details: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, "details": details}}


def _response(code: str, message: str, details: dict[str, Any] | None = None, status: int | None = None) -> JSONResponse:
    return JSONResponse(error_body(code, message, details), status_code=status or STATUS_FOR_CODE[code])


# MySQL error numbers that mean "the database is not reachable / too busy right now".
_DB_DOWN_CODES = {1040, 1045, 2002, 2003, 2006, 2013, 2055}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_: Request, error: ApiError) -> JSONResponse:
        return _response(error.code, error.message, error.details)

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, error: RequestValidationError) -> JSONResponse:
        # FastAPI's own 422 becomes our 400 VALIDATION_ERROR (e.g. a bad query or path value).
        names = [".".join(str(p) for p in item["loc"] if p != "body") for item in error.errors()]
        return _response("VALIDATION_ERROR", "The request is not valid: " + ", ".join(n or "body" for n in names) + ".", {"fields": names})

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, error: StarletteHTTPException) -> JSONResponse:
        if error.status_code == 404:
            return _response("NOT_FOUND", "There is nothing at this address.")
        if error.status_code == 405:
            return _response("VALIDATION_ERROR", "This address does not accept that kind of request.", status=405)
        return _response("INTERNAL_ERROR", str(error.detail), status=error.status_code)



def unexpected_response(error: Exception) -> JSONResponse:
    """What to answer when something not handled above went wrong."""
    # A database that is down is a 503 the UI can explain; anything else is a bug (500).
    args = getattr(error, "args", ())
    db_code = args[0] if args and isinstance(args[0], int) else None
    if type(error).__module__.startswith("pymysql") and db_code in _DB_DOWN_CODES:
        log.warning("database unavailable: %s", error)
        return _response("SERVICE_UNAVAILABLE", "The service is temporarily unavailable. Please try again in a moment.")
    log.error("unexpected error", exc_info=error)
    return _response("INTERNAL_ERROR", "Something went wrong on our side. Please try again.")


class CatchAllMiddleware:
    """Turns any unhandled exception into the shared error format.

    Why a middleware and not an exception handler: FastAPI runs the catch-all "Exception" handler
    OUTSIDE the CORS middleware, so a 500 would reach the browser without CORS headers and the UI
    would show a confusing "network error". This sits inside CORS, so even a 500 is readable.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        started = False

        async def tracking_send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
            await send(message)

        try:
            await self.app(scope, receive, tracking_send)
        except Exception as error:  # noqa: BLE001 - this IS the catch-all
            if started:
                raise
            await unexpected_response(error)(scope, receive, send)
