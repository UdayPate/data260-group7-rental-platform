# Tanya: detailed guide

Same step numbers as the checklist ([tanya-steps.md](tanya-steps.md)). For each step: what and
why, the contract sections, what the mock already does (your working reference), what the
backend must do properly, how to test it against the real frontend, and common mistakes.

Links: contract = [`docs/api/data-contract.md`](../api/data-contract.md), mocks =
`frontend/src/mocks/`, switching = [frontend README](../../frontend/README.md#switch-one-service-at-a-time-from-mocks-to-real).

**How to test any step against the UI:** `cd frontend && npm run dev`, put your service's URL in
`frontend/.env.local` (keep `VITE_USE_MOCKS=true`), restart, log in, and use the page. Only your
service is real; the others stay mocked. When your service returns an error, the UI shows your
`message` text, which is a quick check that the error format is right.

---

## 1. Infra (docker-compose)

**What and why.** One `infra/docker-compose.yml` that starts Kafka, MySQL 8, MongoDB and Redis
(spec 3.1 three tiers, 6.1 Kafka, 3.2 databases, 13.9 Redis). Every other step and every teammate
depends on it.

**Build:**
- Kafka in KRaft mode (no ZooKeeper needed) with a host listener on `localhost:9092`.
- MySQL 8 with a volume, and `infra/mysql/*.sql` mounted into `/docker-entrypoint-initdb.d/`.
- MongoDB with `infra/mongo/*.js` mounted the same way.
- Redis.
- Health checks on all four, so services can wait for them.
- `infra/kafka/create-topics.sh` creating every topic with **3 partitions** (spec 13.11 needs
  partitions; three debates can then run in parallel):

| Topic | Producer → consumer |
|---|---|
| `booking.requested`, `booking.approved`, `booking.declined`, `booking.cancelled`, `booking.completed` | Booking API → booking worker, Analytics |
| `availability.blocked`, `availability.released` | booking worker / Property Service → Property Service (WebSocket push), Analytics |
| `property.viewed`, `property.saved`, `search.performed`, `availability.notified` | Property Service / Analytics ingest → Analytics |
| `review.created` | Review Service (Himja) → Property Service (rating), Analytics |
| `message.sent` | Messaging Service (Himja) → Analytics |
| `ai.requests`, `debate.round.0`, `debate.round.1`, `debate.round.2`, `ai.results` | AI service (Himja) |
| `trace.steps` | every service → Analytics (journey steps, spec §8) |
| `dead.letter` | every service → Analytics (dead-letter list on the Platform dashboard) |

**Test.** `docker compose up -d`, then `docker compose ps` shows all healthy and the topic list
script prints every topic.

**Common mistakes:**
- Advertising only the Docker-internal Kafka address, so services running on the laptop can't
  connect. Set two listeners: an internal one and `localhost:9092`.
- Auto-created topics with 1 partition, which hides the trace isolation and consumer-group
  scaling the spec asks to demonstrate. Turn auto-create off and use the script.
- Committing `.env` files. Commit `.env.example` only.

---

## 2. The `shared/` Python library

**What and why.** One package (e.g. `shared/xenia_shared/`, installable with `pip install -e shared`)
that every FastAPI service imports, so the rules are written once:

| Module | What it does | Spec / contract |
|---|---|---|
| `envelope.py` | Pydantic model of the envelope: `event_type`, `trace_id`, `timestamp` (UTC ISO), `actor_id`, `entity {entity_type, entity_id}`, `payload` (object), `idempotency_key`. `make_envelope(...)` and `validate(...)` | spec 6.2; contract [WebSocket message](../api/data-contract.md#websocket-propertiesproperty_idavailabilitystream-live-availability-spec-134), [Analytics ingest](../api/data-contract.md#analytics--logging-service-owners-rohini-and-shashank) |
| `kafka.py` | `publish(topic, envelope, key)`: validates **before** publishing. `consume(topic, group, handler)`: validates **after** consuming; invalid → `dead.letter` with the original `trace_id` and the reason; skips an `idempotency_key` already processed; retries with bounded exponential backoff (e.g. 3 tries, 1 s, 2 s, 4 s), then dead-letters; commits the offset **only after** the handler succeeded | spec 6.2, §10 |
| `auth.py` | FastAPI dependency `require(roles=[...], own=[...])`: reads `Authorization: Bearer` (or `?token=` for WebSockets), verifies HS256 with `JWT_SECRET` from the env, checks `exp`, role, and that "own" id fields equal `sub` | contract [Authentication and roles](../api/data-contract.md#authentication-and-roles-for-tanya-himja-rohini-and-shashank) |
| `errors.py` | `ApiError(code, http_status, message, details)` and exception handlers that always return `{ "error": { code, message, details } }`, including FastAPI's own 422 validation errors converted to `400 VALIDATION_ERROR` | contract [§2](../api/data-contract.md#2-error-format) |
| `app.py` | `create_app(name)`: FastAPI app with CORS for `http://localhost:5173`, the error handlers, and a `/health` endpoint | |
| `trace.py` | `emit_step(trace_id, event_type, service, latency_ms, status, error)` → `trace.steps` topic | spec §8; contract Journeys |

**Mock reference.** The token check is `frontend/src/mocks/auth/gate.ts` (the `RULES` table is the
whole "who may call what" table as code). The envelope validation is in
`frontend/src/mocks/handlers/analytics.ts` (`/events/ingest`). Error helpers are in
`frontend/src/mocks/responses.ts`.

**Do properly in the backend:**
- **401 vs 403:** no, malformed, bad-signature or expired token → `401` ("Please log in to
  continue." / "Your session has expired. Please log in again."). Valid token but wrong role or
  another user's id → `403`. The UI sends the user to the login page on 401 only, so mixing them up
  breaks the UI.
- **Idempotency store:** a table or collection of processed `idempotency_key`s, written in the
  **same transaction** as the consumer's database change. Otherwise a crash between the two
  creates a duplicate (spec 13.2).
- **Never log full WebSocket URLs**: they contain `?token=`.

**Test.** `pytest shared/` with tests for:
- an envelope missing `idempotency_key` → `dead.letter`
- the same key twice → handled once
- expired token → 401
- guest token on a host endpoint → 403
- another guest's `guest_id` → 403

These are spec 12 "automated tests for envelope validation, idempotency".

**Common mistakes:**
- Each service writing its own JWT check, with slightly different rules.
- Committing the offset before the database write.
- Using `datetime.now()` without UTC.
- Accepting an unknown `event_type`.

---

## 3. Database scripts and seed

**What and why.** Spec 3.2: creation scripts, keys, indexes, constraints, sample rows, a schema
diagram and a written justification. MySQL for transactional data (accounts, guests, hosts,
properties, saved, availability, reservations, status history); MongoDB for flexible documents
(Himja's reviews, messages and debates; Rohini and Shashank's events and traces).

**Contract.** [§3 Entities](../api/data-contract.md#3-entities) (every field and type),
[§1 General rules](../api/data-contract.md#1-general-rules) (string ids, `YYYY-MM-DD` dates,
exclusive `check_out`, money in dollars), [§7 Mock reference data](../api/data-contract.md#7-mock-reference-data).

**Suggested MySQL tables:**
- `accounts` (email UNIQUE, case-insensitive collation; `password_hash`; `role`; `user_id`)
- `guests` (`preferences` as JSON), `hosts`, `properties` (`amenities` as JSON or a join table), `saved_properties` (PK guest_id + property_id)
- `availability_blocks`
- **`availability_nights` (PRIMARY KEY `property_id, night_date`)**: see step 6
- `reservations`, `reservation_status_history`, `idempotency_keys`
- Indexes: `properties(city)`, `properties(status, nightly_price)`, `reservations(guest_id)`, `reservations(property_id, status)`.

**Seed.** Same ids and values as `frontend/src/mocks/data/*.ts`:
- `hosts.ts`, `guests.ts`, `properties.ts`, `availability.ts`, `reservations.ts`, `pastStays.ts`, `saved.ts`, `accounts.ts`
- photo URLs are `/photos/p_001.jpg`…

Dates in those files are written as `daysFromToday(n)` / `daysAgoDatetime(n)`, so your seed script
must compute them **when it runs** (e.g. a Python `seed.py` with the same offsets). Otherwise
"upcoming" trips are in the past next week. All demo accounts use the bcrypt hash given in
[the contract](../api/data-contract.md#authentication-and-roles-for-tanya-himja-rohini-and-shashank).
Also create a **read-only MySQL user** (e.g. `ai_reader`) for Himja's AI service (it may read
properties, hosts, availability and reservations, never write).

**Test.** Fresh volume → counts:
- 30 properties (`p_012` inactive)
- 12 guests, 8 hosts
- 24 + 40 reservations
- 21 accounts

**Common mistakes:**
- Numeric auto-increment ids (the contract uses strings like `"p_001"`).
- `DATETIME` without UTC.
- Storing money in cents.
- Forgetting `ON DELETE` rules for guest deletion (past reservations and reviews are kept).

---

## 4. User Service

**What and why.** Spec §6 User endpoints plus login (team decision). Every teammate needs real
tokens, so this comes before the other services.

**Contract.** [User Service endpoints](../api/data-contract.md#user-service),
[Authentication and roles](../api/data-contract.md#authentication-and-roles-for-tanya-himja-rohini-and-shashank),
[Guest](../api/data-contract.md#guest-user-service), [Host](../api/data-contract.md#host-user-service).

**Rules the mock enforces** (`frontend/src/mocks/handlers/auth.ts`, `users.ts`):
- **Sign-up** (guest or host only, never admin):
  - password at least 8 characters, valid email, all required fields → `400`
  - email taken (ignoring case) → `409 EMAIL_TAKEN`
  - success → `201 { token, user }`, already logged in.
- **Log in:** unknown email and wrong password both give `401` with the same message, "Wrong email or password."
- **Token claims:** `sub`, `role`, `name`, `iat`, `exp = iat + 8 h`.
- **`/guests/create`, `/hosts/create`:** `403` from outside (only sign-up uses them).
- **`/guests/delete`:**
  - `409 INVALID_STATUS` with `details.reservation_ids` while the guest has upcoming pending or approved stays
  - otherwise it deletes the login and saved properties, and keeps past reservations and reviews.
- **Email change** updates the login email (`409` if taken).
- **`/guests/get`:** a host may read a guest only if that guest has a reservation at one of the host's listings.

**Do properly:** bcrypt cost 10 (`passlib[bcrypt]` or `bcrypt`), never log passwords, compare
emails case-insensitively at the database level (collation or a lowercased column).

**Test against the frontend.** `VITE_USER_API_BASE_URL=http://localhost:8001`:
1. Log in as Alex, Maya and the admin; each lands on their home page.
2. Sign up a new guest.
3. Use a wrong password: the readable message shows.
4. Edit and delete a profile on the Profile page.

**Common mistakes:**
- Returning `403` for a bad login. The UI needs `401`.
- A different error message for "unknown email", which leaks which emails exist.
- Forgetting `name` in the token. The header shows it.

---

## 5. Property Service: listings, search, save

**What and why.** Spec 5.1/5.2 guest search and host listings, §6 Property endpoints.

**Contract.** [Property Service](../api/data-contract.md#property-service),
[`POST /properties/search`](../api/data-contract.md#post-propertiessearch) (every filter rule),
[`POST /properties/save`](../api/data-contract.md#post-propertiessave),
[Property](../api/data-contract.md#property-property-service).

**Rules the mock enforces** (`frontend/src/mocks/handlers/properties.ts`):
- **Search:**
  - contains-match on city **or** address, case-insensitive
  - amenities = must have **all**; types = **any**
  - `available_only` requires both dates (`400`)
  - results in `property_id` order, paged `{ items, total, page, page_size }`, `page_size` 1–100
  - only `active` listings unless `host_id` is sent
  - `is_saved` filled for `guest_id`.
- **Update and delete:** the acting `host_id` must own the listing (`403`). Delete → `409` with `details.reservation_ids` while upcoming pending/approved stays exist.
- **Save:** idempotent; `saved: false` unsaves; the response includes `saved_properties_count` (keep the guest's count in sync).
- **Get:** returns inactive listings too, with `is_saved`.

**Do properly:**
- Publish `property.saved` and `property.viewed` events. The host funnel needs views and saves (spec 6.1). The UI sends `property.viewed` to Analytics ingest itself; `property.saved` comes from you.
- Real SQL with the indexes from step 3, so the "with and without indexes" experiment (spec 9) has something to measure.

**Test against the frontend.** `VITE_PROPERTY_API_BASE_URL=http://localhost:8002`:
- The demo search (San Jose, 2 guests, ≤ $250, parking + kitchen, 4.5+) shows `p_001 p_002 p_003 p_005 p_008 p_011`.
- Hearts save; Maya's My listings shows her 3; create, edit and delete a listing.

**Common mistakes:**
- Treating `location` as an exact match.
- "Any amenity" instead of "all amenities".
- Returning inactive listings to guests.
- Returning numbers as strings.

---

## 6. Availability with conflict detection (spec 13.3)

**What and why.** Host block/unblock, plus the calendar read, with **atomic** conflict detection
when two writers act at the same moment (spec 13.3).

**Contract.** [`POST /properties/availability`](../api/data-contract.md#post-propertiesavailability)
(rules 1–5), [AvailabilityBlock](../api/data-contract.md#availabilityblock-property-service).

**Rules the mock enforces:**
- Owner only (`403`).
- A new block may not overlap any blocked or booked night: `409 DATE_CONFLICT` with `details.availability_id`. First write wins, no merging.
- No past start (`400`); end after start (`400`).
- Only `source: "host"` blocks can be unblocked; booking blocks → `409 INVALID_STATUS`.
- Mock code: `properties.ts` (`/properties/availability`), `db.ts` `hasDateConflict`.

**Do properly: the mock only does read-then-write; the real service must use the database.**
Recommended design: an `availability_nights` table with `PRIMARY KEY (property_id, night_date)`.
1. A block (host or booking) inserts one row per night, **in one transaction**, together with its
   `availability_blocks` row.
2. If any night is already taken, the insert fails with a duplicate-key error.
3. Roll back and return `409 DATE_CONFLICT`.

MySQL itself then guarantees that two simultaneous writers can't both succeed. Unblock deletes
the rows.

The rejected alternative to write up in the report: a `SELECT ... FOR UPDATE` lock on the property
row. It also works, but it serialises every write for that property, and it is easy to forget the
lock in one code path.

**Report (spec 13.3) must discuss:** stale reads (the calendar the host saw may be old; the insert
is the source of truth), ordering (first commit wins), retries (a retried block with the same
dates gets `409`, which is safe).

**Test.** Maya on the Availability page: block, see it, unblock. Evidence script
`tests/evidence/availability-conflict/run.sh`: two overlapping block requests fired at the same
instant (two hosts' tokens can't both own it, so use two requests from Maya, or one host block plus
one booking) → one `201`, one `409`, and a MySQL query shows one set of nights.

**Common mistakes:**
- Checking overlap with `start < end` on blocks in Python and then inserting. That is a race.
- Forgetting that `end_date` is **exclusive**.

---

## 7. Booking API + worker: request, double booking, idempotency (spec 13.1, mandatory)

**What and why.** Spec 3.1: "separate the API service that accepts a request and produces an
event from the worker service that consumes the event and updates the database." Spec 13.1:
no two valid reservations for the same nights. Spec §10: idempotency keys.

**Contract.** [Booking Service](../api/data-contract.md#booking-service),
[§5 Booking rules](../api/data-contract.md#5-booking-rules-team-decisions) (rule 2 validation order and
the sync/worker split, rule 7 double booking, **rule 8 async booking**),
[Reservation](../api/data-contract.md#reservation-booking-service) (statuses `processing` and `failed`, `failure_code`).

**The pattern is async (team decision):** `POST /bookings/request` returns **`202`** with the reservation
in status **`processing`**; the worker later moves it to `pending` or `failed`. The UI polls
`/bookings/get` until it changes. The API never waits for the worker.

**Rules the mock enforces** (`frontend/src/mocks/handlers/bookings.ts` = the API,
`frontend/src/mocks/bookingWorker.ts` = the worker, `db.ts` `priceBreakdown`, `holdsDates`):
- **The API checks, in exactly this order** (contract §5 rule 2), and answers at once:
  1. required fields → `400`
  2. repeated `idempotency_key` → `200` with the original reservation (any status, even `processing`)
  3. dates → `400`
  4. guest count → `400`
  5. property exists → `404`
  6. property active → `409 INVALID_STATUS`
  7. guest exists → `404`
  8. guest count over capacity → `400`
  9. then: save the reservation as `processing` (with `price_breakdown`, a new `trace_id`,
     `failure_code: null`), publish `booking.requested`, return `202`.
- **The worker, per event:**
  - skips a reservation that is no longer `processing` (a redelivered event)
  - same guest already holds overlapping dates at this property → `failed`, `failure_code: "DUPLICATE_BOOKING"`
  - any blocked or booked overlap → `failed`, `failure_code: "DATE_CONFLICT"`, with the readable reason in `cancellation_reason`
  - otherwise it holds the dates, sets `pending`, and publishes `availability.blocked`.
- **Hosts never see** `processing` or `failed` reservations (`byProperty` leaves them out).
- **A `processing` reservation can't be cancelled, approved or declined yet** (`409 INVALID_STATUS`).

**Do properly in the backend:**
1. **API:**
   - validates (steps 1–8), creates `trace_id`
   - inserts the reservation as `processing` plus its idempotency key in MySQL
   - publishes `booking.requested` (key = `property_id`, so requests for one property are consumed in order)
   - returns `202`.
   - If Kafka is down, publishing fails: return `503 SERVICE_UNAVAILABLE` and roll back the insert, so
     there is never a `processing` row with no event behind it. (Or use an outbox table: insert the row
     and an outbox record in one transaction, and a relay publishes it. This is more robust; the report
     can discuss it.)
2. **Worker**, in **one MySQL transaction**:
   - `SELECT ... FOR UPDATE` the reservation and skip it unless it is `processing`
   - insert the `availability_nights` rows (step 6: the primary key makes double booking impossible)
     and the `booking` availability block
   - set `pending`, write the status-history row and the processed event's idempotency record
   - commit, **then** commit the Kafka offset, **then** publish `availability.blocked`.
3. **On a duplicate-key error on nights:**
   - roll back
   - in a new transaction, set `failed` with `failure_code: "DATE_CONFLICT"` and the reason, plus status history
   - commit, then commit the offset.
   - The `DUPLICATE_BOOKING` check (same guest, overlapping `pending` or `approved` at this
     property) runs inside the first transaction, before the insert.
4. **Transient errors** (deadlock, MySQL down): retry with backoff, then dead-letter (`shared/kafka.py`);
   the reservation stays `processing` and the evidence shows the retry.

**Idempotency, two layers:**
- the API's key: the same `idempotency_key` returns the original reservation with `200`
- the worker's status check plus its processed-event record: a redelivered `booking.requested`
  never holds dates twice.

**Evidence (spec 13.1).** `tests/evidence/double-booking/run.sh`:
1. Send 20 concurrent requests (different guests, same property and nights): all 20 get `202 processing`.
2. Wait until none is `processing`.
3. Exactly **1** is `pending` and **19** are `failed` with `DATE_CONFLICT`.
4. Print the MySQL rows (`reservations`, `availability_nights`) and the trace ids of the winner and a loser.

Add a pytest that does the same with threads.

**Test against the frontend.** `VITE_BOOKING_API_BASE_URL=http://localhost:8003`:
1. Alex picks nights on `p_005` and clicks "Request to book": the reservation page shows
   "Processing your request…" and then "Request sent!" within a second or two.
2. Sam requests the same nights: "Processing…", then "Some of these dates are no longer available…"
   with a "Pick other dates" link, and Trips shows it under Cancelled as "Not booked".
3. Stop the worker and request again: the page keeps "Processing…", and after 15 s adds "Still
   processing…". Start the worker: the page updates by itself.

**Common mistakes:**
- Checking availability in the API (it can't be atomic there), or in the worker without a constraint: a race.
- Making the API wait for the worker. The contract is `202`; the UI polls.
- Committing the Kafka offset before the transaction.
- Generating a new `trace_id` in the worker.
- Sending `availability.blocked` at `202` time (the dates aren't held until the worker commits).
- Showing `processing` / `failed` reservations to the host.

---

## 8. Approve, decline, cancel, reads, status history

**What and why.** Spec 5.2 host actions, §10 "record state transitions so a reservation can be
reconstructed after a restart."

**Contract.** [Booking Service](../api/data-contract.md#booking-service), [§5 rules 3–6](../api/data-contract.md#5-booking-rules-team-decisions).

**Rules the mock enforces** (`bookings.ts`, `releaseDates`):
- **Approve and decline:**
  - only the listing's host (`403`), only while `pending` (`409 INVALID_STATUS`)
  - decline saves the reason in `cancellation_reason` and frees the nights.
- **Cancel:**
  - guest: `pending` or `approved`
  - host: `approved` only, with a required reason (`400`)
  - both: only before the check-in day (`409`); frees the nights.
- **Every action** carries an `idempotency_key`.
- **`byGuest` / `byProperty`:** `{ items }` with an optional `status` filter. `get`: the guest or the listing's host only.

**Do properly:**
- Each action publishes its event (`booking.approved` / `declined` / `cancelled`) with the reservation's `trace_id`.
- Write a `reservation_status_history` row (old status, new status, actor, `trace_id`, time) **in the same transaction** as the status change.
- Freeing nights deletes the `availability_nights` rows and publishes `availability.released`.

**Test.** All three booking pages with the real service: Maya's Reservations (approve, decline with
reason), Alex's Trips (cancel), the reservation page status. Each wrong action shows the contract's
message.

**Common mistakes:**
- Letting the host cancel a `pending` request (they decline it).
- Forgetting to free nights on decline.
- Not checking the "before check-in day" rule against **today** in one timezone (UTC).

---

## 9. Daily job: completion and expiry

**What and why.** Contract §5 rule 6. Without it no stay ever becomes `completed`, so nobody can
ever write a review (Himja's Review Service requires it).

**Mock reference.** `db.ts` `runBookingJob()` (the mock runs it before every API call).

**Build.**
- A scheduled task in the booking worker (APScheduler, or an asyncio loop) once a day, **and once at start-up**.
- `approved` with `check_out <= today` → `completed` + `booking.completed`.
- `pending` with `check_in < today` → `declined` with "Expired: the host didn’t respond before check-in." and the nights released.
- Both write status history.

**Test.** Seed or insert an approved stay that ended yesterday, restart the worker: it shows as
completed on Alex's Trips (Past tab) with "Write a review".

**Common mistakes:** running it only at midnight, which never happens in a demo. Running it twice
at the same moment: make each update conditional on the current status
(`UPDATE ... WHERE status = 'approved'`).

---

## 10. Live availability WebSocket (spec 13.4)

**What and why.** "While one guest is viewing a property, another guest books the same dates. The
first guest's interface must receive a real-time update through Kafka and WebSockets."

**Contract.** [WebSocket `/properties/{property_id}/availability/stream`](../api/data-contract.md#websocket-propertiesproperty_idavailabilitystream-live-availability-spec-134):
- message shape (the envelope)
- `event_type` `availability.blocked` / `released`
- the `reason` values
- `idempotency_key = "<trace_id>:<availability_id>:<event_type>"`
- close `4404` for an unknown property
- nothing sent on connect.

**Mock reference.** `frontend/src/mocks/handlers/availability.ts` (the socket),
`frontend/src/mocks/availability/bus.ts` (who publishes what). The page code is
`frontend/src/realtime/availabilityStream.ts`.

**Do properly:**
- The path is **Kafka → Property Service → sockets**:
  - the booking worker publishes `availability.blocked` / `availability.released` after its commit
  - the Property Service publishes its own host block / unblock events
  - the Property Service consumes the topic and sends each message to every socket open for that `property_id`.
- **Timestamp:** `timestamp` is the time the block was **written** (the UI measures latency from it). Use UTC with milliseconds.
- **Multiple instances:** if you run more than one Property Service instance, each needs **its own consumer group** (e.g. `property-ws-<hostname>`), so every instance sees every event.
- **Token:** `?token=` is optional here (public page), but if sent it must be valid, else close `4401`.

**Test.** Two browser windows: Alex and Sam on `p_005` with the same nights picked. Sam requests →
Alex's calendar marks them within ~1 s and the button is disabled. Alex's page sends
`availability.notified` with `latency_ms` to Analytics (that is the spec's latency number).

**Common mistakes:**
- Pushing from the booking API before the database commit.
- Using one consumer group across instances, so only one instance gets each event.
- Sending the guest's id as `actor_id`; it must be `booking-service` / `property-service`.

---

## 11. Redis cache with invalidation (spec 13.9, mandatory)

**What and why.** "Cache property search results or availability data using Redis. When a host
changes price or availability, the cached value must be invalidated or refreshed correctly."

**Build:**
- **Cache `/properties/search` responses**, key = hash of the normalised filters (without `guest_id`; fill `is_saved` after the cache read, because saves are per guest). Optionally cache `/properties/availability` `get` per property.
- **Invalidation:** keep a version number `search:version` in Redis and put it in every key. Any property create, update or delete, any availability change, and any rating change (step 13) does `INCR search:version`, so all old keys become unreachable in one cheap operation and expire by TTL (e.g. 10 min). Availability keys: delete `avail:<property_id>` on each change.
- **Hit or miss:** add a response header `X-Cache: HIT|MISS` (a header doesn't change the contract) and count hits and misses.
- **Redis down:** catch the error, serve from MySQL, log a warning. Search must never fail because of the cache.

**Evidence.** `tests/evidence/redis/run.sh`:
1. search (MISS)
2. same search (HIT)
3. Maya updates `p_001`'s price
4. same search (MISS, new price)
5. timings of hit vs miss
6. invalidation cost (time of the `INCR`)
7. `docker compose stop redis` → search still `200`.

**Common mistakes:**
- Caching responses that include `is_saved`, so one guest's hearts show for another.
- Invalidating only on price but not on availability.
- Letting a Redis timeout fail the request.

---

## 12. Kafka consumer crash recovery (spec 13.2, mandatory)

**What and why.** "Stop a booking consumer after Kafka receives an event and then restart it. The
event must remain available; the restarted consumer must process it without creating a duplicate
reservation. Show offsets, retry behavior, idempotency records, and final database consistency."

**Build (mostly already true if steps 2 and 7 are right):**
- **Offsets:** manual commit after the transaction (`enable.auto.commit=false`).
- **Idempotency:** the key is written inside the same transaction.
- **Retries:** bounded retries with backoff for transient errors (deadlock, MySQL down); after the last retry → `dead.letter` with `trace_id` and reason, and a `trace.steps` record with status `retried` or `dead_lettered`.

**Evidence script.** `tests/evidence/consumer-recovery/run.sh`:
1. stop the worker
2. send a booking request: the API returns `202` and the reservation stays `processing` (the event is in Kafka)
3. `kafka-consumer-groups --describe --group booking-workers` shows **lag 1**
4. start the worker
5. lag goes to 0
6. the reservation is now `pending`; MySQL has one reservation for that `trace_id`, one set of held nights, one processed-event record, and status history `processing → pending`
7. resend the same event with `kafka-console-producer` → nothing changes (the worker skips a reservation that is no longer `processing`).

The frontend's mock has the same demo: the "Mock data" menu in the header → "Pause the worker"
(see `frontend/src/mocks/bookingWorker.ts`).

**Report must explain:**
- **Failure before the DB write:** nothing committed; the offset isn't committed either, so the
  event is redelivered and processed.
- **Failure after the DB write but before the offset commit:** the event is redelivered; the
  reservation is no longer `processing`, so the worker skips it.

**Common mistakes:** auto-commit on, or committing the offset in a `finally` block.

---

## 13. Rating update from `review.created`

**What and why.** Contract [Review rules 2 and 5](../api/data-contract.md#review-service-owner-himja):
Himja's Review Service publishes `review.created`, and the Property Service updates the listing
`rating = round((old_rating × old_count + new) / (old_count + 1), 2)` and `review_count + 1`.

**Do properly:**
- Consume with the shared consumer, so idempotency is by `idempotency_key = review_id` and a redelivery doesn't count the review twice.
- Do it in one transaction with the idempotency row.
- Bump `search:version` (step 11).

**Test.** Write a review as Alex on a completed stay (real Review Service, or mocked UI + a manual
`kafka-console-producer` event). The property page shows the new rating; replaying the event
changes nothing.

---

## 14. Performance switches and evidence pack

**What and why.** Rohini and Shashank run the performance experiments (spec 9, slide 5); they need
your services to switch configurations without code changes.

**Build (env settings in each service's `.env`):**
- `SEARCH_CACHE=on|off` (Redis on/off: the cache comparison and spec 13.8 cached search)
- `USE_KAFKA=on|off` for the booking request. Off = the API writes directly in one transaction, the "B" baseline; on = the API + worker path, "B+S+K". Keep the same transaction and constraint in both paths.
- An index on/off script (`infra/mysql/drop-search-indexes.sql` / `create-search-indexes.sql`) for "search latency with and without indexes" (spec 9)
- The MySQL **database name from the env** (`MYSQL_DATABASE`), so Rohini and Shashank can load their
  200-property evaluation pool into a separate `xenia_eval` database
- A **10,000-record generator** (`infra/seed/generate_large.py`): at least 10,000 properties or reservations with realistic values, for slide 5 ("populate the database with at least 10,000 random data points").

**Evidence folder.** `tests/evidence/README.md` lists every script (double-booking,
availability-conflict, consumer-recovery, redis) with the exact command, what it prints, and
what "pass" looks like (spec 13.13).

**Common mistakes:** a different validation path when Kafka is off, which makes the comparison
unfair.

---

## Checklist of things every endpoint must do

- The shared token check (`401` / `403`), from `shared/auth.py`.
- The shared error format, readable `message`.
- CORS for `http://localhost:5173`.
- `JWT_SECRET` from `.env` (never the mock's `DEV_ONLY_JWT_SECRET`), `.env.example` committed.
- Every Kafka message through `shared/kafka.py` (validated envelope, dead letter).
- A `trace.steps` record for every important step (spec §8), with the same `trace_id`.
- Tests for service logic, idempotency and duplicate-booking prevention (spec 12 checklist).
