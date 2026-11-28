"""MySQL access: a small connection pool, transactions, and id generation.

Every service has a "model and data access layer" (spec 3.1): SQL lives in each service's own
repository module and calls the helpers here. We use plain PyMySQL (not an ORM) so every query is
visible and can be explained live.
"""
from __future__ import annotations

import json
import logging
import os
import queue
import threading
from contextlib import contextmanager
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Iterator

import pymysql
import pymysql.cursors

from .config import env_int, env_str
from .timeutil import iso_seconds

log = logging.getLogger("xenia.db")

DUPLICATE_KEY = 1062
DEADLOCK = 1213
LOCK_WAIT_TIMEOUT = 1205
# Errors that are worth retrying: the database was busy or briefly unreachable.
TRANSIENT_CODES = {DEADLOCK, LOCK_WAIT_TIMEOUT, 1040, 2002, 2003, 2006, 2013, 2055}


def error_code(error: BaseException) -> int | None:
    args = getattr(error, "args", ())
    return args[0] if args and isinstance(args[0], int) else None


def is_duplicate_key(error: BaseException) -> bool:
    return isinstance(error, pymysql.err.IntegrityError) and error_code(error) == DUPLICATE_KEY


def is_transient(error: BaseException) -> bool:
    return isinstance(error, (pymysql.err.OperationalError, pymysql.err.InterfaceError)) and (
        error_code(error) in TRANSIENT_CODES or isinstance(error, pymysql.err.InterfaceError)
    )


class Database:
    """A pool of connections to one MySQL database. Thread-safe: FastAPI runs "def" endpoints in a
    thread pool, and each request borrows a connection for as long as it needs."""

    def __init__(self, host: str, port: int, user: str, password: str, database: str, pool_size: int = 20):
        self.settings = {"host": host, "port": port, "user": user, "password": password, "database": database}
        self.database = database
        self.pool_size = pool_size
        self._idle: queue.LifoQueue[pymysql.connections.Connection] = queue.LifoQueue()
        self._created = 0
        self._lock = threading.Lock()

    @classmethod
    def from_env(cls) -> "Database":
        """MYSQL_HOST / PORT / USER / PASSWORD / DATABASE. The database NAME comes from the environment
        so Rohini and Shashank can point a service at a separate evaluation database (xenia_eval)."""
        return cls(
            host=env_str("MYSQL_HOST", "127.0.0.1"),
            port=env_int("MYSQL_PORT", 3306),
            user=env_str("MYSQL_USER", "xenia"),
            password=env_str("MYSQL_PASSWORD", "xenia"),
            database=env_str("MYSQL_DATABASE", "xenia"),
            pool_size=env_int("DB_POOL_SIZE", 20),
        )

    def _connect(self) -> pymysql.connections.Connection:
        conn = pymysql.connect(
            **self.settings,
            charset="utf8mb4",
            cursorclass=pymysql.cursors.DictCursor,
            autocommit=False,
            connect_timeout=5,
            init_command="SET time_zone = '+00:00'",  # every timestamp is UTC
        )
        return conn

    def _borrow(self) -> pymysql.connections.Connection:
        try:
            conn = self._idle.get_nowait()
        except queue.Empty:
            with self._lock:
                can_create = self._created < self.pool_size
                if can_create:
                    self._created += 1
            if can_create:
                try:
                    return self._connect()
                except Exception:
                    with self._lock:
                        self._created -= 1
                    raise
            conn = self._idle.get(timeout=30)  # wait for someone to give one back
        try:
            conn.ping(reconnect=True)  # a connection that sat idle may have been closed by MySQL
        except Exception:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass
            conn = self._connect()
        return conn

    def _give_back(self, conn: pymysql.connections.Connection, broken: bool) -> None:
        if broken:
            try:
                conn.close()
            except Exception:  # noqa: BLE001
                pass
            with self._lock:
                self._created -= 1
        else:
            self._idle.put(conn)

    @contextmanager
    def transaction(self) -> Iterator[pymysql.connections.Connection]:
        """One database transaction: commits if the block finishes, rolls back if it raises."""
        conn = self._borrow()
        broken = False
        try:
            yield conn
            conn.commit()
        except BaseException:
            try:
                conn.rollback()
            except Exception:  # noqa: BLE001
                broken = True
            raise
        finally:
            self._give_back(conn, broken)

    @contextmanager
    def connection(self) -> Iterator[pymysql.connections.Connection]:
        """A connection for reads (it is rolled back at the end so nothing is left open)."""
        conn = self._borrow()
        broken = False
        try:
            yield conn
        except BaseException:
            raise
        finally:
            try:
                conn.rollback()
            except Exception:  # noqa: BLE001
                broken = True
            self._give_back(conn, broken)

    def next_id(self, prefix: str) -> str:
        """The next id for a prefix: 'p' -> 'p_031'. Atomic, so two requests never get the same id.

        Uses its OWN short transaction (committed straight away) so the counter row is not locked
        for the length of the caller's transaction. If the caller then rolls back, that number is
        simply skipped; ids need to be unique, not gap-free.
        """
        with self.transaction() as conn:
            with conn.cursor() as cur:
                cur.execute("UPDATE id_counters SET next_value = LAST_INSERT_ID(next_value + 1) WHERE prefix = %s", (prefix,))
                if cur.rowcount != 1:
                    raise RuntimeError(f"no id counter for prefix '{prefix}'")
                cur.execute("SELECT LAST_INSERT_ID() AS n")
                handed_out = int(cur.fetchone()["n"]) - 1
        return f"{prefix}_{handed_out:03d}"

    def close(self) -> None:
        while True:
            try:
                self._idle.get_nowait().close()
            except queue.Empty:
                break
            except Exception:  # noqa: BLE001
                pass
        self._created = 0


_default: Database | None = None
_default_lock = threading.Lock()


def get_db() -> Database:
    """The process-wide database, created on first use from the environment."""
    global _default
    with _default_lock:
        if _default is None:
            _default = Database.from_env()
        return _default


def set_db(database: Database | None) -> None:
    """Replace the process-wide database (used by tests)."""
    global _default
    with _default_lock:
        _default = database


# ---------- helpers for turning rows into the JSON the contract describes ----------

def fetch_all(conn: pymysql.connections.Connection, sql: str, params: Any = ()) -> list[dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return list(cur.fetchall())


def fetch_one(conn: pymysql.connections.Connection, sql: str, params: Any = ()) -> dict[str, Any] | None:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchone()


def execute(conn: pymysql.connections.Connection, sql: str, params: Any = ()) -> int:
    with conn.cursor() as cur:
        return cur.execute(sql, params)


def number(value: Any) -> int | float:
    """A DECIMAL from MySQL as a JSON number: 189.00 -> 189, 4.86 -> 4.86 (never a string)."""
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    return value


def jsonable(value: Any) -> Any:
    """One database value as JSON: Decimal -> number, date -> 'YYYY-MM-DD', datetime -> '...Z'."""
    if isinstance(value, Decimal):
        return number(value)
    if isinstance(value, datetime):
        return iso_seconds(value)
    if isinstance(value, date):
        return value.isoformat()
    return value


def json_column(value: Any) -> Any:
    """A JSON column comes back as text in PyMySQL: turn it back into a list or object."""
    if isinstance(value, (str, bytes)):
        return json.loads(value)
    return value
