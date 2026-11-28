"""Reads settings from environment variables. Every service has a .env file (never committed) and
a .env.example (committed). `load_env()` loads the .env file next to the service, if there is one."""
from __future__ import annotations

import os
from pathlib import Path


def load_env(path: str | os.PathLike[str] | None = None) -> None:
    """Load KEY=VALUE lines from a .env file into os.environ (existing variables win).

    Tiny on purpose, so nobody has to learn another library: blank lines, # comment lines and trailing " # comments" are skipped.
    """
    env_file = Path(path) if path else Path.cwd() / ".env"
    if not env_file.is_file():
        return
    for line in env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        value = value.strip()
        if value[:1] not in ('"', "'"):
            # "SEARCH_CACHE=on   # comment": drop the trailing comment (a # that follows a space)
            value = value.split(" #")[0].split("\t#")[0].strip()
        os.environ.setdefault(key.strip(), value.strip('"').strip("'"))


def env_str(name: str, default: str = "") -> str:
    return os.environ.get(name, default)


def env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


def env_flag(name: str, default: bool = False) -> bool:
    """True for 1/true/on/yes, False for 0/false/off/no (any case); the default if not set."""
    value = os.environ.get(name)
    if value is None or value == "":
        return default
    return value.strip().lower() in {"1", "true", "on", "yes"}
