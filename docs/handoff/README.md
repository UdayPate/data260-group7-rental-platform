# Xenia backend handoff

The frontend is **done** and runs today on mock data (MSW in the browser). Every page, error
message, live update and dashboard already works against mocks that follow
[`docs/api/data-contract.md`](../api/data-contract.md). The backend's job is to replace those
mocks one service at a time with real FastAPI services, Kafka, MySQL, MongoDB and Redis, **without
any frontend change**.

## Who owns what

| Person | Owns | Files to open |
|---|---|---|
| **Uday** | Frontend (`frontend/`): every page, the mocks, the data contract. **Done.** Owns the contract: any change to a request or response shape goes through him first. | — |
| **Tanya** | Shared infrastructure (`infra/docker-compose.yml`: Kafka, MySQL, MongoDB, Redis), the shared Python library in `shared/` (Kafka envelope, JWT check, error format), **User**, **Property** and **Booking** services, Redis cache. Mandatory features: double booking, Kafka consumer recovery, Redis invalidation. | [tanya-steps.md](tanya-steps.md), [tanya-guide.md](tanya-guide.md) |
| **Himja** | **AI Agent Service** (FastAPI, agents, harness, debate over Kafka, WebSocket stream, feedback and versions), **Messaging** and **Review** services. Mandatory features: three concurrent debates with trace isolation, agent timeout and partial results. | [himja-steps.md](himja-steps.md), [himja-guide.md](himja-guide.md) |
| **Rohini and Shashank** | **Analytics** service, the 50-request benchmark and evaluation, fairness tests, approval study, JMeter performance report, API document (Deliverable A), extension proposals, contributions page, slide deck. | [rohini-shashank.md](rohini-shashank.md) |

Every service is **FastAPI (Python)**, so `shared/` is written once, in Python, and every service
imports it.

## Build order

```
Week A   Tanya: infra (docker-compose) + shared/ library + MySQL/Mongo scripts + User Service
           │      (everyone else can start reading the contract and the mocks now)
           ▼
Week B+  in parallel:
           Tanya:  Property → Availability → Booking (API + worker) → live availability → Redis
           Himja:  AI service skeleton → agents → chair/harness → versions → Messaging → Review
           Rohini & Shashank: Analytics service, benchmark property pool and labels, JMeter scripts
           ▼
Last     Evidence: automated tests + one reproducible script per mandatory feature (spec 13.13),
         performance runs, evaluation runs, slides
```

1. **Tanya's infra and `shared/` come first** because every service imports `shared/` (token
   check, envelope, error format) and needs Kafka and the databases running.
2. **The User Service comes next** because every other service needs a real login token to test with.
3. Then everything else runs **in parallel**. Each owner switches their own service from mock to real
   in the frontend and tests it alone (below).

## How the services connect

```
                        Browser: React frontend (http://localhost:5173)
                 REST + JWT (Authorization: Bearer)      WebSockets (?token=)
   ┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐
   ▼          ▼          ▼          ▼          ▼          ▼          ▼          ▼
 User     Property    Booking    Messaging   Review   Analytics    AI API    (WS: availability
 Service  Service     API        Service     Service  Service      (FastAPI)  on Property,
 (Tanya)  (Tanya)     (Tanya)    (Himja)     (Himja)  (R & S)      (Himja)    debate on AI)
   │          │  ▲       │          │          │         ▲            │  ▲
   │          │  │       │ produce  │          │         │ consume    │  │ stream from MongoDB
   ▼          ▼  │       ▼          ▼          ▼         │ all        ▼  │
 ┌────────────────────────────────── Kafka ───────────────────────────────────────┐
 │ booking.requested/approved/declined/cancelled/completed  availability.blocked/  │
 │ released  review.created  message.sent  property.viewed  property.saved          │
 │ search.performed  availability.notified  trace.steps                             │
 │ ai.requests  debate.round.0  debate.round.1  debate.round.2  ai.results          │
 │ dead.letter (every invalid envelope, with trace_id and reason)                   │
 └──────────────────────────────────────────────────────────────────────────────────┘
   │                 │                         │                    │
   ▼                 ▼                         ▼                    ▼
 Booking worker   Property Service          Analytics consumer   Agents (parser, matcher,
 (MySQL write,    (pushes availability      (MongoDB events,     risk, fairness, explanation)
  status history)  to open WebSockets,      traces, dashboards)  + Chair/harness
                   updates rating on
                   review.created)

 MySQL (Tanya): accounts, guests, hosts, properties, saved, availability nights, reservations,
                status history, idempotency keys
 MongoDB: reviews, messages (Himja); debate events, tasks, feedback, versions (Himja);
          events, traces, dead letters (Rohini & Shashank)
 Redis (Tanya): search and availability cache
```

