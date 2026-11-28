"""python -m messaging_service.seed : load the mock's threads and messages into MongoDB (only if empty)."""
from xenia_shared.config import load_env

load_env()

from .main import ensure_indexes, seed_if_empty  # noqa: E402

if __name__ == "__main__":
    ensure_indexes()
    count = seed_if_empty()
    print(f"seeded {count} threads" if count else "threads already present: nothing to do")
