# Cedar & Rye: Data Contract (User, Property, Booking, AI services)

This is the JSON contract between the React frontend and the backend services. The
frontend types in `frontend/src/types/` and the mock server in `frontend/src/mocks/`
follow it exactly, so a service that follows it can replace the mocks with no
frontend changes.

The frontend lead (Uday) owns the data shapes in this document, so treat them as final.
To change something, ask him first so the types and mocks change at the same time.

Covered so far: **User**, **Property**, **Booking**, **Review** and **AI Agent** services (all endpoints),
plus the entity shapes for messages and threads. The request and response bodies for
Messaging and Analytics will be added when those pages are built.

---

## 1. General rules

| Rule | Value |
|---|---|
| Transport | HTTP, JSON body, `Content-Type: application/json` |
| Method | `POST` for every endpoint in this document, including reads (spec §6) |
| Field names | `snake_case`, exactly as written here |
| IDs | **Strings**, never numbers. Format: prefix + `_` + number, e.g. `"g_001"`, `"h_004"`, `"p_014"`, `"r_025"`, `"a_007"`. Prefixes: `g` guest, `h` host, `p` property, `r` reservation, `a` availability block, `t` thread, `m` message, `v` review. The frontend only compares IDs as opaque strings, so UUID strings would also work. |
| Dates | `"YYYY-MM-DD"` string, e.g. `"2026-12-04"` |
| Datetimes | ISO 8601 in UTC with `Z`, e.g. `"2026-11-23T18:05:09Z"` |
| Money | JSON number of **US dollars** (not cents), e.g. `212.5` |
| Stay dates | `check_out` / `end_date` are **exclusive**: the guest leaves that day. Check-in 12-04 to check-out 12-06 = 2 nights (the 4th and 5th). Two stays overlap only if `a_start < b_end && b_start < a_end`, so back-to-back stays (one checks out the day the next checks in) are allowed. |
| Nullable fields | Sent as `null`, never left out |
| Who is acting | There is no login yet. The acting user's ID is sent in the body (`guest_id` / `host_id`), and the service checks it. |
| Success status | `201` for create and `bookings/request`, `200` for everything else |

---

## 2. Error format

Every non-2xx response has this body:

```json
{
  "error": {
    "code": "DATE_CONFLICT",
    "message": "Some of these dates are no longer available. Please pick other dates.",
    "details": { "reservation_id": "r_012" }
  }
}
```

- `message` is a complete, readable sentence. **The UI shows it to the user exactly as sent**, so write it for a guest or host, not a developer.
- `details` is optional and holds extra machine-readable info.

