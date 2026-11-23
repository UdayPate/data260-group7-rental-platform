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
- Tailwind CSS for styling, using the theme tokens below; no UI kit unless I approve one
- Recharts for dashboard charts
- **MSW (Mock Service Worker) for mocks**: every API call goes through a real `fetch`
  wrapper in `src/api/`; MSW intercepts it during development. Switching to the real backend
  must only require turning MSW off and setting `VITE_API_BASE_URL` per service — never
  rewrite page code to switch.
- Native WebSocket for live updates (AI debate stream, "dates no longer available").
  Put socket code in `src/realtime/`, with a mock emitter for development.

## Visual theme: "Cedar & Rye" (mid-century retro, dark, but modern)
Platform name is **Cedar & Rye** (logo: "Cedar & Rye" with the "&" in terracotta). Reference
mockup: the "Cedar & Rye" board on our design canvas. Retro comes from the type pairing, the
cream filter strip and warm accents; layout, spacing and interactions stay modern and clean.
Put these as Tailwind theme tokens in `tailwind.config` — never hard-code hex values in pages.

Colors:
- `bg` #161311 (near-black, slightly warm) · `surface` #221E1B (cards, panels) · `surface-2` #2A2521 (inputs, toggles) · `border` #3D3630 · `border-strong` #5A5046
- `cream` #F1EADC — the light "strip" surface (filter bar, chair challenge cards, light callouts); text on cream is #2A2521, secondary #6B5D4D, chip border #D8CDB9
- `text` #F3ECE0 · `text-soft` #E2D9CB · `text-muted` #C9BDAB (never darker than this on dark backgrounds — must stay readable on a projector)
- `primary` #E8673A (terracotta/orange) — main actions (Search, Approve, Book); text on it is #161311, not white
- `mustard` #E3B04B — active filter chips (border #C9952F), "Guest favorite" badges, ratings ★, selected toggle, verdict outline (verdict fill #2A2418)
- `teal` #3F8F8A — secondary accent for charts and info states
- Price pill: bg #2F2A25, border #4A423A
- Status: available/approved #8FD19E · pending/partial #E3B04B · declined/cancelled/error #F19A8A (outline buttons use border #7A3A36)
- Agent colors (use everywhere — debate view, timelines, charts, votes): Matcher #7CC8E8 ·
  Risk #F08A55 · Fairness Auditor #C9A8F0 · Chair #F3ECE0 · Parser #8FD19E · Explanation #E3B04B
- Chart palette (in this order): #E8673A, #3F8F8A, #E3B04B, #7CC8E8, #C9A8F0, #8FD19E

Type (Google Fonts):
- **Fraunces** (700–800) — logo and a few big headings only (page titles like "The Debate")
- **Barlow Condensed** (600–700) — listing titles, section headings (often UPPERCASE, e.g.
  "28 STAYS NEAR SAN JOSE"), prices, KPI numbers, small labels with 0.06–0.08em letter-spacing
- **Barlow** (400–600) — all body and UI text
- **DM Mono** — IDs (trace_id, booking IDs), timestamps, and numeric table columns

Components and details:
- Header: dark, logo left, nav, pill search bar with orange Search button, mustard Guest/Host toggle
- Cream filter strip directly under the header, full width, holding the spec's filters as pills
  (active = mustard, inactive = white with #D8CDB9 border) — on host pages the same strip holds listing filters
- Cards: `surface` with 1px `border`, 16px radius; property photo on top (190px tall, cover),
  mustard "★ Guest favorite" badge top-left, round save/heart button top-right (filled terracotta when saved)
- Listing title in Barlow Condensed bold ~21px; meta line in text-muted; price in the price pill
- Buttons, inputs, chips, toggles: fully rounded (pill); primary = filled terracotta, secondary = outline
- Debate panel: round labels in condensed uppercase; chair challenges on cream cards; final
  verdict in a mustard-outlined card with Approve / Edit / Reject
- Dashboards: same tokens; charts on `surface` cards; KPI numbers in Barlow Condensed

Keep it modern: no skeuomorphic textures, no gradient washes, no emoji as icons (use inline
SVG or one icon set I approve). Text contrast ≥ 4.5:1.

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
- **Work one step at a time.** Before starting, show me a short numbered plan. Then do only
  step 1, stop, tell me what you changed and how to run/check it, and wait for me to say
  "next" (or give feedback) before doing the next step. Never chain several steps together.
- **Ask me before every real decision** — library or package choice, folder/file structure,
  data shape or field names, UI layout or behavior, anything the spec leaves open, and any
  time there are two reasonable ways to do something. Give me the options in plain text
  (2–3 choices, one line each on the tradeoff, your recommendation marked) and wait for my
  answer. Don't pick for me and keep going.
- **Never commit, push, merge, rebase, reset, or delete branches.** I do all git writes
  myself. You may run read-only git commands (`git status`, `git diff`, `git log`) and you
  may suggest a commit message when a step is done, but I run the commit.
- **Never install a package without asking first** (say what it is and why).
- **I must be able to explain every line live during the demo** (the instructor can ask for a
  live change like "add a pet-friendly filter"). So: keep code simple and readable, no clever
  abstractions, short comments on anything non-obvious, and when you make a design choice,
  explain it to me in plain language with acronyms written out.
- Don't add features beyond the spec unless I ask.
- Run `npm run build` and `npm run lint` before saying a step is done; fix errors you introduce.
- Git: I work on feature branches (e.g. `frontend/search-page`). Remind me if I'm on `main`
  when we start a step. `.env` files must never be committed.
