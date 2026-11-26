"""create_app(): a FastAPI app with everything every Xenia service needs already switched on."""
from __future__ import annotations

import logging
import os
import re
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .auth import get_secret
from .errors import CatchAllMiddleware, install_error_handlers

DEFAULT_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173"


class _HideTokens(logging.Filter):
    """WebSocket URLs carry ?token=<jwt>. Uvicorn's access log would print them, so blank them out."""

    def filter(self, record: logging.LogRecord) -> bool:
        pattern = re.compile(r"token=[^&\s\"']+")
        if isinstance(record.msg, str):
            record.msg = pattern.sub("token=***", record.msg)
        if record.args:
            record.args = tuple(pattern.sub("token=***", a) if isinstance(a, str) else a for a in record.args)
        return True


def create_app(name: str, **fastapi_kwargs: Any) -> FastAPI:
    """CORS for the React app (the browser calls every service directly), the shared error format,
    and GET /health. Fails at start-up if JWT_SECRET is missing or is the frontend's public one."""
    get_secret()
    logging.getLogger("uvicorn.access").addFilter(_HideTokens())
    app = FastAPI(title=name, **fastapi_kwargs)
    app.add_middleware(CatchAllMiddleware)  # added first = inside CORS, so even a 500 carries CORS headers
    origins = [o.strip() for o in os.environ.get("CORS_ORIGINS", DEFAULT_ORIGINS).split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_methods=["*"],
        allow_headers=["Authorization", "Content-Type"],
        expose_headers=["X-Cache"],
    )
    install_error_handlers(app)

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "service": name}

    return app
