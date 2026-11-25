# Himja: checklist

AI Agent Service, Messaging Service, Review Service. Details for each step (same numbers):
[himja-guide.md](himja-guide.md).

**Mandatory features you own:** three concurrent debates with trace isolation (step 5, evidence in
step 14), agent timeout and partial results (step 8, evidence in step 14).

**You need from Tanya first:** `infra/docker-compose.yml` (Kafka, MongoDB), the `shared/` library
(token check, envelope, Kafka helpers), and a running User Service for real tokens (her steps 1–4).
Until then, start with step 1 using a local Kafka and MongoDB, and read the mock debate in
`frontend/src/mocks/ai/`.

---

- [ ] **1. AI service skeleton.** FastAPI app from `shared/`, MongoDB collections (tasks, events, results, feedback, versions), read-only access to listing data.
  - Done when: `GET /health` is ok, a guest token reaches a stub endpoint, a host token gets `403`, and the service can read `p_001` from the listing data.
  - Target: ____

- [ ] **2. REST endpoints, task store and stream with replay** (`POST /ai/requests`, `GET /ai/tasks/{id}`, `GET /ai/results/{id}`, WebSocket `?after_seq=N`).
  - Done when: with `VITE_AI_API_BASE_URL` set, asking the agents opens The Forum page, a scripted fake debate streams in, and reloading mid-debate rebuilds it with no missing or doubled events.
  - Target: ____

- [ ] **3. Request Parser and the plan.**
  - Done when: the spec's request produces `requirements.parsed` (San Jose, 2 guests, ≤ $250, parking + kitchen, 4.5+, dates assumed) and a 7-step `plan.created`, both shown on The Forum.
  - Target: ____

- [ ] **4. Round 0 agents: Matcher (weights and version), Risk, Fairness Auditor, with reflection.**
  - Done when: for the spec request the three agents publish to `debate.round.0` without seeing each other, the Matcher's #1 differs from Risk's (as in the mock: Budget Studio vs Willow Glen), and each shows a reflection check.
  - Target: ____

- [ ] **5. Kafka routing and trace isolation** (spec 13.11, mandatory).
  - Done when: every AI topic uses key = `trace_id`, consumers ignore other tasks' messages, and three debates started together each show only their own events (no "[ai-stream] DROPPED" lines in the browser console).
  - Target: ____

- [ ] **6. Chair: disagreement, challenges (Round 1), answers and votes (Round 2), decision rule, result.**
  - Done when: The Forum shows the disagreement score, a challenge to the Fairness Auditor every time, answers, a vote with a reason from each agent, and a final verdict with dissent note, evidence, risks and comparison.
  - Target: ____

- [ ] **7. Explanation skill and the measured / generated split.**
  - Done when: the verdict's `rationale` is plain language, every `evidence` item has a `source`, and none of the `evidence` comes from the model's text.
  - Target: ____

- [ ] **8. Harness: output validation, timeouts, partial results, demo switches** (spec 7.5.1, 13.10, mandatory).
  - Done when: with "invalid agent output" on, the Matcher's output is rejected then retried; with "delay Risk agent" on, Risk times out, the debate still finishes, and the result lists `risk` in `missing_agents`.
  - Target: ____

- [ ] **9. Human approval and feedback.**
  - Done when: Approve, Edit and Reject on The Forum work with the real service, nothing is booked by approving, and each decision appears in `GET /ai/feedback` with its `trace_id`.
  - Target: ____

- [ ] **10. Versions, promote and rollback, weight reruns** (spec 7.5.4, 13.6).
  - Done when: the admin sees v1 active and v2 proposed on the AI dashboard, promotes v2 and rolls back (with confirm), new debates record the active version, and "Change weights and rerun" (risk penalty 0.40) moves the Matcher's #1.
  - Also add the `AI_MODE=full|matcher_only|no_auditor` switch that Rohini and Shashank's benchmark needs.
  - Target: ____

- [ ] **11. Model routing and semantic cache** (slide 6).
  - Done when: simple requests use the small model, hard ones the frontier model, a repeated or near-identical request hits the semantic cache, and counters (hits, calls per model, latency) are stored for Rohini and Shashank.
  - Target: ____

- [ ] **12. Messaging Service.**
  - Done when: with `VITE_MESSAGING_API_BASE_URL` set, Alex and Maya exchange messages, the unread badge and delivery status (sent → delivered → read) update, and a host can't open a thread with a guest who never booked (`403`).
  - Target: ____

- [ ] **13. Review Service.**
  - Done when: with `VITE_REVIEW_API_BASE_URL` set, Alex reviews a completed stay, a second review gets `409 DUPLICATE_REVIEW`, Maya replies once, and `review.created` updates the listing's rating (Tanya's consumer).
  - Target: ____

- [ ] **14. Evidence pack.** Automated tests and scripts for the mandatory features.
  - Done when: `tests/evidence/three-debates/run.sh` and `tests/evidence/agent-timeout/run.sh` run from a clean start and print the trace ids, per-task event counts and results that prove isolation and safe continuation.
  - Target: ____
