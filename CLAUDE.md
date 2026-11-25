# CLAUDE.md — DATA-260 Group 7: Rental & Booking Platform

Standing instructions for Claude Code in this repo. Read this first every session.

## Project in one paragraph
SJSU DATA-260 (Agentic AI & Distributed Systems) final group project. We are building an
original Airbnb-style rental marketplace called **Xenia** (NO Airbnb branding, name, or logo anywhere):
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

## Visual theme: "Xenia" (a modern accommodation marketplace inside a Roman villa)
Platform name is **Xenia** (Greek for hospitality to guests). Logo: a small gold arch mark,
then "XENIA" in Cinzel capitals; tagline "Where every stay feels like belonging." (both from
`frontend/src/brand.ts`). The interface stays dark and modern; the villa comes from the
colors (taken from the hero photo), the Cinzel headings, travertine stone, arches and thin
bronze rules. Layout, spacing and interactions stay modern and clean.
Put these as Tailwind theme tokens in the `@theme` block in `frontend/src/index.css` — never hard-code hex values in pages.

Colors:
- `bg` #161311 (near-black, slightly warm) · `surface` #221E1B (cards, panels) · `surface-2` #2A2521 (inputs, toggles) · `line` #3D3630 · `line-strong` #5A5046 (borders)
- `bronze` #8A6A45 — thin decorative lines: the cornice rule under page headings, arch photo frames
- `travertine` #E8DDC8 — the pale stone "strip" surface (filter bar, chair challenge cards, light callouts), with faint horizontal banding drawn in CSS (`.travertine-strip`); text on it is #2A2521, secondary #6B5D4D, chip border #D2C3A6
- `fg` #F3ECE0 · `fg-soft` #E2D9CB · `fg-muted` #C9BDAB (text colors; never darker than this on dark backgrounds — must stay readable on a projector)
- `primary` #E8673A (terracotta) — main actions (Search, Approve, Book); text on it is #161311, not white
- `gold` #D9B565 (antique gold) — active filter chips (border #A98A4C), "Guest favorite" badges, ratings ★, the logo mark, verdict outline (verdict fill #2A2418)
- `olive` #6F8F3A — secondary color for charts, info states and success surfaces
- Price pill: bg #2F2A25, border #4A423A
- Status: available/approved #8FD19E · pending/partial #D9B565 · declined/cancelled/error #F19A8A (outline buttons use border #7A3A36)
- Agent colors (use everywhere — debate view, timelines, charts, votes): Matcher #7CC8E8 ·
  Risk #F08A55 · Fairness Auditor #C9A8F0 · Chair #F3ECE0 · Parser #8FD19E · Explanation #D9B565
- Chart palette (in this order; charts use at most the first 4): #E8673A, #7CC8E8, #6F8F3A, #D9B565, #C9A8F0, #8FD19E.
  Olive is 3rd because next to terracotta it fails the red-green color-blind check. Re-run the
  dataviz palette validator after any color change.

Type (Google Fonts):
- **Cinzel** (600–700) — the XENIA logo, page titles and big headings (e.g. "The Forum")
- **Barlow Condensed** (600–700) — listing titles, section headings (often UPPERCASE, e.g.
  "28 STAYS NEAR SAN JOSE"), prices, KPI numbers, small labels with 0.06–0.08em letter-spacing
- **Barlow** (400–600) — all body and UI text
- **DM Mono** — IDs (trace_id, booking IDs), timestamps, and numeric table columns

Components and details:
- Header: dark, logo left, nav, pill search bar with terracotta Search button (hidden on log in / sign up and on the home page, whose hero has its own)
- Home page (logged-out visitors only, at `/`): full-width hero photo (`public/photos/hero.jpg`, no extra arch frame) fading into the dark background, with XENIA, the tagline and the search bar on the dark fade; then 3 featured stays and the 3-step "How the AI concierge works" strip. Logged-in users land on `/search`.
- Travertine filter strip directly under the header on `/search`, full width, holding the spec's filters as pills
  (active = gold, inactive = white with #D2C3A6 border) — on host "My listings" the same strip holds listing filters
- Cards: `surface` with 1px `line` border, 16px radius; property photo inset at the top with an arched top
  (`.arch-photo`: shallow elliptical arch, thin bronze frame; also used on the property page), 190px tall, cover;
  house-icon tile when there is no photo or it fails to load; gold "★ Guest favorite" badge top-left, round save/heart button top-right (filled terracotta when saved)
- Listing photos: `public/photos/p_001.jpg` … (about 1200px wide, under 250 KB). Originals stay in `public/photos/originals/` (git-ignored).
- Big page headings get a thin double bronze rule underneath, like a classical cornice (`.cornice`)
- Listing title in Barlow Condensed bold ~21px; meta line in fg-muted; price in the price pill
- Buttons, inputs, chips, toggles: fully rounded (pill); primary = filled terracotta, secondary = outline
- Debate page is titled "The Forum" with the subtitle "the agents’ debate"; round labels in condensed uppercase; chair challenges on travertine cards; final
  verdict in a gold-outlined card with Approve / Edit / Reject
- Dashboards: same tokens; charts on `surface` cards; KPI numbers in Barlow Condensed

Keep it modern: no stone texture images on dark surfaces, no gradient washes (the only gradient is the hero photo's fade into the background), no emoji as icons (use inline
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

**Login and roles:** real JWT login (sign up / log in, token kept per browser tab in
sessionStorage). Each account has one role: guest, host or admin; the role decides the nav
and which pages and endpoints it may use (see "Authentication and roles" in
`docs/api/data-contract.md`). The demo accounts all use the password `demo1234` (README).

## How to work with me
- **Work in chunks.** I name a chunk of work (e.g. "property details and booking"). For each chunk:
  1. **Plan + all decisions in one message.** Show a short numbered plan and ask ALL the
     decisions the chunk needs in that same message, then wait for my answers.
  2. **Build the whole chunk without stopping.** Only stop if truly blocked (e.g. a new
     decision that would change what I already approved, or a backend contract change).
  3. **Test it fully yourself:** `npm run build`, `npm run lint`, the app in a real browser,
     and the error cases (400 / 403 / 404 / 409, network failure). Fix what you broke.
  4. **Report once:** a summary of what changed, the choices you made without asking, a
     numbered click-through checklist for me to try in the browser, and one commit message.
- **Decisions go to me** — library or package choice, folder/file structure, data shape or
  field names, UI layout or behavior, anything the spec leaves open, and any time there are
  two reasonable ways to do something. Ask them up front (step 1 above), in plain text:
  2–3 choices, one line each on the tradeoff, your recommendation marked. Small calls made
  while building get listed under "choices made without asking" so I can review them.
- **Never commit, push, merge, rebase, reset, or delete branches.** I do all git writes
  myself. You may run read-only git commands (`git status`, `git diff`, `git log`) and you
  may suggest a commit message when a chunk is done, but I run the commit.
- **Never install a package without asking first** (say what it is and why).
- **I must be able to explain every line live during the demo** (the instructor can ask for a
  live change like "add a pet-friendly filter"). So: keep code simple and readable, no clever
  abstractions, short comments on anything non-obvious, and when you make a design choice,
  explain it to me in plain language with acronyms written out.
- Don't add features beyond the spec unless I ask.
- Run `npm run build` and `npm run lint` before saying a chunk is done; fix errors you introduce.
- Git: I work directly on `main` and commit to it myself (you still never commit). Remind me
  to `git pull` before we start each chunk. `.env` files must never be committed.
