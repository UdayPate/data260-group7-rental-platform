# Cedar & Rye: Data Contract (User, Property, Booking services)

This is the JSON contract between the React frontend and the backend services. The
frontend types in `frontend/src/types/` and the mock server in `frontend/src/mocks/`
follow it exactly, so a service that follows it can replace the mocks with no
frontend changes.

The frontend lead (Uday) owns the data shapes in this document, so treat them as final.
To change something, ask him first so the types and mocks change at the same time.

Covered so far: **User**, **Property**, and **Booking** services (all endpoints), plus the
entity shapes for messages, threads, and reviews. The request and response bodies for
Messaging, Review, Analytics, and AI will be added when those pages are built.

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
| `POST /guests/delete` | `{ "guest_id" }` | `{ "guest_id", "deleted": true }` (also removes the guest's saved properties) |
| `POST /guests/search` | `{ "query"?, "location"?, "page", "page_size" }`; `query` = contains-match on name or email, `location` = contains-match on location (both case-insensitive) | paged Guest |
| `POST /hosts/create` | `{ "name", "email", "phone"?, "profile_photo_url"? }` | `201` Host |
| `POST /hosts/get` | `{ "host_id" }` | Host |
| `POST /hosts/update` | `{ "host_id", ...changed fields among name, email, phone, profile_photo_url }` | updated Host |

### Property Service

| Endpoint | Request body | Response |
|---|---|---|
| `POST /properties/create` | Property **without** `property_id`, `rating`, `review_count`, `created_datetime`. Required: `host_id`, `title`, `property_type`, `address`, `city`, `state`, `zip_code`, `capacity`, `bedrooms`, `bathrooms`, `nightly_price`, `cleaning_fee` | `201` Property |
| `POST /properties/get` | `{ "property_id", "guest_id"? }` | Property plus `"is_saved"` (same meaning as in search: `true` if `guest_id` saved it, `false` otherwise or when no `guest_id` is sent). Inactive listings are returned too. |
| `POST /properties/update` | `{ "property_id", ...only the fields being changed }` | updated Property |
| `POST /properties/delete` | `{ "property_id" }` | `{ "property_id", "deleted": true }`. Returns `409 INVALID_STATUS` if the listing still has upcoming pending or approved reservations. |
| `POST /properties/search` | see below | paged PropertySearchResult |
| `POST /properties/save` | see below | see below |
| `POST /properties/availability` | `{ "property_id", "start_date", "end_date" }` | `{ "items": AvailabilityBlock[] }` = every block overlapping the range. **Read-only for now**; writing blocks will be added with the host availability page. |

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

## 6. Mock reference data

The frontend mocks start from fixed seed data (`frontend/src/mocks/data/`) that you can use to
compare responses:
- 8 hosts (`h_001`–`h_008`), 12 guests (`g_001`–`g_012`)
- 30 properties (`p_001`–`p_030`) in San Jose, Sunnyvale and Mountain View; `p_012` is inactive
- 24 reservations in every status, and 5 host-blocked date ranges

Seed dates are relative to today, so they're always in the right past or future.
The spec's demo search ("San Jose, 2 guests, ≤ $250, parking + kitchen, rating ≥ 4.5")
returns `p_001`, `p_002`, `p_003`, `p_005`, `p_008`, `p_011`.
