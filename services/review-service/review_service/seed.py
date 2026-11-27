"""python -m review_service.seed : load the mock's 46 reviews into MongoDB (only if empty)."""
from xenia_shared.config import load_env

load_env()

from .main import ensure_indexes, seed_if_empty  # noqa: E402

if __name__ == "__main__":
    ensure_indexes()
    count = seed_if_empty()
    print(f"seeded {count} reviews" if count else "reviews already present: nothing to do")