## Rules for every service (all owners)

- **Token check on every endpoint** with the shared helper in `shared/`: no or bad or expired token
  → `401 UNAUTHENTICATED`; wrong role or someone else's id → `403 UNAUTHORIZED`. WebSockets close
  with `4401` / `4403`. Table: [contract, Authentication and roles](../api/data-contract.md#authentication-and-roles-for-tanya-himja-rohini-and-shashank).
- **`JWT_SECRET` lives only in each service's `.env`** (never committed). Commit a `.env.example`
  with a placeholder. **Never** use the mock's `DEV_ONLY_JWT_SECRET` from
  `frontend/src/mocks/auth/jwt.ts`: it is public.
- **CORS:** allow `http://localhost:5173` (the browser calls every service directly).
- **Booking is async:** `POST /bookings/request` returns `202` with the reservation `processing`; the
  booking worker makes it `pending` or `failed` ([contract §5 rule 8](../api/data-contract.md#5-booking-rules-team-decisions)).
- **Error format** on every non-2xx: `{ "error": { "code", "message", "details" } }`, with a
  readable `message`, because the UI shows it exactly as sent. [Contract §2](../api/data-contract.md#2-error-format).
- **Every Kafka message uses the shared envelope** (spec 6.2), validated before publishing and after
  consuming. Invalid → the `dead.letter` topic with the original `trace_id` and the reason.
- **Seed the same data as the mocks:** same ids as `frontend/src/mocks/data/`, plus the demo
  accounts (password `demo1234`, bcrypt hash in the contract). Seed dates are **relative to
  today** (`daysFromToday(n)` in the mock files), so the seed script must compute them at load time.
- **Evidence (spec 13.13):** every mandatory feature needs automated tests **and** a reproducible
  command or script, plus raw Kafka records, offsets, DB queries, logs and trace ids from the real
  running system. Screenshots alone get no credit (spec "Verification Rule"). Put scripts in
  `tests/evidence/<feature>/`.

## Where everything is

| What | Where |
|---|---|
| The contract (every endpoint, field, error, rule) | [`docs/api/data-contract.md`](../api/data-contract.md) |
| The spec | `docs/spec/project_spec.pdf` |
| Working reference for every rule (mock services) | `frontend/src/mocks/handlers/*.ts` (one file per service), `frontend/src/mocks/auth/gate.ts` (token check), `frontend/src/mocks/ai/` (debate engine) |
| Seed data (ids, dates, accounts) | `frontend/src/mocks/data/` |
| Request/response types | `frontend/src/types/` |
| How to run the frontend, every `VITE_` setting, and **switching one service at a time** | [`frontend/README.md`](../../frontend/README.md#switch-one-service-at-a-time-from-mocks-to-real) |
| Demo accounts | [root README](../../README.md#demo-accounts) |

**Testing your service against the real UI:** run the frontend (`cd frontend && npm run dev`), put
your service's URL in `frontend/.env.local` (e.g. `VITE_PROPERTY_API_BASE_URL=http://localhost:8002`)
and restart. Only your service leaves the mocks; everything else stays mocked. Switch the **User
Service first**, because real services can't verify mock tokens.

## Suggested ports

| Service | Port | Frontend setting |
|---|---|---|
| User | 8001 | `VITE_USER_API_BASE_URL` |
| Property | 8002 | `VITE_PROPERTY_API_BASE_URL` |
| Booking | 8003 | `VITE_BOOKING_API_BASE_URL` |
| Messaging | 8004 | `VITE_MESSAGING_API_BASE_URL` |
| Review | 8005 | `VITE_REVIEW_API_BASE_URL` |
| Analytics | 8006 | `VITE_ANALYTICS_API_BASE_URL` |
| AI | 8007 | `VITE_AI_API_BASE_URL` |