| `code` | HTTP | When |
|---|---|---|
| `VALIDATION_ERROR` | 400 | Missing or invalid field, bad JSON, bad date, check-out not after check-in, over capacity, etc. For missing fields, `details.missing_fields` is the list of names. |
| `UNAUTHORIZED` | 403 | The acting user isn't allowed to do this (e.g. a host approving another host's reservation) |
| `NOT_FOUND` | 404 | The ID in the request doesn't exist |
| `DATE_CONFLICT` | 409 | The requested dates overlap blocked or booked dates |
| `DUPLICATE_BOOKING` | 409 | The same guest already has an active request for overlapping dates at this property (sent with a different idempotency key). `details.reservation_id` = the existing one. |
| `INVALID_STATUS` | 409 | The action isn't allowed in the reservation's (or listing's) current status, e.g. approving an already-approved reservation |
| `DUPLICATE_REVIEW` | 409 | The stay already has a review, or the review already has a host reply |
| `SERVICE_UNAVAILABLE` | 503 | The service or a dependency it needs is down |

If a response is not in this shape, the frontend shows a generic "request failed (HTTP 500)" message.

---

## 3. Entities

`|null` means the value may be `null`.

### Guest (User Service)
| Field | Type | Notes |
|---|---|---|
| guest_id | string | |
| first_name | string | required on create |
| last_name | string | required on create |
| email | string | required on create; must look like an email; unique |
| phone | string | |
| location | string | home city, e.g. `"Seattle, WA"` |
| profile_photo_url | string | empty string = no photo |
| preferences | object | see below |
| saved_properties_count | number | maintained by the server |
| booking_count | number | all reservations this guest ever made (any status), maintained by the server |
| profile_created_datetime | datetime | set by the server |

`preferences`:
| Field | Type |
|---|---|
| preferred_locations | string[] |
| max_nightly_price | number\|null |
| property_types | PropertyType[] |
| amenities | Amenity[] |

### Host (User Service)
| Field | Type | Notes |
|---|---|---|
| host_id | string | |
| name | string | required on create |
| email | string | required on create; unique |
| phone | string | |
| profile_photo_url | string | empty string = no photo |
| verification_status | `"verified"` \| `"pending"` \| `"unverified"` | new hosts start `"unverified"` |
| response_rate | number | percent, 0–100 |
| response_time | number | average minutes to reply |
| host_since | date | |
| access_level | `"standard"` \| `"superhost"` | new hosts start `"standard"` |

### Property (Property Service)
| Field | Type | Notes |
|---|---|---|
| property_id | string | |
| host_id | string | must be an existing host |
| title | string | |
| description | string | |
| property_type | PropertyType | see list below |
| address | string | street address |
| city | string | |
| state | string | e.g. `"CA"` |
| zip_code | string | string, not number |
| latitude | number | defaults to 0 if not sent on create |
| longitude | number | defaults to 0 if not sent on create |
| capacity | number | max guests, whole number ≥ 1 |
| bedrooms | number | whole number ≥ 0 |
| bathrooms | number | ≥ 0, halves allowed (`1.5`) |
| amenities | Amenity[] | see list below |
| nightly_price | number | dollars, > 0 |
| cleaning_fee | number | dollars, ≥ 0, charged once per stay |
| status | `"active"` \| `"inactive"` | guests only see `active` listings in search |
| rating | number | average review rating 0–5 (0 = no reviews yet), maintained by the server |
| review_count | number | maintained by the server |
| created_datetime | datetime | |
| photo_url | string | **extension** (not in spec §4); empty string = no photo |

Availability is **not** embedded in the property; get it from `/properties/availability`.

**PropertyType** = `"house"`, `"apartment"`, `"condo"`, `"townhouse"`, `"private_room"`, `"guest_suite"`

**Amenity** = `"wifi"`, `"kitchen"`, `"parking"`, `"washer"`, `"dryer"`, `"air_conditioning"`, `"heating"`, `"workspace"`, `"pool"`, `"hot_tub"`, `"ev_charger"`

### AvailabilityBlock (Property Service)
| Field | Type | Notes |
|---|---|---|
| availability_id | string | |
| property_id | string | |
| start_date | date | first night |
| end_date | date | exclusive (like check-out) |
| status | `"available"` \| `"blocked"` \| `"booked"` | `blocked` = host closed the dates; `booked` = held by a reservation |
| source | `"host"` \| `"booking"` \| `"system"` | who created the block |
| updated_datetime | datetime | |

Any block whose status is not `"available"` makes those nights unavailable.

### Reservation (Booking Service)
| Field | Type | Notes |
|---|---|---|
| reservation_id | string | |
| property_id | string | |
| guest_id | string | |
| check_in | date | |
| check_out | date | exclusive |
| guest_count | number | 1 to the property's capacity |
| price_breakdown | object | see below; calculated by the server at request time |
| booking_datetime | datetime | when the request was made |
| status | ReservationStatus | see rules in section 5 |
| cancellation_reason | string\|null | also holds the host's decline reason |
| guest_message | string\|null | optional note from the guest |

`price_breakdown`:
| Field | Type | Rule |
|---|---|---|
| nights | number | days between check_in and check_out |
| nightly_price | number | the property's price when the request was made |
| subtotal | number | nights × nightly_price |
| cleaning_fee | number | the property's cleaning fee |
| total | number | subtotal + cleaning_fee (no taxes or service fee) |

**ReservationStatus** = `"pending"`, `"approved"`, `"declined"`, `"cancelled"`, `"completed"`

### Thread (Messaging Service), "conversation" in spec §4
| Field | Type |
|---|---|
| thread_id | string |
| guest_id | string |
| host_id | string |
| property_id | string |
| reservation_id | string\|null |
| created_datetime | datetime |

### Message (Messaging Service)
| Field | Type |
|---|---|
| message_id | string |
| thread_id | string |
| sender_id | string (a guest_id or host_id) |
| receiver_id | string (a guest_id or host_id) |
| timestamp | datetime |
| message_text | string |
| delivery_status | `"sent"` \| `"delivered"` \| `"read"` |

### Review (Review Service)
| Field | Type | Notes |
|---|---|---|
| review_id | string | |
| reservation_id | string | |
| property_id | string | |
| guest_id | string | |
| host_id | string | |
| rating | number | whole number 1–5 |
| review_text | string | |
| created_datetime | datetime | |
| response_text | string\|null | the host's reply |

---

## 4. Endpoints

Paged responses use this shape (pages start at 1; `page_size` is 1–100):

```json
{ "items": [ ... ], "total": 29, "page": 1, "page_size": 12 }
```

Non-paged lists use `{ "items": [ ... ] }`.

### User Service

| Endpoint | Request body | Response |
|---|---|---|
| `POST /guests/create` | Guest **without** `guest_id`, `saved_properties_count`, `booking_count`, `profile_created_datetime` | `201` Guest |
| `POST /guests/get` | `{ "guest_id" }` | Guest |
| `POST /guests/update` | `{ "guest_id", ...only the fields being changed }` | updated Guest |
| `POST /guests/delete` | `{ "guest_id" }` | `{ "guest_id", "deleted": true }` (also removes the guest's saved properties). Returns `409 INVALID_STATUS` while the guest has upcoming pending or approved stays (`details.reservation_ids` lists them); past reservations and reviews are kept. |
| `POST /guests/search` | `{ "query"?, "location"?, "page", "page_size" }`; `query` = contains-match on name or email, `location` = contains-match on location (both case-insensitive) | paged Guest |
| `POST /hosts/create` | `{ "name", "email", "phone"?, "profile_photo_url"? }` | `201` Host |
| `POST /hosts/get` | `{ "host_id" }` | Host |
| `POST /hosts/update` | `{ "host_id", ...changed fields among name, email, phone, profile_photo_url }` | updated Host |

### Property Service

| Endpoint | Request body | Response |
|---|---|---|
| `POST /properties/create` | Property **without** `property_id`, `rating`, `review_count`, `created_datetime`. Required: `host_id`, `title`, `property_type`, `address`, `city`, `state`, `zip_code`, `capacity`, `bedrooms`, `bathrooms`, `nightly_price`, `cleaning_fee` | `201` Property |
| `POST /properties/get` | `{ "property_id", "guest_id"? }` | Property plus `"is_saved"` (same meaning as in search: `true` if `guest_id` saved it, `false` otherwise or when no `guest_id` is sent). Inactive listings are returned too. |
| `POST /properties/update` | `{ "property_id", "host_id", ...only the fields being changed }`. `host_id` is the **acting host** and must own the listing (else `403`); the owner can't be changed. | updated Property |
| `POST /properties/delete` | `{ "property_id", "host_id" }`. `host_id` must own the listing (else `403`). | `{ "property_id", "deleted": true }`. Returns `409 INVALID_STATUS` if the listing still has upcoming pending or approved reservations (`details.reservation_ids` lists them). |
| `POST /properties/search` | see below | paged PropertySearchResult |
| `POST /properties/save` | see below | see below |
| `POST /properties/availability` | One endpoint with an `action` (default `"get"`), see below | see below |

#### `POST /properties/search`

Request (every filter is optional; `page` and `page_size` are required):

```json
{
  "location": "san jose",
  "check_in": "2026-12-04",
  "check_out": "2026-12-06",
  "guest_count": 2,
  "min_price": 100,
  "max_price": 250,
  "property_types": ["house", "condo"],
  "amenities": ["parking", "kitchen"],
  "min_rating": 4.5,
  "available_only": true,
  "guest_id": "g_001",
  "host_id": "h_001",
  "page": 1,
  "page_size": 12
}
```

| Filter | Rule |
|---|---|
| location | case-insensitive **contains** match on `city` **or** `address` ("san jose", "Santana Row") |
| check_in / check_out | send both or neither; check_out must be after check_in |
| guest_count | `capacity >= guest_count` |
| min_price / max_price | on `nightly_price`, inclusive; min must not be above max |
| property_types | property matches **any** of them |
| amenities | property has **all** of them |
| min_rating | `rating >= min_rating` |
| available_only | needs check_in/check_out (else `400`); excludes properties with any non-`available` block overlapping the stay |
| guest_id | doesn't filter; fills `is_saved` for this guest |
| host_id | only this host's listings, **including inactive ones** (for the host's "My listings" page). Without it, only `active` listings are returned. |
| status | `"active"` or `"inactive"`: only listings with that status (used with `host_id`; without `host_id` only active listings exist in the results anyway) |

Results are in `property_id` order. Each item is a Property plus one extra field:

```json
{ "property_id": "p_001", "...all Property fields...": "...", "is_saved": true }
```

`is_saved` is an **extension**: `true` if `guest_id` saved this property, otherwise `false` (always `false` when no `guest_id` is sent).

#### `POST /properties/save`

There is no separate unsave endpoint; `saved: false` unsaves. Saving twice or unsaving something not saved is fine (same result).

Request:
```json
{ "guest_id": "g_001", "property_id": "p_005", "saved": true }
```
Response:
```json
{ "property_id": "p_005", "saved": true, "saved_properties_count": 4 }
```

#### `POST /properties/availability`

One endpoint, three actions:

| `action` | Request body | Response |
|---|---|---|
| `"get"` (or left out) | `{ "property_id", "start_date", "end_date" }` | `{ "items": AvailabilityBlock[] }` = every block overlapping the range |
| `"block"` | `{ "action": "block", "property_id", "host_id", "start_date", "end_date" }` | `201` the new AvailabilityBlock (`status: "blocked"`, `source: "host"`) |
| `"unblock"` | `{ "action": "unblock", "availability_id", "host_id" }` | `{ "availability_id", "unblocked": true }` |

**Availability rules (spec §13.3, team decision):**
1. `host_id` must own the listing, else `403 UNAUTHORIZED`.
2. A new block may **not overlap any blocked or booked night** (from another host block or a
   reservation): `409 DATE_CONFLICT`, with `details.availability_id` = the block it clashed with.
   No merging. The first write wins, and the second gets the 409 and must pick other dates. This must
   be enforced atomically in the database (same as double booking), so two hosts or services
   writing at the same moment can't both succeed.
3. Blocks can't start in the past (`400`); `end_date` must be after `start_date` (`400`).
4. Only blocks with `source: "host"` can be unblocked. Booking blocks return
   `409 INVALID_STATUS`; free those nights by declining or cancelling the reservation.
5. A guest's booking request that overlaps a host block gets `409 DATE_CONFLICT` (booking rule 2).

### Booking Service

| Endpoint | Request body | Response |
|---|---|---|
| `POST /bookings/request` | `{ "property_id", "guest_id", "check_in", "check_out", "guest_count", "guest_message"?, "idempotency_key" }` | `201` Reservation with status `pending` (or `200` with the original if the key was already used) |
| `POST /bookings/get` | `{ "reservation_id" }` | Reservation |
| `POST /bookings/byProperty` | `{ "property_id", "status"? }` | `{ "items": Reservation[] }` |
| `POST /bookings/byGuest` | `{ "guest_id", "status"? }` | `{ "items": Reservation[] }` |
| `POST /bookings/approve` | `{ "reservation_id", "host_id", "idempotency_key" }` | updated Reservation |
| `POST /bookings/decline` | `{ "reservation_id", "host_id", "reason"?, "idempotency_key" }` | updated Reservation (reason saved in `cancellation_reason`) |
| `POST /bookings/cancel` | `{ "reservation_id", "guest_id" **or** "host_id", "cancellation_reason", "idempotency_key" }`: send exactly one of guest_id / host_id | updated Reservation |

### Review Service (owner: Himja)

| Endpoint | Request body | Response |
|---|---|---|
| `POST /reviews/create` | `{ "reservation_id", "guest_id", "rating" (whole number 1–5), "review_text" (20–1000 characters after trimming) }` | `201` Review. The server fills `review_id`, `property_id`, `host_id` (from the reservation), `created_datetime`, `response_text: null`. |
| `POST /reviews/get` | `{ "review_id" }` | Review |
| `POST /reviews/byProperty` | `{ "property_id", "page", "page_size" }` | paged Review, **newest first** |
| `POST /reviews/byGuest` | `{ "guest_id" }` | `{ "items": Review[] }` newest first. **Extension** (not in spec §6): lets the Trips page find completed stays that still need a review. |
| `POST /reviews/respond` | `{ "review_id", "host_id", "response_text" (10–1000 characters) }` | updated Review |

**Review rules (team decisions):**
1. A review needs a reservation with status **`completed`** (else `409 INVALID_STATUS`), written by **that
   reservation's guest** (else `403 UNAUTHORIZED`), and **one review per reservation** (else `409 DUPLICATE_REVIEW`).
2. A new review **updates the listing**: `review_count + 1` and
   `rating = round((old_rating × old_count + new_rating) ÷ (old_count + 1), 2)`.
   (In the seed data a listing's `review_count` is its whole history; the Review Service may hold fewer
   full review records. The UI shows "Showing N of M reviews" when that happens.)
3. Only the **listing's host** may reply (`host_id` must match the review's `host_id`, else `403`), **once**
   (else `409 DUPLICATE_REVIEW`).
