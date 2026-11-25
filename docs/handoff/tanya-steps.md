# Tanya: checklist

Infra, `shared/`, User, Property and Booking services, Redis. Details for each step (same
numbers): [tanya-guide.md](tanya-guide.md). Steps 1–4 come first: everyone else is waiting on them.

**Mandatory features you own:** double booking (step 7), Kafka consumer recovery (step 12),
Redis invalidation (step 11).

---

- [ ] **1. Infra.** `infra/docker-compose.yml` with Kafka, MySQL 8, MongoDB, Redis, plus a script that creates every Kafka topic.
  - Done when: `docker compose up -d` starts all four, and `kafka-topics --list` shows every topic in the guide, including `dead.letter`.
  - Target: ____

- [ ] **2. `shared/` Python library.** Envelope model and validation, Kafka producer/consumer helpers (idempotency, retries, dead letter), JWT check, error format, CORS, trace-step emitter.
  - Done when: `pytest shared/` passes, with tests for a bad envelope going to `dead.letter`, a duplicate `idempotency_key` being skipped, and `401` vs `403`.
  - Target: ____

- [ ] **3. Database scripts and seed.** `infra/mysql/` tables, indexes, constraints and seed data (same ids as the mocks, dates relative to today); `infra/mongo/` init.
  - Done when: a fresh `docker compose up` gives 30 properties, 12 guests, 8 hosts, 24 + 40 reservations, the 21 demo accounts, and `SELECT` queries match `frontend/src/mocks/data/`.
  - Target: ____

- [ ] **4. User Service** (`/auth/signup`, `/auth/login`, `/guests/*`, `/hosts/*`).
  - Done when: with `VITE_USER_API_BASE_URL` set, logging in as `alex.chen@example.com` / `demo1234` on the frontend works, a wrong password shows "Wrong email or password.", and Profile edit/delete work.
  - Target: ____

- [ ] **5. Property Service: listings, search, save** (`/properties/create|get|update|delete|search|save`).
  - Done when: with `VITE_PROPERTY_API_BASE_URL` set, the spec's demo search (San Jose, 2 guests, ≤ $250, parking + kitchen, 4.5+) returns `p_001 p_002 p_003 p_005 p_008 p_011`, the hearts save, and Maya can create, edit and delete a listing.
  - Target: ____

- [ ] **6. Availability: get, block, unblock, with conflicts enforced by MySQL** (spec 13.3).
  - Done when: Maya blocks and unblocks dates on the Availability page, and a script firing two overlapping blocks at the same instant gets exactly one `201` and one `409 DATE_CONFLICT`.
  - Target: ____

- [ ] **7. Booking API + worker, async: request → `202 processing` → worker → `pending` or `failed`; double-booking prevention, idempotency** (spec 13.1, 3.1, contract §5 rule 8).
  - Done when: Alex requests a stay and the reservation page goes from "Processing…" to "Request sent!"; the same `idempotency_key` twice returns the original (`200`); `tests/evidence/double-booking/run.sh` fires 20 simultaneous requests for the same nights and ends with exactly 1 `pending` and 19 `failed` (`DATE_CONFLICT`), with MySQL showing one set of held nights.
  - Target: ____

- [ ] **8. Approve, decline, cancel, byGuest, byProperty, get, plus status history.**
  - Done when: with `VITE_BOOKING_API_BASE_URL` set, Maya approves and declines on Reservations, Alex cancels on Trips, every rule in contract §5 returns its code, and `reservation_status_history` shows each transition with its `trace_id`.
  - Target: ____

- [ ] **9. Daily job: completion and expiry.**
  - Done when: an `approved` stay whose check-out has passed becomes `completed` (Alex then sees "Write a review"), a stale `pending` becomes `declined` with "Expired: …", and both publish their Kafka event.
  - Target: ____

- [ ] **10. Live availability WebSocket** (spec 13.4).
  - Done when: in two browser windows (Alex, Sam) on the same property, Sam books and Alex's calendar marks the nights unavailable within about a second without a refresh, and Alex's "Request to book" is disabled.
  - Target: ____

- [ ] **11. Redis cache with invalidation** (spec 13.9, mandatory).
  - Done when: `tests/evidence/redis/run.sh` shows a miss then a hit, then Maya changes the price and the next search returns the new price (no stale value). With Redis stopped, search still works, uncached.
  - Target: ____

- [ ] **12. Kafka consumer crash recovery** (spec 13.2, mandatory).
  - Done when: `tests/evidence/consumer-recovery/run.sh` stops the booking worker, sends a request (it stays `processing`), restarts the worker, and shows the offsets, the event processed once, the reservation now `pending`, and one set of held nights in MySQL.
  - Target: ____

- [ ] **13. Rating update from `review.created`** (Himja's Review Service publishes it).
  - Done when: after a new 5-star review, the listing's `rating` and `review_count` follow contract Review rule 2, and replaying the same event changes nothing.
  - Target: ____

- [ ] **14. Performance switches and evidence pack.** Switches for the JMeter configurations (Kafka on/off, cache on/off, indexes on/off), 10,000-record generator, all evidence scripts in `tests/evidence/`.
  - Done when: Rohini and Shashank can run each configuration from the README of `tests/evidence/` without asking you.
  - Target: ____
