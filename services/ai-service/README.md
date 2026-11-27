# Himja's services: AI Agent (8007), Messaging (8004), Review (8005)

Contract: `docs/api/data-contract.md` §6, "Messaging Service", "Review Service". Checklist: `docs/handoff/himja-steps.md`.

## Run (with Tanya's stack from `services/README.md` already up)

```bash
pip install -e shared -e services/ai-service -e services/messaging-service -e services/review-service
for s in ai messaging review; do cp services/$s-service/.env.example services/$s-service/.env; done   # same JWT_SECRET as the others

cd services/ai-service        && uvicorn ai_service.main:app --port 8007       # the API (REST + WebSocket)
cd services/ai-service        && python -m ai_service.workers chair            # one terminal each, or:
cd services/ai-service        && python -m ai_service.workers parser           #   matcher, risk, fairness, explanation
cd services/messaging-service && uvicorn messaging_service.main:app --port 8004
cd services/review-service    && uvicorn review_service.main:app --port 8005
```

`SEED_ON_START=on` loads the mock's 5 threads, 12 messages and 46 reviews into an empty MongoDB
(or run `python -m messaging_service.seed` / `python -m review_service.seed`). The seed file is
`infra/mongo/seed.json`, made from the frontend mocks by `node infra/seed/export-mongo-seed.mjs`.

Frontend: in `frontend/.env.local` set `VITE_AI_API_BASE_URL=http://localhost:8007`,
`VITE_MESSAGING_API_BASE_URL=http://localhost:8004`, `VITE_REVIEW_API_BASE_URL=http://localhost:8005`.

**No Docker?** `KAFKA_TRANSPORT=memory MONGO_URL=mongomock:// AI_RUN_WORKERS_IN_PROCESS=on` runs the
API and all six agents in one process (development only: they still talk only through the Kafka API).

## How the debate works (what to say in the demo)

```
API --ai.requests--> chair --(s1)--> parser --requirements.parsed--> chair
chair --round.started r0 (ai.requests)--> matcher, risk, fairness --opinion.published--> debate.round.0 --> chair only
chair: disagreement, challenge.issued + round.started r2 --> debate.round.1 --> agents
agents --challenge.answered, vote.cast--> debate.round.2 --> chair: tally, re-check availability (fresh SQL)
chair --s7 + measured facts (ai.results)--> explanation --rationale--> chair --result.published--> ai.results + MongoDB
```

- **Separate processes, Kafka only** (spec 7.2). Each agent is its own consumer group; run more copies to scale.
- **Trace isolation (13.11):** key = `trace_id` on every AI topic (one debate = one partition, in order);
  every message carries `trace_id` + `entity_id = task_id`; agents are stateless and answer with the
  ids from the message; the chair keeps state per task in MongoDB and drops (and dead-letters) any
  message whose `trace_id` is not the task's; the WebSocket only sends the task's own events.
- **One writer:** only the chair stores stream events; `seq` comes from an atomic `$inc`, `(task_id, seq)` is unique.
- **Timeouts (13.10):** a sweeper thread checks deadlines every 200 ms (8 s rounds, 10 s parser/explanation,
  90 s whole task). Missing agents get `agent.timed_out`, the debate continues, late messages are ignored.
  Chair state has a 30 s lease, so another chair copy picks up an abandoned debate.
- **Harness checks (7.5.1):** pydantic models in `harness.py`; invalid → `agent.output_rejected`, `dead.letter`, one retry, then dropped.
- **Measured vs generated (13.6):** scores, votes and `evidence` are code over the read-only DB (`scoring.py`);
  a model only writes the `rationale` (and may fill parser fields the rules left empty).
- **Safety:** MySQL user `ai_reader` has SELECT only; approving books nothing.

## Switches (`.env`)

| Setting | Values | For |
|---|---|---|
| `AI_MODE` | `full`, `matcher_only`, `no_auditor` | Rohini and Shashank's benchmark (spec 7.3.1) |
| `MYSQL_DATABASE` | `xenia`, `xenia_eval` | the 200-property evaluation pool (grant `ai_reader` SELECT there) |
| `SEMANTIC_CACHE` | `on`, `off` | JMeter "B" vs "B+S" |
| `ANTHROPIC_API_KEY` | empty = rules + templates only | model routing: `AI_SMALL_MODEL` / `AI_FRONTIER_MODEL` |

Logs for the slides (MongoDB): `model_calls { trace_id, purpose, tier, model, input_tokens, output_tokens,
latency_ms, cost_estimate, cached, ok, error, timestamp }` and `semantic_cache_stats { trace_id, hit,
similarity, latency_ms, timestamp }`. Frontier cost is 10× small (`COST_PER_1K` in `llm.py`).

Reproducibility (13.5): `python -m ai_service.recompute task_001` recomputes the decision from `ai_events`.

## Tests and evidence

`pytest services/ai-service services/messaging-service services/review-service` (needs MySQL like Tanya's
tests; Kafka and Mongo are in-memory). Evidence: `tests/evidence/three-debates`, `agent-timeout`,
`invalid-agent-output` (see `tests/evidence/README.md`).