4. Reviews can't be edited or deleted. A deleted guest's reviews stay; the UI shows them as "Former guest".
5. Kafka: publish `review.created` (spec 6.1) with the review as payload and `idempotency_key` = `review_id`,
   so the Property Service can update the rating.

---

## 5. Booking rules (team decisions)

1. **Pending and approved reservations hold their dates.** When a request is created, the
   service adds a `booked` / `booking` availability block for its dates. Declining or
   cancelling removes that block. Approving keeps it.
2. **Request validation, in order:**
   - All required fields → `400`
   - Repeated `idempotency_key` → return the original reservation, `200`
   - Valid dates, check-in not in the past, check-out after check-in → `400`
   - `guest_count` ≥ 1 → `400`
   - Property exists → `404`
   - Property is `active` → `409 INVALID_STATUS`
   - Guest exists → `404`
   - `guest_count` ≤ capacity → `400`
   - Same guest, same property, overlapping active request → `409 DUPLICATE_BOOKING`
   - Any blocked or booked overlap → `409 DATE_CONFLICT`
3. **Approve / decline:** only the property's host (`host_id` must own the property, else
   `403`), and only while `pending` (else `409 INVALID_STATUS`).
4. **Cancel:**
   - **Guest** (`guest_id` = the reservation's guest, else `403`): allowed for `pending` or `approved`. The reason is optional (empty → stored as `null`).
   - **Host** (`host_id` owns the property, else `403`): allowed only for `approved`; `cancellation_reason` is required (`400` if empty). Hosts decline pending requests instead.
   - Both: only **before the check-in day** (`check_in` must be after today, else `409 INVALID_STATUS`).
   - No fees or refunds.
5. **Idempotency** (spec §10): every request, approve, decline and cancel carries an
   `idempotency_key` (the frontend sends a random UUID per user action and reuses it on retry).
   If the same key arrives again, return the result of the first call with `200` and change nothing.
6. **Status transitions:** `pending → approved | declined | cancelled`, `approved → cancelled | completed`.
   `completed` is set after check-out (by a backend job; the frontend never sets it).
7. **Double booking (spec §13.1):** the "no overlap" check in rule 2 must be enforced by the
   database or a transaction, not only by a read-then-write in code, so two simultaneous
   requests can't both succeed. The mocks don't do this for you.

---

## 6. AI Agent Service (owner: Himja)

The UI starts a recommendation, watches the debate live over a WebSocket, and then the guest
approves, edits or rejects the result. Types: `frontend/src/types/ai.ts`. Mock:
`frontend/src/mocks/ai/` (it runs a full debate on the seed data).

### 6.1 Endpoints

| Endpoint | Request | Response |
|---|---|---|
| `POST /ai/requests` | `{ "guest_id", "request_text" (10–500 chars), "demo"?: { "delay_risk_agent"?: bool, "invalid_agent_output"?: bool } }` | `202 { "task_id", "trace_id", "status": "waiting" }` |
| `GET /ai/tasks/{task_id}` | none | `{ "task": AiTask, "events": StreamEvent[] }`: the task **and every event so far**, in `seq` order (so a reload rebuilds the debate) |
| `GET /ai/results/{task_id}` | none | `AiResult`; `409 INVALID_STATUS` while the debate is still running |
| `POST /ai/tasks/{task_id}/approve` | `{ "guest_id", "edits"?: { "property_id"?, "rationale"? }, "reason"? }` | updated `AiResult`. With any real edit, the decision is `"edited"`, otherwise `"approved"`. `edits.property_id` must be one of `result.ranked` (else `400`). |
| `POST /ai/tasks/{task_id}/reject` | `{ "guest_id", "reason" }` (reason required) | updated `AiResult` with decision `"rejected"` |
| WebSocket `/ai/tasks/{task_id}/stream?after_seq=N` | none | see 6.3 |

Errors use the normal error format: unknown task `404`; a different guest approving or rejecting
`403 UNAUTHORIZED`; approving/rejecting before the result exists, or a second time,
`409 INVALID_STATUS`; bad input `400`. The UI never sees the agents directly, only these endpoints.

**Human approval (spec 7.5.1):** approving does **not** book anything. The UI shows a link to the
booking page, and the guest sends the booking request themselves. No agent may confirm a
booking, change availability or send a message.

### 6.2 Shapes

**AiTask**

| Field | Type | Notes |
|---|---|---|
| task_id | string | e.g. `"task_001"` |
| trace_id | string | UUID; **never changes** across the whole workflow (request, every round, challenge, vote, result, approval) |
| guest_id | string | |
| request_text | string | |
| status | TaskStatus | `"waiting"`, `"planning"`, `"in_debate"`, `"waiting_for_approval"`, `"completed"`, `"failed"`, `"timed_out"` (spec 7.5.1) |
| demo | `{ delay_risk_agent: bool, invalid_agent_output: bool }` | the demo switches used (both `false` by default) |
| plan | Plan \| null | |
| requirements | ParsedRequirements \| null | |
| created_datetime / updated_datetime | datetime | |
| error | string \| null | |

**Plan** (spec 7.5.2): `{ plan_id, trace_id, created_datetime, steps: PlanStep[] }`.
**PlanStep**: `{ step_id ("s1"…), order, title, input, expected_output, agent, status, note }`, where `status` is
`"pending" | "in_progress" | "done" | "skipped" | "failed"`. The 7 steps are the spec's: read requirements (parser),
retrieve properties, independent rankings, find disagreements, challenges and responses,
re-check availability (chair), prepare the recommendation (explanation). A skipped or failed step
must have a `note` explaining why (never continue silently).

**ParsedRequirements**: `{ location, check_in, check_out, dates_assumed, guest_count, max_nightly_price, min_rating, amenities[], property_types[] }`;
anything not mentioned is `null` (or `[]`). If the request has no dates, the parser picks some
and sets `dates_assumed: true`.

**AgentId**: `"parser"`, `"matcher"`, `"risk"`, `"fairness"`, `"explanation"`, `"chair"`.
Analysis agents (round 0 opinions, round 2 votes): `matcher`, `risk`, `fairness`.

**RankedProperty**: `{ property_id, title, score (0–1), reasons: string[] }`.

**AiResult**

| Field | Type | Notes |
|---|---|---|
| task_id, trace_id | string | |
| recommended | `RankedProperty + { nightly_price, city }` \| null | `null` = nothing matched (then `suggestions` is filled) |
| ranked | same type, array | top 5 candidates; the guest may pick one of these when editing |
| confidence | number 0–1 | |
| rationale | string | the plain-language explanation (generated text) |
| evidence | `{ fact, source }[]` | **measured** facts (price, rating, availability check, host stats), kept apart from the generated text (spec 13.6) |
| risks | `{ severity: "low"\|"medium"\|"high", text, source_agent }[]` | |
| consensus | boolean | `true` if a majority of the three analysis agents voted for the winner and none is missing |
| decision_rule | string \| null | the written rule the chair used when there was no consensus |
| dissent | `{ agent, preferred_property_id, reason }[]` | agents that voted for something else |
| dissent_note | string \| null | plain-language summary of who disagreed and why, plus missing agents |
| missing_agents | `{ agent, round, reason }[]` | agents that timed out or whose output was dropped |
| comparison | `{ rejected_property_id, rejected_title, why_lower }` \| null | recommended vs. the strongest rejected alternative (spec 13.6) |
| suggestions | string[] | only when nothing matched (travel coach style hints) |
| check_in, check_out, guest_count | from the requirements | carried to the booking page |
| human_decision | HumanDecision \| null | |
| created_datetime | datetime | when the result was published |

**HumanDecision**: `{ decision: "approved"|"edited"|"rejected", guest_id, reason, edited_property_id, edited_rationale, decided_datetime }`.
These are the spec's approval categories (7.3.2).

### 6.3 The stream

`WebSocket /ai/tasks/{task_id}/stream?after_seq=N` (`ws://` or `wss://` on the AI service's host):

1. On connect, the server **replays every event with `seq > N`**, in order, then sends new events live.
   The UI loads `GET /ai/tasks/{id}` first and connects with its last `seq`, so nothing is missed or doubled.
2. Each message is one JSON **StreamEvent** (below). Same shape as the saved history.
3. When the task is finished (`completed`, `failed`, `timed_out`), the server closes with code
   **1000**. Unknown task: close with **4404**. The UI does not reconnect after 1000 or 4000+. On any
   other drop it reconnects with backoff (1, 2, 4, 8 s) using its latest `after_seq`.
4. The stream stays open during `waiting_for_approval`, so `decision.recorded` arrives live.

**StreamEvent**: the shared Kafka envelope plus `seq`, so Kafka records can be forwarded as-is:

```json
{
  "event_type": "vote.cast",
  "trace_id": "6f1c2a9e-…",
  "timestamp": "2026-11-23T18:05:09.412Z",
  "actor_id": "fairness",
  "entity": { "entity_type": "ai_task", "entity_id": "task_001" },
  "idempotency_key": "task_001:27",
  "seq": 27,
  "payload": { "round": 2, "vote": "switch", "property_id": "p_001", "reason": "…" }
}
```

- `timestamp`: UTC **with milliseconds**; the UI uses it to measure WebSocket delivery latency.
- `actor_id`: an AgentId, `"harness"` (status, plan steps, timeouts, rejected outputs) or the `guest_id` (decision).
- `seq`: 1, 2, 3 … per task, no gaps; `idempotency_key` = `"<task_id>:<seq>"`.

| event_type | Who sends it | payload |
|---|---|---|
| `task.status` | harness | `{ status, note }` |
| `plan.created` | chair | `{ plan }` |
| `plan.step_updated` | harness | `{ step_id, status, note }` |
| `requirements.parsed` | parser | `{ requirements, candidate_ids[] }` |
| `round.started` | chair | `{ round: 0\|1\|2, deadline_ms, waiting_for: AgentId[] }` |
| `opinion.published` | matcher / risk / fairness | `{ round: 0, ranked: RankedProperty[], confidence, reasoning }` (round 0 = `debate.round.0`) |
| `agent.output_rejected` | harness | `{ agent, round, reason, invalid_fields[], action: "retry"\|"dropped" }` |
| `reflection.recorded` | the agent | `{ round, cycle (1 or 2), checks: { constraint, evidence, risk, conflict, action } (each `{ result: "pass"\|"concern", note }`), decision: "keep"\|"revise"\|"reject" }` (spec 7.5.3) |
| `disagreement.detected` | chair | `{ round: 0, score (0–1), method, top_picks: { agent, property_id }[], summary }` |
| `challenge.issued` | chair | `{ round: 1, challenge_id, to_agent, about_property_id, question }` (`debate.round.1`) |
| `challenge.answered` | the challenged agent | `{ round: 2, challenge_id, answer, evidence[] }` (`debate.round.2`) |
| `vote.cast` | matcher / risk / fairness | `{ round: 2, vote: "keep"\|"switch"\|"abstain", property_id, reason }` (every vote has a reason) |
| `agent.timed_out` | harness | `{ agent, round, deadline_ms, reason, fallback }` |
| `result.published` | chair | `{ result: AiResult }` (`ai.results`) |
| `decision.recorded` | guest | `{ decision: HumanDecision }` |

### 6.4 Debate rules (team decisions)

1. **Disagreement** = `1 − (agents agreeing with the most common #1 pick ÷ agents that published)`,
   from 0 (all agree) to ~0.67 (three different picks). The chair challenges when it is above 0.
2. **The Fairness Auditor is always challenged at least once** (spec 7.2), even when everyone agrees.
3. **Deadlines:** each round has `deadline_ms` (8 s in the mock for rounds 0 and 2). An agent
   that misses it gets an `agent.timed_out` event, the debate **continues with the agents that
   answered** (spec 13.10), and the agent is listed in `result.missing_agents` and the `dissent_note`.
   The mock counts a timed-out agent's round-0 pick as half a vote.
4. **Votes and decision rule:** each analysis agent casts one vote with a reason. A strict majority
   means consensus. Otherwise the chair applies its written `decision_rule`: on a tie, the
   listing with fewer risk flags wins, then the lower price. Disagreement is never hidden:
   `dissent` and `dissent_note` list every agent that disagreed.
5. **Harness checks:** an agent output with an unknown `property_id`, a score outside 0–1, a
   missing field or a wrong `trace_id` is rejected with `agent.output_rejected` (one retry, then
   `dropped` and the agent counts as missing).

### 6.5 Demo failure modes (spec 7.5.5)

Optional `demo` flags on `POST /ai/requests`, both **off by default**:

| Flag | What the service must do |
|---|---|
| `delay_risk_agent: true` | Make the Risk agent miss its round-2 deadline → `agent.timed_out` for `risk`, the debate continues, and the result lists `risk` in `missing_agents`. |
| `invalid_agent_output: true` | Make one agent (the mock uses the Matcher, round 0) return an invalid output → `agent.output_rejected` with `action: "retry"`, then the agent's valid output. |

### 6.6 Trace isolation (spec 13.11, mandatory)

Three or more debates can run at the same time. To keep them apart:

1. **Kafka key = `trace_id`** on every AI topic (`ai.requests`, `debate.round.0/1/2`, `ai.results`),
   so one debate's messages stay in order on one partition.
2. Every event carries both `trace_id` and `entity.entity_id` (= `task_id`). A chair or agent
   **only consumes messages whose `trace_id` belongs to its task**.
3. The WebSocket for a task **must only send events whose `trace_id` and `entity_id` match that task.**
4. The UI double-checks: any event with another `trace_id` or `task_id` is **dropped**, logged as
   `[ai-stream] DROPPED event from another trace` in the browser console, and counted on the page.
   A debate page must never show another debate's messages.

---

## 7. Mock reference data

The frontend mocks start from fixed seed data (`frontend/src/mocks/data/`) that you can use to
compare responses:
- 8 hosts (`h_001`–`h_008`), 12 guests (`g_001`–`g_012`)
- 30 properties (`p_001`–`p_030`) in San Jose, Sunnyvale and Mountain View; `p_012` is inactive
- 24 reservations in every status, and 5 host-blocked date ranges
- 6 reviews (`v_001`–`v_006`) on completed stays; `v_003` and `v_006` have no host reply yet, and Alex's completed stay `r_012` has no review

Seed dates are relative to today, so they're always in the right past or future.
The spec's demo search ("San Jose, 2 guests, ≤ $250, parking + kitchen, rating ≥ 4.5")
returns `p_001`, `p_002`, `p_003`, `p_005`, `p_008`, `p_011`.
