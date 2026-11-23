# CLAUDE.md — DATA-260 Group 7: Rental & Booking Platform

Standing instructions for Claude Code in this repo. Read this first every session.

## Project in one paragraph
SJSU DATA-260 (Agentic AI & Distributed Systems) final group project. We are building an
original Airbnb-style rental marketplace (NO Airbnb branding, name, or logo anywhere):
React client → REST microservices → Kafka in the middle → MySQL + MongoDB + Redis, plus a
FastAPI multi-agent AI recommendation service whose agents debate over Kafka topics.
The full spec is `docs/spec/project_spec.pdf` — when a requirement is unclear, check it there.

## Team and ownership
- **Uday (me, repo owner): the entire frontend in `frontend/`** — all guest pages, all host
  pages, the live AI debate view, and the four dashboards. Also `infra/docker-compose.yml`
  and `shared/` (Kafka envelope) if time allows.
- Tanya: User, Property, Booking services + Redis (`services/user-service`, `property-service`, `booking-service`).
- Himja: AI agent service (`services/ai-service`), Messaging, Review.
- Rohini & Shashank: Analytics service, API document, evaluation, performance report, slides.

**Unless I say otherwise, only edit files under `frontend/`.** Do not touch other people's
service folders. If a frontend change needs a backend contract change, stop and tell me so
I can coordinate with the owner.

## Repo layout
```
frontend/            React app (mine)
services/<name>/     one folder per microservice
shared/              Kafka envelope library + shared JSON schemas
infra/               docker-compose, mysql/ and mongo/ creation scripts
docs/                spec, API doc, diagrams, reports
tests/
```

## Frontend stack (decided — don't swap without asking)
- Vite + React + TypeScript
- React Router for routing (guest area, host area, AI, dashboards)
- Tailwind CSS for styling; keep it clean and plain, no UI kit unless I approve one
- Recharts for dashboard charts
- **MSW (Mock Service Worker) for mocks**: every API call goes through a real `fetch`
  wrapper in `src/api/`; MSW intercepts it during development. Switching to the real backend
  must only require turning MSW off and setting `VITE_API_BASE_URL` per service — never
  rewrite page code to switch.
- Native WebSocket for live updates (AI debate stream, "dates no longer available").
  Put socket code in `src/realtime/`, with a mock emitter for development.

## API contract rules
- The spec defines the endpoints; most are `POST` with a JSON body even for reads
  (e.g. `POST /properties/get`). Follow the spec exactly — do not "fix" them to GET.
- One typed client module per service in `src/api/` (`users.ts`, `properties.ts`,
  `bookings.ts`, `messaging.ts`, `reviews.ts`, `analytics.ts`, `ai.ts`).
- All request/response types live in `src/types/` and must match the entity attributes in
  the spec section 4 (guest, host, property, reservation, message, review, availability).
  Use the spec's snake_case field names in types so they match the backend JSON.
- Mock data in `src/mocks/` must be realistic and consistent (property IDs referenced by
  bookings must exist). Mocks must also return realistic errors: 400 validation, 404 not
  found, 409 date conflict / duplicate booking, 403 unauthorized — the UI must show each one.
- Every API error is shown to the user with a readable message, never swallowed.

### Minimum endpoints (from spec §6)
- User: `/guests/create|get|update|delete|search`, `/hosts/create|get|update`
- Property: `/properties/create|get|update|delete|search|save|availability`
- Booking: `/bookings/request|get|byProperty|byGuest|approve|decline|cancel`
- Messaging: `/threads/open|get|byUser`, `/messages/list|send`
- Review: `/reviews/create|get|byProperty|respond`
- Analytics: `POST /events/ingest`, `GET /analytics/properties/top|funnel|geo|host/dashboard|guest/dashboard`
- AI: `POST /ai/requests`, `GET /ai/tasks/{task_id}`, `GET /ai/results/{task_id}`,
  approve/reject endpoints, WebSocket `/ai/tasks/{task_id}/stream`

## Pages the UI must have (spec §5, §7.4, §8, §13.4)
**Guest:** profile create/edit/delete; search with filters (location, dates, price range,
property type, capacity, amenities, rating, availability); property details; save property;
request reservation; reservation status; messages with hosts; booking history / upcoming /
cancellations / review prompts; write review; guest dashboard.

**Host:** listing create/edit/delete; search/filter own listings; manage availability;
reservation requests with approve / decline / cancel; messages with guests; host dashboard.

**AI:** natural-language request box ("2 nights in San Jose for 2, under $250, parking,
kitchen, rating ≥ 4.5"); **live debate view** showing which agents have published, what each
proposes, when the chair issues a challenge, each vote/abstention with reason, timeouts or
missing agents, and the final verdict with risks and dissent note. A spinner alone does not
meet the spec. Then approve / edit / reject buttons (human-in-the-loop). Show trace_id.

**Dashboards:**
- Guest: bookings over 30 days, reservation-status summary, saved-property activity, average match score, recommendation approvals
- Host: views→booking funnel, occupancy, avg nightly price, revenue trend, cancellations, rating trend, response time
- Platform: events by topic, consumer lag, throughput, errors/retries, dead-letter messages, avg workflow latency, rejected envelopes
- AI: agent publication timeline, disagreement size, challenge count, votes, dissent rate, precision@10, recall@10, human approval categories
- All dashboards support filtering by `trace_id`.

**Real-time (spec §13.4, graded):** while a guest views a property, if another guest books
those dates, a WebSocket event must mark the dates unavailable without a page refresh, and
the booking button must be blocked so a stale booking cannot be submitted. Log the
event-received timestamp so we can measure notification latency.

**Mode switch:** a simple guest/host switcher (and a demo user picker) is fine — no real auth
required unless I say so.

## How to work with me
- Build in small, reviewable steps. After each step, tell me what you changed and how to run it.
- **I must be able to explain every line live during the demo** (the instructor can ask for a
  live change like "add a pet-friendly filter"). So: keep code simple and readable, no clever
  abstractions, short comments on anything non-obvious, and when you make a design choice,
  explain it to me in plain language with acronyms written out.
- Don't add features beyond the spec unless I ask.
- Run `npm run build` and `npm run lint` before saying a step is done; fix errors you introduce.
- Git: work on a feature branch (e.g. `frontend/search-page`), small commits with clear
  messages. Never commit to `main` directly, never force-push, never commit `.env` files.
