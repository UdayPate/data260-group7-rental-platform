# Xenia — frontend

*Where every stay feels like belonging.* The React client for the DATA-260 Group 7 rental and
booking platform: guest search and booking, host pages, the live AI debate ("The Forum") and
four dashboards.

Stack: Vite, React, TypeScript, Tailwind CSS v4, React Router, Recharts, and MSW (Mock Service
Worker) for mock data. The API shapes the pages expect are in
[`docs/api/data-contract.md`](../docs/api/data-contract.md).

## Run it

Needs Node.js 20 or newer (we use 22).

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

Other scripts: `npm run build` (type-check + production build into `dist/`), `npm run lint`,
`npm run preview` (serve the built `dist/`).

### Windows / WSL note

We run the dev server inside WSL (Ubuntu) on the Windows drive (`/mnt/c/...`). There, Linux
isn't told when Windows files change, so `vite.config.ts` turns on **polling**
(`watch: { usePolling: true }`): Vite checks the files itself, and saving a file still reloads
the page (a second or so later). Open the printed `http://localhost:5173` in your Windows browser.
If `npm install` is slow or fails on `/mnt/c`, run it again from the WSL terminal (not
PowerShell), so the packages are built for Linux.

## Mock mode vs the real backend

**Mock mode (the default).** With no `.env.local` at all, MSW starts in the browser and answers
every API call and WebSocket from realistic seed data in `src/mocks/` (30 listings, 12 guests,
8 hosts, bookings, reviews, messages, AI debates, dashboards), including the error cases
(400 / 401 / 403 / 404 / 409). A "Mock data" badge shows in the header.

- Data lives in browser memory. All open windows of the site share it (they sync with each
  other), so a reload catches up from the other windows. Closing every window resets it to the
  seed data.
- The mocks sign their login tokens with a development-only secret that lives in frontend code.
  Real services must never use it: each service's real `JWT_SECRET` goes only in that service's
  own `.env` (never committed), with a `.env.example` showing a placeholder.

**Real backend.** Every API call goes through the typed clients in `src/api/`, which add the
service's base URL from `src/config.ts`. Switching never needs a page code change, only settings.

## Settings (`VITE_` variables)

Copy `.env.example` to `.env.local` and edit it (`.env.local` is git-ignored; never commit it).
Restart `npm run dev` after changing it.

| Variable | Default | What it does |
|---|---|---|
| `VITE_USE_MOCKS` | `true` | `false` turns MSW off completely: every call goes to the real services. |
| `VITE_USER_API_BASE_URL` | empty | User Service: `/auth/login`, `/auth/signup`, `/guests/*`, `/hosts/*` |
| `VITE_PROPERTY_API_BASE_URL` | empty | Property Service: `/properties/*`, and the live availability WebSocket |
| `VITE_BOOKING_API_BASE_URL` | empty | Booking Service: `/bookings/*` |
| `VITE_MESSAGING_API_BASE_URL` | empty | Messaging Service: `/threads/*`, `/messages/*` |
| `VITE_REVIEW_API_BASE_URL` | empty | Review Service: `/reviews/*` |
| `VITE_ANALYTICS_API_BASE_URL` | empty | Analytics Service: `/events/ingest`, `/analytics/*` |
| `VITE_AI_API_BASE_URL` | empty | AI Service: `/ai/*`, and the debate WebSocket |

Each base URL looks like `http://localhost:8002` (no trailing slash). **Empty** means "this
same server", which is where the mocks answer. WebSockets use the same base URL with `http`
→ `ws` (`https` → `wss`). The JWT secret is not a frontend setting.

## Switch one service at a time from mocks to real

Keep `VITE_USE_MOCKS=true` and set the base URL of only the service that is ready. That
service's mocks switch off (`src/mocks/handlers/index.ts`), so its calls go to the real server;
every service whose URL is still empty stays mocked.

```bash
# .env.local: real Property Service, everything else mocked
VITE_USE_MOCKS=true
VITE_PROPERTY_API_BASE_URL=http://localhost:8002
```

Things to know while mixing:

1. **Start with the User Service.** It issues the login tokens. A real service can't verify a
   mock token (different secret), so switch the User Service first (or together with the
   first real service). While the User Service is real, the remaining mocks read the real
   token's claims without checking its signature (they can't know the real secret; the real
   services always check it).
2. **Seed data must match.** Mocked and real services don't share a database. IDs that cross
   services (a booking's `property_id`, a review's `reservation_id`) only line up if the real
   database is seeded with the same data as `src/mocks/data/`.
3. **CORS.** The browser calls each real service directly, so each service must allow the
   frontend's origin (`http://localhost:5173`).
4. When everything is real, set `VITE_USE_MOCKS=false`.

## Demo accounts

With the mock data (or a backend seeded with the same data), every account logs in with the
password **`demo1234`**. The login page lists them while mocks are on. Each browser tab keeps
its own login (sessionStorage), so two tabs can be two different users.

| Role | Name | Email | id |
|---|---|---|---|
| admin | Platform Admin | `admin@example.com` | `adm_001` |
| guest | Alex Chen | `alex.chen@example.com` | `g_001` |
| guest | Sam Rivera | `sam.rivera@example.com` | `g_002` |
| guest | Emily Novak | `emily.novak@example.com` | `g_003` |
| host | Maya Ortiz | `maya.ortiz@example.com` | `h_001` |
| host | Daniel Kim | `daniel.kim@example.com` | `h_002` |

The full list (12 guests, 8 hosts) is in the [root README](../README.md#demo-accounts).

Who sees what: logged-out visitors get the home page, search and property pages. Guests get
search, Trips, Messages, the AI Assistant, their Guest dashboard and Profile. Hosts get their
listings, reservations, reviews, messages and Host dashboard. The admin gets the Platform and
AI dashboards.

## Where things are

```
src/api/         one typed client per service (the only place that calls fetch)
src/types/       request/response types (snake_case, matching the contract)
src/pages/       one file per page (guest/, host/, ai/, dashboards/, auth/)
src/components/  shared pieces (header, cards, charts, debate parts)
src/realtime/    WebSocket clients (AI debate stream, live availability)
src/mocks/       MSW handlers, seed data, the mock AI debate engine
src/index.css    theme tokens (colors, fonts) and the villa classes
src/brand.ts     the name and tagline
public/photos/   listing photos (p_001.jpg …) and the home page hero
```
