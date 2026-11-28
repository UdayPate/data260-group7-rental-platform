# data260-group7-rental-platform

**Xenia**: Where every stay feels like belonging. A rental and booking platform with a multi-agent
AI concierge (SJSU DATA-260, Group 7). How to run the frontend: see [`frontend/README.md`](frontend/README.md).

## Run the whole app with Docker (the easy way)

The only thing you need is **Docker Desktop** (running). No Python, Node or WSL setup. From the repo root:

| What | Command |
|---|---|
| **Start** (first time builds the images, creates the tables, loads the seed data) | `docker compose up -d --build` |
| Open the app | <http://localhost:5173> (log in with a demo account below) |
| See what's running | `docker compose ps` (everything "healthy" or "running"; `jwt-secret` and `kafka-init` exit after their one job) |
| **Stop** (the data is kept) | `docker compose down` |
| **Reset the demo data** (back to the seed) | `docker compose down -v`, then `docker compose up -d` |
| **Spec 13.2 demo** (Kafka consumer stops and recovers) | `docker compose stop booking-worker`, make a booking (it stays "Processing…"), then `docker compose start booking-worker` (it becomes pending, once) |
| Logs of one service | `docker compose logs -f booking-worker` |

What runs: the frontend (5173), User (8001), Property (8002), Booking (8003) + its Kafka worker, Messaging (8004),
Review (8005), the AI service (8007) + its six agents, and Kafka, MySQL, MongoDB and Redis. Only the frontend and the
service ports are published, so nothing clashes with a MySQL or Redis already on your machine. Analytics has no service yet,
so the dashboards use the frontend's mock data. The AI runs without a model key (rule-based parser and template explanations, no cost).

- **Secret:** on the first start a random JWT secret is made in `.secrets/jwt_secret` (git-ignored) and reused after
  that. Nobody edits any file. Delete that file to make a new one (everyone has to log in again).
- **Evidence scripts and database clients** need the databases on your laptop too:
  `docker compose -f docker-compose.yml -f docker-compose.ports.yml up -d` (MySQL on 3307; see `tests/evidence/README.md`).
- **One stack at a time:** `infra/docker-compose.yml` (only the databases, for running the services in a virtualenv,
  see `services/README.md`) uses the same container names. `docker compose down` one before starting the other.
- The frontend on its own with mock data still works as before: `cd frontend && npm run dev` (see `frontend/README.md`).

## Demo accounts

With the frontend's mock data (or a backend seeded with the same data), every account below
logs in with the password **`demo1234`**. The login page also lists them (only when mocks are on).
Each browser tab keeps its own login, so two tabs can be two different users.

| Role | Name | Email | id |
|---|---|---|---|
| admin | Platform Admin | `admin@example.com` | `adm_001` |
| guest | Alex Chen | `alex.chen@example.com` | `g_001` |
| guest | Sam Rivera | `sam.rivera@example.com` | `g_002` |
| guest | Emily Novak | `emily.novak@example.com` | `g_003` |
| guest | Marcus Johnson | `marcus.johnson@example.com` | `g_004` |
| guest | Hannah Schmidt | `hannah.schmidt@example.com` | `g_005` |
| guest | Kenji Watanabe | `kenji.watanabe@example.com` | `g_006` |
| guest | Olivia Brooks | `olivia.brooks@example.com` | `g_007` |
| guest | Diego Morales | `diego.morales@example.com` | `g_008` |
| guest | Fatima Yusuf | `fatima.yusuf@example.com` | `g_009` |
| guest | Liam O'Connor | `liam.oconnor@example.com` | `g_010` |
| guest | Zoe Martin | `zoe.martin@example.com` | `g_011` |
| guest | Ravi Iyer | `ravi.iyer@example.com` | `g_012` |
| host | Maya Ortiz | `maya.ortiz@example.com` | `h_001` |
| host | Daniel Kim | `daniel.kim@example.com` | `h_002` |
| host | Rob Feeney | `rob.feeney@example.com` | `h_003` |
| host | Priya Raman | `priya.raman@example.com` | `h_004` |
| host | Luis Herrera | `luis.herrera@example.com` | `h_005` |
| host | Grace Liu | `grace.liu@example.com` | `h_006` |
| host | Tom Becker | `tom.becker@example.com` | `h_007` |
| host | Aisha Bello | `aisha.bello@example.com` | `h_008` |

Guests see search, Trips, Messages, the AI Assistant, their Guest dashboard and Profile. Hosts see
their listings, reservations, messages, reviews and Host dashboard. The admin sees only the
Platform and AI dashboards. See "Authentication and roles" in `docs/api/data-contract.md`.
