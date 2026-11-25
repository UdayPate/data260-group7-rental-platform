# Himja: detailed guide

Same step numbers as the checklist ([himja-steps.md](himja-steps.md)). For each step: what and
why, the contract sections, what the mock already does (your working reference), what the
backend must do properly, how to test it against the real frontend, and common mistakes.

Links: contract = [`docs/api/data-contract.md`](../api/data-contract.md) (your sections:
[§6 AI Agent Service](../api/data-contract.md#6-ai-agent-service-owner-himja),
[Messaging](../api/data-contract.md#messaging-service-owner-himja),
[Review](../api/data-contract.md#review-service-owner-himja)). Mock debate engine =
`frontend/src/mocks/ai/` (`engine.ts` plans a whole debate from the seed data, `bus.ts` publishes
it event by event, `versions.ts` holds matcher-v1 / v2 and the sample feedback). Mock endpoints =
`frontend/src/mocks/handlers/ai.ts`, `messaging.ts`, `reviews.ts`. Types = `frontend/src/types/ai.ts`.

**How to test any step against the UI:** `cd frontend && npm run dev`, set your service's URL in
`frontend/.env.local` (e.g. `VITE_AI_API_BASE_URL=http://localhost:8007`, keep
`VITE_USE_MOCKS=true`), restart. Only your service leaves the mocks
([frontend README](../../frontend/README.md#switch-one-service-at-a-time-from-mocks-to-real)).
Use the **real User Service** (Tanya) for tokens: a real service can't verify the mock's tokens.

**The mock is the behaviour to match, not the design to copy.** It runs the whole debate inside
one browser tab on a timer. The real service must be separate agent processes talking **only
through Kafka** (spec 7.2: "Direct agent-to-agent HTTP calls are not permitted").

---

## 1. AI service skeleton

**What and why.** Spec 7.4: "Implement the agent layer as a FastAPI microservice." Spec 3.2:
MongoDB for "AI reasoning and debate messages".

**Build:**
- **API process** (FastAPI): REST + WebSocket. Built with `shared/` (`create_app`, `require(...)`, error format, CORS for `http://localhost:5173`).
- **Agent workers:** one process per agent (`parser`, `matcher`, `risk`, `fairness`, `explanation`) and the **chair/harness**. Each is a Kafka consumer in its own consumer group (`agent-matcher`, `agent-risk`, …, `ai-chair`), so agents are "stateless services" (spec 7) that you can scale.
- **MongoDB collections** (index scripts in `infra/mongo/`):
  - `ai_tasks` (unique `task_id`, index `guest_id`)
  - `ai_events` (unique `task_id + seq`, index `trace_id`)
  - `ai_results` (unique `task_id`)
  - `ai_feedback`, `matcher_versions`, `version_history`
  - `semantic_cache` (step 11).
- **Listing data:** use the read-only MySQL user Tanya creates (`ai_reader`) for properties, hosts, availability and reservations (the Risk agent needs host cancellations). Read-only credentials also enforce spec 7.5.1 "prevents an agent from … changing availability" at the database level.

**Test.** `/health` ok; a guest token reaches a stub; a host token gets `403`; a script prints
`p_001`'s title through the read-only connection.

**Common mistakes:**
- One big process with agents calling each other as Python functions.
- Writing to MySQL from the AI service.

---

## 2. REST endpoints, task store, stream with replay

**What and why.** Spec 7.4 REST + WebSocket. The UI loads the task, then streams; a reload must
rebuild the debate exactly.

**Contract.**
- [6.1 Endpoints](../api/data-contract.md#61-endpoints), [6.2 Shapes](../api/data-contract.md#62-shapes) (AiTask, AiResult)
- [6.3 The stream](../api/data-contract.md#63-the-stream)
- the auth table rows for `/ai/*` in [Authentication and roles](../api/data-contract.md#authentication-and-roles-for-tanya-himja-rohini-and-shashank).

**Rules the mock enforces** (`handlers/ai.ts`):
- **`POST /ai/requests`:** `request_text` 10–500 chars; demo flags optional; `202 { task_id, trace_id, status: "waiting" }`.
- **`GET /ai/tasks/{id}`:** `{ task, events }`, every event so far in `seq` order.
- **`GET /ai/results/{id}`:** `409 INVALID_STATUS` while running.
- **Who:**
  - only the guest who made the request may read the task or stream it (`403` / close `4403`)
  - no token on the socket → close `4401`
  - unknown task → close `4404`.
- **The stream:**
  - replays every event with `seq > after_seq`, then sends live events
  - closes with `1000` when the task is `completed`, `failed` or `timed_out`
  - stays open during `waiting_for_approval`.
- **Every event:**
  - is an envelope + `seq`, with UTC milliseconds
  - `seq` 1, 2, 3 … with no gaps; `idempotency_key = "<task_id>:<seq>"`.

**Do properly:**
- **One writer per task assigns `seq`:** the chair/harness. It validates each incoming Kafka message, assigns the next `seq`, and inserts it into `ai_events` (the unique `task_id + seq` index stops gaps and doubles).
- **The WebSocket handler** reads `ai_events` from MongoDB: replay with `seq > N`, then poll for newer (every ~200 ms, or a MongoDB change stream if you run a replica set).
- **Kafka stays the transport between agents; MongoDB is the record.** This also satisfies spec 7.2 "save the complete debate, not only the final answer."
- The page measures WebSocket delivery latency from each event's `timestamp`.

**Test.** Before any real agent exists, write a tiny script that publishes a recorded debate (copy
the event list from a mock run: `GET /ai/tasks/task_001` in the browser's network tab) into
`ai_events`. Then point the UI at your service: The Forum renders it; reload halfway, and nothing
is missing or doubled.

**Common mistakes:**
- `seq` assigned by each agent: gaps and duplicates.
- Closing the socket at `waiting_for_approval`, so the decision never arrives live.
- Sending `datetime` without milliseconds.

---

## 3. Request Parser and the plan

**What and why.** Spec 7.1 Guest Request Parser; spec 7.5.2 Planning pattern (plan_id linked to
trace_id; each step has input, expected output, responsible agent and status; the harness checks a
step is done before the next starts; a failed step is retried, skipped with a note, or stops safely).

**Contract.** [6.2 Plan, PlanStep, ParsedRequirements](../api/data-contract.md#62-shapes),
`requirements.parsed`, `plan.created` and `plan.step_updated` in [6.3](../api/data-contract.md#63-the-stream).

**Mock reference.** `engine.ts` `parseRequest()` (rule-based: city, numbers, "under $250",
amenities, "rating ≥ 4.5"; picks dates and sets `dates_assumed` when none are given), `makePlan()`
(the 7 steps).

**Do properly:**
- The parser may use a model (step 11 routes it), but its **output must be validated** into `ParsedRequirements` before use; anything unparseable is `null`.
- Publish to `ai.requests` (the request) and `requirements.parsed`.
- The chair creates the plan and updates each step's status as the debate moves; a step never silently moves on.

**Test.** The spec request ("2 nights in San Jose for 2, under $250, parking, kitchen, rating ≥
4.5") → The Forum's "What the parser understood" and "Plan" panels match the mock's.

**Common mistakes:**
- Free-text requirements passed straight to agents.
- A plan created after the agents already started.

---

## 4. Round 0 agents with reflection

**What and why.** Spec 7.1 (Matching agent, Review and Risk agent, Fairness and Bias Auditor), 7.2
Round 0 ("they do not see one another's answers"), 7.5.3 Reflection (constraint, evidence, risk,
conflict and action checks, limited to a fixed number of cycles).

**Contract.**
- `opinion.published` and `reflection.recorded` in [6.3](../api/data-contract.md#63-the-stream)
- [6.7 Matcher weights](../api/data-contract.md#67-matcher-weights-and-reruns-spec-136): the **exact score formula**, the parts, must-haves ranking first, and `MatcherRankEntry`.

**Mock reference** (`engine.ts`):
- `matcherParts`, `weightedScore`, `rankMatcher` (must-haves first, then score, then price)
- `riskFlags` / `riskScore` (host cancellations from reservations, response rate under 80%, unverified host)
- `fairnessScore` (ranks without popularity: no review count, no host popularity).

With matcher-v1 weights (0.6 / 0.35 / 0.1 / 0 / 0.1) the Matcher picks Budget Studio and Risk picks
Willow Glen for the spec request. That disagreement is the demo.

**Do properly:**
- Each agent consumes `ai.requests` (with the parsed requirements and the candidate ids), computes **only from data** (the read-only DB), and publishes to `debate.round.0` with key = `trace_id`.
- The Matcher's numeric score must be the deterministic formula, so reruns are reproducible (spec 13.5 "final resolution must be reproducible").
- A model may write the `reasoning` text, never the numbers.
- **Reflection:** at most 2 cycles (initial check + one revision), recorded as `reflection.recorded` with each check's result and a keep / revise / reject decision. The report must measure whether it helps (spec 7.5.3), so log the before/after.

**Test.** The Forum Round 0 shows three columns with different #1 picks, confidences and
reflection notes, matching the mock on the same seed data.

**Common mistakes:**
- Agents reading each other's round-0 messages. Round-0 consumers must not subscribe to `debate.round.0`; only the chair does.
- An LLM inventing property ids. Validate (step 8).

---

## 5. Kafka routing and trace isolation (spec 13.11, mandatory)

**What and why.** "Run three recommendation debates at the same time. No chair may consume another
debate's messages … Students must explain the Kafka key, partition, topic, or correlation strategy."

**Contract.** [6.6 Trace isolation](../api/data-contract.md#66-trace-isolation-spec-1311-mandatory).

**Do properly:**
1. **Key = `trace_id`** on every AI topic (`ai.requests`, `debate.round.0/1/2`, `ai.results`), so a debate's messages stay in order on one partition. Topics need ≥ 3 partitions (Tanya's script).
2. **Every message carries `trace_id` and `entity.entity_id` = `task_id`.** The chair keeps per-task state keyed by `trace_id` and **drops** (and logs) any message whose `trace_id` it doesn't own or whose `task_id` doesn't match.
3. **Chair ownership:** with several chair instances in one consumer group, each owns the partitions Kafka assigns it. Because the key is `trace_id`, all of one debate lands on one chair. Persist chair state in MongoDB so a rebalance doesn't lose a debate.
4. **The WebSocket** sends only events whose `trace_id` and `task_id` match the socket's task. The UI also drops and counts anything else; it must stay at 0.

**Test.** Open three browser tabs as three different guests (Alex, Sam, Emily), start three
different requests within a second. Each Forum page shows only its own request and property pool,
and the browser console has no `[ai-stream] DROPPED` lines. Evidence in step 14.

**Common mistakes:**
- Key = `task_id` on some topics and `trace_id` on others.
- A global "current task" variable in the chair.
- An agent replying without copying the incoming `trace_id`.

---

## 6. Chair: disagreement, challenges, answers, votes, result

**What and why.** Spec 7.1 Booking Assistant Chair, 7.2 Rounds 1–2 and Final Decision, 13.5
(disagreement measured, challenge rule, votes and dissent persisted, reproducible resolution).

**Contract.** [6.4 Debate rules](../api/data-contract.md#64-debate-rules-team-decisions):
- **Disagreement** = 1 − (agents agreeing with the most common #1 ÷ agents that published).
- **Challenges:**
  - challenge when the disagreement is above 0
  - **the Fairness Auditor is always challenged at least once**
  - `challenge.issued` goes to `debate.round.1`, `challenge.answered` and `vote.cast` to `debate.round.2`.
- **Votes and the decision rule:**
  - every vote has a reason; a strict majority = consensus
  - otherwise the written decision rule: fewer risk flags, then lower price.
- **The result** (`AiResult` fields in [6.2](../api/data-contract.md#62-shapes)):
  - `ai.results` with `consensus`, `decision_rule`, `dissent`, `dissent_note`, `missing_agents`
  - `comparison` (recommended vs the strongest rejected, spec 13.6)
  - `ranked` (top 5), `matcher_ranking` (Matcher top 10, measured numbers only), `confidence`.

**Mock reference.** `engine.ts` `planDebate()` builds exactly this sequence; the questions it asks
(e.g. "Matcher, explain why 'host cancelled 2 stays' should not lower Budget Studio near SJSU") are a
good template. Also re-check availability before publishing (plan step 6): a listing booked during
the debate must not be recommended.

**Do properly:**
- **Votes must cite stored messages** (spec 7.2): the vote's `reason` references the evidence from round 0–2 events, not a fresh model opinion.
- **Persist everything:** every challenge, answer, vote and abstention, so the resolution can be recomputed from `ai_events` alone (write a small `recompute_result(task_id)` test that does it).

**Test.** The Forum: disagreement card, Round 1 challenge cards (one to the Fairness Auditor),
Round 2 answers and votes, final verdict with dissent note. Compare with the mock on the same request.

**Common mistakes:**
- Hiding disagreement ("consensus: true" with a dissenting vote).
- Forgetting the mandatory Fairness challenge when all agree.

---

## 7. Explanation skill and measured vs generated

**What and why.** Spec 7.1 Explanation Skill; 13.6 "Separate measured evidence from generated
explanation."

**Contract.** AiResult `rationale` (generated) vs `evidence` (measured `{ fact, source }`) and
`risks` (`source_agent`) in [6.2](../api/data-contract.md#62-shapes). The UI shows them in separate
boxes, labelled.

**Do properly:**
- `evidence` is built by code from records: price, rating and review count from the property row, the availability re-check, host stats, with `source` such as `property p_001` or `availability re-check (plan step 6)`.
- The explanation agent (a model is fine here) writes only `rationale` and `dissent_note`, **from** those facts. Never copy model sentences into `evidence`.
- Optional Travel Coach: when nothing matches, `recommended: null` and `suggestions` (nearby dates, price ranges).

**Test.** Final verdict shows "Evidence (measured)" lines with sources, and the rationale reads
naturally. A request that matches nothing (e.g. "1 night in Fresno under $20") shows suggestions.

---

## 8. Harness: validation, timeouts, partial results, demo switches (spec 7.5.1, 13.10, mandatory)

**What and why.**
- Spec 7.5.1: the harness controls workflow state, routing, input/output checks, reliability (timeouts, bounded retries, idempotency, dead letters) and safety.
- Spec 13.10: "One AI agent must be delayed or made unavailable … The chair must handle the failure without hanging forever."
- Spec 7.5.5: show one invalid response rejected and one delayed agent.

**Contract.** [6.4 rules 3 and 5](../api/data-contract.md#64-debate-rules-team-decisions),
[6.5 Demo failure modes](../api/data-contract.md#65-demo-failure-modes-spec-755),
`agent.output_rejected`, `agent.timed_out` and `task.status` in [6.3](../api/data-contract.md#63-the-stream).

**Do properly:**
- **Output validation** (pydantic): unknown `property_id`, score outside 0–1, missing field or wrong `trace_id` → `agent.output_rejected`, then **one retry**, then `dropped` and the agent counts as missing. The bad message also goes to `dead.letter` with the reason (the Platform dashboard counts it).
- **Deadlines:**
  - each round has `deadline_ms` (the mock uses 8 s for rounds 0 and 2)
  - the chair waits with a real timer (`asyncio.wait_for` or a deadline check in its loop), never "until all agents answer"
  - on timeout: `agent.timed_out`, then continue with the agents that answered; list the agent in `missing_agents` and the `dissent_note`.
- **Task timeout:** an overall limit (e.g. 90 s) → status `timed_out` with an `error`. Never stuck in `in_debate`.
- **Demo switches** (`demo` on `POST /ai/requests`):
  - `delay_risk_agent` makes Risk sleep past its round-2 deadline
  - `invalid_agent_output` makes the Matcher's first round-0 output invalid.
- **Safety** (spec 7.5.1): no agent can book, change availability or send a message. Read-only DB user, and no agent has tokens for Booking or Messaging.

**Test.** On the AI Assistant page, tick each demo switch:
- the invalid-output run shows the rejection, then a valid output
- the delayed run shows "The risk agent timed out" and still finishes with a limitation note.

Report the latency and quality effect (spec 13.10 asks for it).

**Common mistakes:**
- Waiting for a late message forever.
- Treating the late message, when it finally arrives, as valid for an already closed round.
- Retrying without a bound.

---

## 9. Human approval and feedback

**What and why.** Spec 7 "human-in-the-loop checkpoint", 7.3.2 approval categories, 7.5.4 "store
feedback with the original trace_id, recommendation, human decision, and reason."

**Contract.**
- `POST /ai/tasks/{id}/approve` and `/reject` in [6.1](../api/data-contract.md#61-endpoints)
- `HumanDecision` in [6.2](../api/data-contract.md#62-shapes)
- `FeedbackItem` and `GET /ai/feedback` (admin only) in [6.8](../api/data-contract.md#68-self-improvement-feedback-and-versions-spec-754-755).

**Rules the mock enforces:**
- **Approve with any real edit** → `"edited"`. `edits.property_id` must be in `ranked` (`400`).
- **Reject** requires a reason.
- **Errors:** a different guest → `403`; before the result or a second time → `409`.
- **Approving books nothing.**
- **After the decision:**
  - `decision.recorded` goes out on the open stream
  - the task becomes `completed`
  - one feedback item is created.

**Test.** Approve, Edit (pick another of the top 5) and Reject on three debates; the admin's AI
dashboard "Versions and feedback" lists them with trace ids.

---

## 10. Versions, promote and rollback, weight reruns (spec 7.5.4, 13.6)

**What and why.** Spec 7.5.4: versioned changes (`matcher-v2`), never overwrite, run against a
fixed evaluation set, **no automatic promotion**, keep the old version for rollback, one example of
feedback that led to a change and one rejected. Spec 13.6: "Change one scoring weight and rerun the
request to show how the ranking changes."

**Contract.** [6.7](../api/data-contract.md#67-matcher-weights-and-reruns-spec-136) (rerun rules:
same text, new weights, `parent_task_id` of the same guest),
[6.8](../api/data-contract.md#68-self-improvement-feedback-and-versions-spec-754-755)
(`VersionsResponse`, promote/rollback rules, admin only).

**Mock reference.** `frontend/src/mocks/ai/versions.ts`:
- **Versions:** matcher-v1 (0.6 / 0.35 / 0.1 / 0 / 0.1) and matcher-v2 (review count 0, the Fairness Auditor's proposal).
- **Sample feedback:** fb_s01 "led to matcher-v2"; fb_s02 "rejected: insufficient or unreliable".
- **Promote and rollback:** promote = newer only, rollback = older only, `409` otherwise; `by_id` / `by_name` from the token.

**Do properly:**
- A debate reads the active version **once, at start**, and records `matcher_version` and `weights`.
- Store versions in MongoDB.
- The evaluation numbers come from Rohini and Shashank's benchmark run; until then set `evaluation_sample: true`.
- Rerun = a full new debate (new `task_id` and `trace_id`).
- **Evaluation modes for Rohini and Shashank's benchmark** (spec 7.3.1 table): an env switch
  `AI_MODE=full|matcher_only|no_auditor` (matcher only = single-agent matching; no auditor = the full
  debate without the Fairness Auditor), and the listing database name from the env so they can point
  the service at their 200-property evaluation pool.

**Test.**
- As admin: promote v2 (confirm) → a new debate as Alex shows `matcher-v2`; roll back.
- As Alex after a verdict: "Change weights and rerun" with risk penalty 0.40 → "Compared with the original run" shows the Matcher's #1 moving from Budget Studio to Willow Glen.

---

## 11. Model routing and semantic cache (slide 6)

**What and why.** Slide 6 asks for:
- cache-hit rate, latency improvement, reduction in model calls and cost savings
- the model-routing strategy (small vs frontier, frontier = 10× the cost)
- quality, latency, request distribution and cost.

**Build:**
- **Router:** a rule (e.g. short requests with all fields parsed by rules → small model; long, vague or multi-constraint requests → frontier) for the parser and explanation calls. Log `{ trace_id, model, tokens, latency_ms, cost_estimate }` per call.
- **Semantic cache:** embed the normalised `request_text`; on a similar enough match (e.g. cosine ≥ 0.95, tune it) with the same dates and guests, reuse the **parsed requirements** (never a whole result: availability changes). Log hit or miss.
- An env switch `SEMANTIC_CACHE=on|off` for the JMeter "B" vs "B+S" configurations.

**Hand-off.** Store the logs in MongoDB (`model_calls`, `semantic_cache_stats`) and tell Rohini and
Shashank the field names; they compute the slide numbers.

**Common mistakes:**
- Caching the final recommendation, which then ignores new bookings.
- No off switch, so the baseline can't be measured.

---

## 12. Messaging Service

**What and why.** Spec 5.1/5.2 "send and receive messages", §6 Messaging endpoints, 6.1 `message.sent`.

**Contract.** [Messaging Service](../api/data-contract.md#messaging-service-owner-himja) (rules 1–5),
[Thread](../api/data-contract.md#thread-messaging-service-conversation-in-spec-4),
[Message](../api/data-contract.md#message-messaging-service).

**Rules the mock enforces** (`handlers/messaging.ts`):
- **One thread per guest + host + listing:** `threads/open` returns the existing one (`200`) or creates it (`201`).
- **Participants only** (`403`).
- **A host may only open a thread with a guest who has a reservation at that listing** (`403`).
- **`message_text`** 1–2000 characters after trimming.
- **Idempotency:** the same key returns the first message.
- **Delivery status:**
  - `sent` on store
  - `delivered` when it appears in the receiver's `threads/byUser`
  - `read` when the receiver calls `messages/list`.
- **Ordering:** `byUser` is most recent activity first; `messages/list` is oldest first.
- **ThreadSummary** includes `last_message` and `unread_count`.

**Do properly:**
- Store threads and messages in MongoDB (index `guest_id`, `host_id`, `thread_id + timestamp`).
- The names in a thread are copied at open time: call the User and Property services **forwarding the caller's `Authorization` header**, and check the host-has-reservation rule through `/bookings/byProperty`.
- Publish `message.sent` (envelope, `idempotency_key = message_id`).

**Test.** `VITE_MESSAGING_API_BASE_URL=http://localhost:8004`: Alex messages Maya from a property
page; Maya's badge shows 1; when she opens it, Alex's message turns "read". As Maya, try to message a
guest who never booked: you get the readable `403`.

**Common mistakes:**
- Marking "read" on `threads/byUser`.
- Letting either user see the other's threads.

---

## 13. Review Service

**What and why.** Spec 5.1 "write review", §6 Review endpoints, 3.2 (reviews in MongoDB), 6.1
`review.created`.

**Contract.** [Review Service](../api/data-contract.md#review-service-owner-himja) (rules 1–5),
[Review](../api/data-contract.md#review-review-service) (with `guest_name`).

**Rules the mock enforces** (`handlers/reviews.ts`):
- **A review needs:**
  - a `completed` reservation (`409 INVALID_STATUS`)
  - written by that reservation's guest (`403`)
  - only one per reservation (`409 DUPLICATE_REVIEW`).
- **Fields:** rating is a whole number 1–5; text 20–1000 characters.
- **`byProperty`:** newest first, paged. **`byGuest`** exists for the Trips page.
- **Host reply:** only the listing's host, once, 10–1000 characters.
- **No editing or deleting.**

**Do properly:**
- Read the reservation from the Booking Service (`/bookings/get`, forwarding the guest's token) to check status and ownership.
- Copy `guest_name` in.
- **Publish `review.created`** (`idempotency_key = review_id`). Tanya's Property Service updates `rating` and `review_count` from it, so **don't update the listing yourself**.
- Seed the 46 reviews from `frontend/src/mocks/data/reviews.ts` and `pastStays.ts`.

**Test.** `VITE_REVIEW_API_BASE_URL=http://localhost:8005`: Alex's Trips → "Write a review" for
`r_012`; the property page lists it; a second attempt shows "already has a review"; Maya replies once
from her Reviews page.

---

## 14. Evidence pack (spec 13.13)

**What.** Automated tests and one reproducible script per mandatory feature, with raw records from
the real running system.

**`tests/evidence/three-debates/run.sh`:**
1. Log in three guests, start three different requests at once.
2. Wait for all three results.
3. For each `trace_id`, print:
   - the events per round from `ai_events`
   - the Kafka partition the key went to (`kafka-console-consumer --property print.key=true --property print.partition=true`)
   - the recommended property, checked against that request's own candidate pool.
4. Assert that no event of one task has another task's `trace_id`.

**`tests/evidence/agent-timeout/run.sh`:**
1. Start a request with `delay_risk_agent: true`.
2. Print:
   - the `agent.timed_out` event and its deadline
   - the result's `missing_agents` and `dissent_note`
   - the total latency, compared with a normal run.

**pytest:**
- output validation (each invalid field rejected)
- disagreement formula
- decision rule on a tie
- `recompute_result(task_id)` equals the stored result (spec 13.5 reproducibility)
- messaging and review rules.

**Also (spec 7.3.3), for the report with Rohini and Shashank:** make it easy to pull three wrong
cases, three where the Fairness Auditor changed the outcome, and one deadlock with forced resolution,
by `trace_id`, from `ai_events`.

---

## Checklist of things every endpoint must do

- The shared token check (`401` / `403`; WebSocket `4401` / `4403`), from `shared/`.
- The shared error format, with a readable `message` (the UI shows it as is).
- CORS for `http://localhost:5173`.
- `JWT_SECRET` only in `.env` (never the mock's `DEV_ONLY_JWT_SECRET`); `.env.example` committed.
- Every Kafka message is the shared envelope, validated; invalid → `dead.letter`.
- A `trace.steps` record for important steps, in the same `trace_id` (spec §8).
- Seed data with the same ids as `frontend/src/mocks/data/`.
