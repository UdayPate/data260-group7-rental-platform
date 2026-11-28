"""Helpers for automated tests (pytest). Not used by the running services.

Tests run against a REAL MySQL (the one from docker compose, or any MySQL/MariaDB you point the
MYSQL_* settings at): a double-booking test is only meaningful against the database that enforces
the rule. The test database is called `xenia_test` and is recreated from infra/mysql/*.sql, so it
never touches the `xenia` demo data.

    MYSQL_HOST=127.0.0.1  MYSQL_PORT=3306
    MYSQL_TEST_ADMIN_USER=root  MYSQL_TEST_ADMIN_PASSWORD=rootpass     (needs rights to CREATE DATABASE)
"""
from __future__ import annotations

import os
import re
from pathlib import Path

import pymysql

from .config import env_int, env_str
from .db import Database

REPO_ROOT = Path(__file__).resolve().parents[2]
MYSQL_DIR = REPO_ROOT / "infra" / "mysql"


def split_sql(text: str) -> list[str]:
    """Split a .sql file into statements: drop '--' comment lines, split at a ';' ending a line."""
    lines = [line for line in text.splitlines() if not line.strip().startswith("--")]
    statements = re.split(r";[ \t]*\n", "\n".join(lines) + "\n")
    return [s.strip() for s in statements if s.strip()]


def _admin_connection(database: str | None = None) -> pymysql.connections.Connection:
    return pymysql.connect(
        host=env_str("MYSQL_HOST", "127.0.0.1"),
        port=env_int("MYSQL_PORT", 3306),
        user=env_str("MYSQL_TEST_ADMIN_USER", "root"),
        password=env_str("MYSQL_TEST_ADMIN_PASSWORD", "rootpass"),
        database=database,
        charset="utf8mb4",
        autocommit=True,
        connect_timeout=3,
    )


def run_sql_file(conn: pymysql.connections.Connection, path: Path) -> None:
    with conn.cursor() as cur:
        for statement in split_sql(path.read_text()):
            cur.execute(statement)


def mysql_reachable() -> bool:
    try:
        _admin_connection().close()
        return True
    except Exception:  # noqa: BLE001
        return False


def create_test_database(name: str = "xenia_test") -> Database:
    """Drop and recreate the test database with the schema and seed data; return a pool for it."""
    admin = _admin_connection()
    try:
        with admin.cursor() as cur:
            cur.execute(f"DROP DATABASE IF EXISTS `{name}`")
            cur.execute(f"CREATE DATABASE `{name}` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci")
            cur.execute(f"USE `{name}`")
        admin.select_db(name)
        run_sql_file(admin, MYSQL_DIR / "01_schema.sql")
        run_sql_file(admin, MYSQL_DIR / "03_seed.sql")
    finally:
        admin.close()
    os.environ["MYSQL_DATABASE"] = name
    return Database(
        host=env_str("MYSQL_HOST", "127.0.0.1"),
        port=env_int("MYSQL_PORT", 3306),
        user=env_str("MYSQL_TEST_ADMIN_USER", "root"),
        password=env_str("MYSQL_TEST_ADMIN_PASSWORD", "rootpass"),
        database=name,
        pool_size=60,
    )


def reseed(name: str = "xenia_test") -> None:
    """Put the seed data back (the seed file empties the tables first). Fast: used between tests."""
    conn = _admin_connection(name)
    try:
        run_sql_file(conn, MYSQL_DIR / "03_seed.sql")
    finally:
        conn.close()
