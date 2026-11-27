"""Fixtures: the Messaging Service against Tanya's REAL User, Property and Booking apps.

xenia_shared.upstream normally makes an HTTP call; here it is routed to the other services'
FastAPI apps in-process (TestClient), with the caller's token forwarded exactly as over HTTP.
MySQL is the test database (Tanya's fixture), MongoDB is mongomock, Kafka is the in-memory one.
"""
from __future__ import annotations

import mongomock
import pytest
from fastapi.testclient import TestClient

from xenia_shared import upstream
from xenia_shared.mongo import set_mongo_client

@pytest.fixture()
def real_upstream(fresh_db, kafka):
    from booking_service.main import app as booking_app
    from property_service.main import app as property_app
    from user_service.main import app as user_app

    clients = {"USER_API_BASE_URL": TestClient(user_app), "PROPERTY_API_BASE_URL": TestClient(property_app), "BOOKING_API_BASE_URL": TestClient(booking_app)}

    def route(base_env, path, body, token):
        headers = {"Authorization": f"Bearer {token}"} if token else {}
        response = clients[base_env].post(path, json=body, headers=headers)
        return response.status_code, response.json()

    upstream.set_override(route)
    set_mongo_client(mongomock.MongoClient())
    yield
    upstream.set_override(None)
    set_mongo_client(None)
