# Backend services (Tanya)

| Service | Port | Run |
|---|---|---|
| User Service | 8001 | `uvicorn user_service.main:app --port 8001` |
| Property Service | 8002 | `uvicorn property_service.main:app --port 8002` |
| Booking API | 8003 | `uvicorn booking_service.main:app --port 8003` |
| Booking worker | (none) | `python -m booking_service.worker` (consumes `booking.requested`, also runs the daily job) |
| Messaging Service (Himja) | 8004 | `uvicorn messaging_service.main:app --port 8004` |
| Review Service (Himja) | 8005 | `uvicorn review_service.main:app --port 8005` |
| AI Agent Service (Himja) | 8007 | `uvicorn ai_service.main:app --port 8007` + `python -m ai_service.workers <agent>` (see `ai-service/README.md`) |

Shared code lives in `../shared` (`xenia_shared`): Kafka envelope + publish/consume, JWT check, error format, database helpers, Redis cache, availability holding.

## First time

```bash
python3 -m venv .venv && source .venv/bin/activate           # Python 3.11 or newer
pip install -e "shared[test]" -e services/user-service -e services/property-service -e services/booking-service
cd infra && cp .env.example .env && docker compose up -d && cd ..      # Kafka (+ topics), MySQL (+ schema + seed), Redis, Mongo
for s in user property booking; do cp services/$s-service/.env.example services/$s-service/.env; done
# put the SAME long random JWT_SECRET into the three .env files (never commit them, never use the frontend's dev secret)
```

Run each service from **its own folder** (so it finds its `.env`). Then in `frontend/.env.local`:

```
VITE_USE_MOCKS=false
VITE_USER_API_BASE_URL=http://localhost:8001
VITE_PROPERTY_API_BASE_URL=http://localhost:8002
VITE_BOOKING_API_BASE_URL=http://localhost:8003
```
(Messaging, Review, Analytics and AI stay on their own settings; leave their lines as they are until those services exist.)

## Switches (in each service's `.env`)

- `SEARCH_CACHE=on|off` (Property): Redis cache on or off.
- `USE_KAFKA=on|off` (Booking API): `on` = API answers `202` and the worker holds the dates; `off` = the API holds the dates itself in one transaction (the baseline).
- `RUN_CONSUMERS=on|off` (Property): the live-availability and rating consumers run inside the Property Service.
- `MYSQL_DATABASE`: any database name (e.g. `xenia_eval`).

## Contract points worth knowing

- `docs/api/data-contract.md` is the source of truth; the mocks in `frontend/src/mocks/handlers` are the reference for messages and edge cases.
- Dates are UTC. End dates are exclusive (a stay 12-04 to 12-06 holds nights 12-04 and 12-05).
- Double booking is prevented by MySQL: `availability_nights` has `PRIMARY KEY (property_id, night_date)`.
