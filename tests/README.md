# Tests

```bash
# once: a virtualenv with the services installed (see services/README.md), then
cd infra && docker compose up -d mysql redis && cd ..      # a MySQL for the tests (any MySQL/MariaDB works, see below)
pytest                                                     # whole repo: shared + user + property + booking
pytest services/booking-service -k twenty                   # the 20-simultaneous-requests tests
```

- The tests use their **own database `xenia_test`**, recreated from `infra/mysql/01_schema.sql` + `03_seed.sql`, so the demo data in `xenia` is never touched.
  They connect as `root` / `rootpass` (the Docker setting). For another MySQL set `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_TEST_ADMIN_USER`, `MYSQL_TEST_ADMIN_PASSWORD`.
  With no MySQL reachable the database tests are **skipped** (not failed).
- Kafka is replaced by an in-memory stand-in (`KAFKA_TRANSPORT=memory`, set in `conftest.py`) that keeps topics, partitions, consumer groups
  and committed offsets, so crash/redelivery behaviour can be tested without Docker. The real Kafka client is exercised by `tests/evidence/consumer-recovery`.
- The Redis cache tests need the Redis from `docker compose up -d redis` (they use its database 15 and empty it). Every other test runs with the
  cache off (`SEARCH_CACHE=off` is the test default).
- The scripts that prove the spec's mandatory behaviours against the running stack are in `tests/evidence/` (see its README).
