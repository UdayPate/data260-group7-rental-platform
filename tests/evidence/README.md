# Evidence pack (spec 13.13)

Four scripts that prove the mandatory behaviours against the **real running stack**. Each one prints what it did,
then `[PASS]` / `[FAIL]` lines, and ends with `RESULT: PASS (...)` (exit code 0) or `RESULT: FAIL (...)` (exit code 1).
Copy the output into the report.

## Before you run any of them

```bash
cd infra && docker compose up -d && cd ..            # Kafka, MySQL, Redis, Mongo (wait until `docker compose ps` shows healthy)
infra/seed/reseed.sh                                  # optional: fresh seed data, dates relative to today
# one terminal each (see services/README.md for the first-time setup):
cd services/user-service     && uvicorn user_service.main:app     --port 8001
cd services/property-service && uvicorn property_service.main:app --port 8002
cd services/booking-service  && uvicorn booking_service.main:app  --port 8003
cd services/booking-service  && python -m booking_service.worker          # NOT needed for consumer-recovery (it runs the worker itself)
```

Use the same Python for the scripts (`PYTHON=.venv/bin/python tests/evidence/<name>/run.sh`). They need `pymysql`
(and `redis` for the Redis script), which `pip install -e shared` already gives you. MySQL settings come from the
`MYSQL_*` variables (defaults: the Docker MySQL, user `xenia`).

## The scripts

| Script | Spec | What it does | `PASS` means |
|---|---|---|---|
| `double-booking/run.sh` | 13.1 | Creates 20 guests, they all request the same nights of `p_005` at the same instant. Waits for the worker. Prints the reservations, `availability_nights`, the winner's and a loser's `trace_id`, and the winner's status history. | all 20 got `202 processing`; then exactly **1 `pending`** and **19 `failed`** (`DATE_CONFLICT`); MySQL holds **one** set of nights |
| `availability-conflict/run.sh` | 13.3 | Maya sends two overlapping blocks for `p_001` at the same instant, then removes the winner. | exactly **one `201` and one `409 DATE_CONFLICT`** (naming the winner's block); only the winner's nights exist |
| `redis/run.sh` | 13.9 | search (MISS) -> same search (HIT) -> Maya changes the price -> search (MISS, new price) -> timings -> cost of the invalidation -> `docker compose stop redis` -> search still `200` -> start Redis -> price restored. | the order MISS, HIT, MISS(new price), HIT; search answers `200` with Redis stopped |
| `consumer-recovery/run.sh` | 13.2 | Starts and stops the booking worker itself. Stop worker -> request (`202`, stays `processing`) -> `kafka-consumer-groups --describe --group booking-workers` shows **lag 1** -> start worker -> lag **0**, reservation `pending` -> sends the same event again. Worker output goes to `consumer-recovery/worker.log`. | lag 1 then 0; one reservation for the `trace_id`, one set of held nights, one `processed_events` row; the repeated event changes nothing |

| `three-debates/run.sh` | 13.11 | Alex, Sam and Emily start three different requests at the same instant. Prints per-task event counts by round (from `ai_events`), each recommendation against its own candidate pool, and the Kafka partition each `trace_id` key went to. | all three finish; no event of one task carries another task's `trace_id`/`task_id`; `seq` has no gaps; key = `trace_id`, one partition per debate |
| `agent-timeout/run.sh` | 13.10 | The spec request normally, then with `delay_risk_agent`. Prints the `agent.timed_out` event and its deadline, `missing_agents`, `dissent_note`, and the latency of both runs. | risk times out in round 2 after the deadline (not forever); the debate still finishes; risk is listed as missing; its late answer is not counted |
| `invalid-agent-output/run.sh` | 7.5.5 | The spec request with `invalid_agent_output`. Prints the `agent.output_rejected` event and the plan note. | one rejection (matcher, round 0, retry) naming `ranked[0].property_id` and `ranked[0].score`; a valid Matcher opinion after it; nobody missing |

The three AI scripts also need the AI service (8007) and its agents running (`services/ai-service/README.md`).

Both `redis` and `consumer-recovery` use `docker`. If Docker is not available the Redis script says `SKIPPED` for the
"Redis stopped" part and you do that step by hand.

## Automated tests (no Docker needed for most of them)

`pytest` from the repo root runs the unit and API tests (see `tests/README.md`): the same double-booking (20 threads),
availability conflict (two simultaneous blocks), idempotency, redelivery, retry/dead-letter, cache invalidation, rating update
and daily job checks, against a real MySQL/MariaDB and an in-memory Kafka stand-in.

## Other things in the evidence list

- **Retry behaviour and dead letters:** `shared/tests/test_kafka_consumer.py`; in the running system look at the `dead.letter` topic
  (`docker exec xenia-kafka /opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic dead.letter --from-beginning`).
- **Offsets:** `docker exec xenia-kafka /opt/kafka/bin/kafka-consumer-groups.sh --bootstrap-server localhost:9092 --describe --group booking-workers`.
- **Idempotency records:** `SELECT * FROM processed_events ORDER BY processed_at DESC LIMIT 10;` and `SELECT * FROM idempotency_keys;`.
- **Status history:** `SELECT * FROM reservation_status_history WHERE trace_id = '<trace_id>' ORDER BY history_id;`.
- **Several consumers in one group:** start `python -m booking_service.worker` twice; `kafka-consumer-groups --describe` shows the 3 partitions split between them.
- **Performance switches (spec 9):**
  `SEARCH_CACHE=on|off` (Property Service `.env`), `USE_KAFKA=on|off` (Booking API `.env`; off = the API holds the dates itself in one transaction, same constraint),
  `infra/mysql/tools/drop-search-indexes.sql` / `create-search-indexes.sql`, `MYSQL_DATABASE=xenia_eval` to point a service at another database, and
  `python infra/seed/generate_large.py` for the 10,000+ rows.
