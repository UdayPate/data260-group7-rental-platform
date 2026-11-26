"""pytest fixtures shared by every service's tests. Loaded from the repo's top conftest.py."""
from __future__ import annotations

import pytest

from . import db as db_module
from . import kafka as kafka_module
from .testing import create_test_database, mysql_reachable, reseed


@pytest.fixture(scope="session")
def database():
    """The test MySQL database (schema + seed). Skips the test if no MySQL is reachable."""
    if not mysql_reachable():
        pytest.skip("MySQL is not reachable. Start it with `docker compose up -d` in infra/ (see tests/README.md).")
    pool = create_test_database()
    db_module.set_db(pool)
    yield pool
    db_module.set_db(None)
    pool.close()


@pytest.fixture()
def fresh_db(database):
    """The database with the seed data back in place, before each test that changes data."""
    reseed()
    return database


@pytest.fixture()
def kafka():
    """A new in-memory Kafka for the test (nothing from other tests is in it)."""
    transport = kafka_module.MemoryTransport()
    kafka_module.set_transport(transport)
    yield transport
    kafka_module.set_transport(None)
