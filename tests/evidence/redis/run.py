"""Spec 13.9 evidence: Redis cache with invalidation. Needs: User (8001), Property (8002) running with SEARCH_CACHE=on, Redis up.

Steps: search (MISS) -> same search (HIT) -> Maya changes p_001's price -> same search (MISS, NEW price) -> timings ->
cost of the invalidation -> stop Redis: search still answers 200 (uncached) -> start Redis again -> price restored.
"""
import os
import shutil
import statistics
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from common import PROPERTY_API, call, check, finish, login, wait_until  # noqa: E402

ROOT = Path(__file__).resolve().parents[3]
DEMO = {"location": "San Jose", "guest_count": 2, "max_price": 250, "amenities": ["parking", "kitchen"], "min_rating": 4.5, "page": 1, "page_size": 20}


def search(body=DEMO):
    began = time.perf_counter()
    status, data, headers = call(PROPERTY_API, "/properties/search", body)
    return status, data, headers.get("x-cache", "?"), (time.perf_counter() - began) * 1000


def price_of(data, pid="p_001"):
    return next(p["nightly_price"] for p in data["items"] if p["property_id"] == pid)


token, maya = login("maya.ortiz@example.com")
unique = {**DEMO, "min_price": 1 + int(time.time()) % 90}  # a search nobody has made: guaranteed to be a miss
status, first, cache, miss_ms = search(unique)
check("1. first search is a MISS", status == 200 and cache == "MISS", f"{cache}, {miss_ms:.1f} ms")
status, second, cache, hit_ms = search(unique)
check("2. the same search is a HIT with the same answer", cache == "HIT" and second == first, f"{cache}, {hit_ms:.1f} ms")

status, body, _ = call(PROPERTY_API, "/properties/get", {"property_id": "p_001"})
old_price = body["nightly_price"]
new_price = old_price + 7
started = time.perf_counter()
status, _, _ = call(PROPERTY_API, "/properties/update", {"property_id": "p_001", "host_id": maya["id"], "nightly_price": new_price}, token)
update_ms = (time.perf_counter() - started) * 1000
check(f"3. Maya changes p_001's price {old_price} -> {new_price}", status == 200, f"update call {update_ms:.1f} ms")
status, after, cache, _ = search(unique)
check("4. the same search is a MISS again and shows the NEW price (never the stale one)", cache == "MISS" and price_of(after) == new_price, f"{cache}, price {price_of(after)}")
check("   ... and then a HIT again", search(unique)[2] == "HIT")

hits = [search(unique)[3] for _ in range(30)]
misses = []
for n in range(10):
    misses.append(search({**DEMO, "min_price": 1 + (n * 7 + int(time.time())) % 95, "page_size": 20 - n})[3])
print(f"\n5. timings (ms): HIT median {statistics.median(hits):.1f}, MISS median {statistics.median(misses):.1f}  (30 hits, 10 misses; includes the HTTP round trip)")

try:
    import redis  # noqa: PLC0415

    client = redis.Redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379/0"))
    samples = []
    for _ in range(200):
        began = time.perf_counter()
        client.incr("search:version")
        samples.append((time.perf_counter() - began) * 1000)
    print(f"6. invalidation cost: one INCR search:version = median {statistics.median(samples):.3f} ms, max {max(samples):.3f} ms (200 tries)")
    print(f"   keys now: search:version = {client.get('search:version').decode()}")
except Exception as problem:  # noqa: BLE001
    print(f"6. invalidation cost: SKIPPED (python 'redis' package or Redis not reachable from this script: {problem})")

def restore_price() -> bool:
    return call(PROPERTY_API, "/properties/update", {"property_id": "p_001", "host_id": maya["id"], "nightly_price": old_price}, token)[0] == 200


def docker_compose(action: str, _service: str = "redis") -> bool:
    """Stop or start the Redis container. By its container name (xenia-redis), so it works with both
    infra/docker-compose.yml and the all-in-Docker docker-compose.yml at the repo root."""
    docker = shutil.which("docker")
    if not docker:
        return False
    done = subprocess.run([docker, action, "xenia-redis"], capture_output=True, text=True)
    return done.returncode == 0


try:
    if docker_compose("stop", "redis"):
        print("\n7. Redis STOPPED")
        status, down, cache, ms = search(unique)
        check("   search still answers 200 (from MySQL, uncached)", status == 200 and len(down["items"]) == len(after["items"]), f"{cache}, {ms:.1f} ms")
        check("   a price change still works with Redis down", call(PROPERTY_API, "/properties/update", {"property_id": "p_001", "host_id": maya["id"], "nightly_price": new_price + 1}, token)[0] == 200)
        docker_compose("start", "redis")
        check("   Redis started again: the cache comes back (MISS then HIT)", wait_until(lambda: (search(unique)[2], search(unique)[2]) == ("MISS", "HIT"), 20, 1))
    else:
        print("\n7. SKIPPED: could not run `docker compose stop redis` (docker missing or not running). Stop Redis yourself, run the search once, check it answers 200, start Redis again.")
finally:
    print("\nRestoring p_001's price:", "done" if restore_price() else "FAILED, set it back by hand to " + str(old_price))
finish("redis")
