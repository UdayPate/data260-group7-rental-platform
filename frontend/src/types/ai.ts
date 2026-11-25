// AI Agent Service contract (see docs/api/data-contract.md, section "AI Agent Service").
// The debate is streamed as events that use the same shape as the shared Kafka envelope.
import type { Amenity, PropertyType } from './property'

// ---------- Agents ----------

export const AGENTS = ['parser', 'matcher', 'risk', 'fairness', 'explanation', 'chair'] as const
export type AgentId = (typeof AGENTS)[number]

// The three analysis agents that publish independent opinions in round 0 and vote in round 2.
export const ANALYSIS_AGENTS = ['matcher', 'risk', 'fairness'] as const
export type AnalysisAgentId = (typeof ANALYSIS_AGENTS)[number]

// ---------- Task ----------

export type TaskStatus =
  | 'waiting'
  | 'planning'
  | 'in_debate'
  | 'waiting_for_approval'
  | 'completed'
  | 'failed'
  | 'timed_out'

// Demo switches (spec 7.5.5). Both off by default.
export type DemoOptions = {
  delay_risk_agent: boolean // Risk agent misses its round-2 deadline -> agent.timed_out
  invalid_agent_output: boolean // one agent output fails the harness check -> agent.output_rejected
}

// ---------- Matcher weights and versions (spec 13.6, 7.5.4) ----------

// What the Matcher's score is made of. Each part is a measured value from 0 to 1.
export const WEIGHT_KEYS = ['amenity_fit', 'price', 'rating', 'risk_penalty', 'review_count'] as const
export type WeightKey = (typeof WEIGHT_KEYS)[number]

// How much each part counts, 0-1 each (team decision W2a). The score is the weighted sum
// divided by the sum of the weights; risk_penalty is subtracted instead of added.
export type MatcherWeights = Record<WeightKey, number>

// One candidate in the Matcher's own ranking: measured numbers only, no generated text.
export type MatcherRankEntry = {
  rank: number // 1 = best
  property_id: string
  title: string
  score: number // 0-1, from the weights and parts
  meets_must_haves: boolean // guests, dates, budget, type, minimum rating; false = ranked below all that do
  parts: Record<WeightKey, number> // each 0-1, before weighting
}

export type PlanStepStatus = 'pending' | 'in_progress' | 'done' | 'skipped' | 'failed'

export type PlanStep = {
  step_id: string // "s1" ... "s7"
  order: number
  title: string
  input: string
  expected_output: string
  agent: AgentId // responsible agent
  status: PlanStepStatus
  note: string | null
}

export type Plan = {
  plan_id: string
  trace_id: string
  steps: PlanStep[]
  created_datetime: string
}

// What the Guest Request Parser understood. null = not mentioned in the request.
export type ParsedRequirements = {
  location: string | null
  check_in: string | null // date
  check_out: string | null // date
  dates_assumed: boolean // true if the request had no dates and the parser picked some
  guest_count: number | null
  max_nightly_price: number | null
  min_rating: number | null
  amenities: Amenity[]
  property_types: PropertyType[]
}

export type AiTask = {
  task_id: string
  trace_id: string // unchanged across the whole workflow, every round, vote, result and approval
  guest_id: string
  request_text: string
  status: TaskStatus
  demo: DemoOptions
  plan: Plan | null
  requirements: ParsedRequirements | null
  matcher_version: string // e.g. "matcher-v1": the version active when the task started
  weights: MatcherWeights // the weights the Matcher used (the version's, or the guest's own on a rerun)
  parent_task_id: string | null // set on a rerun: the task it was rerun from
  created_datetime: string
  updated_datetime: string
  error: string | null
}

// ---------- Debate building blocks ----------

export type RankedProperty = {
  property_id: string
  title: string
  score: number // 0-1
  reasons: string[]
}

export type ReflectionCheck = { result: 'pass' | 'concern'; note: string }

export type Vote = 'keep' | 'switch' | 'abstain'

// ---------- Stream events (WebSocket messages and saved debate history) ----------
// Same field names as the shared Kafka envelope, plus seq (1, 2, 3 ... per task).

export type EventPayloads = {
  'task.status': { status: TaskStatus; note: string | null }
  'plan.created': { plan: Plan }
  'plan.step_updated': { step_id: string; status: PlanStepStatus; note: string | null }
  'requirements.parsed': { requirements: ParsedRequirements; candidate_ids: string[] }
  'round.started': { round: 0 | 1 | 2; deadline_ms: number; waiting_for: AgentId[] }
  'opinion.published': { round: 0; ranked: RankedProperty[]; confidence: number; reasoning: string }
  'agent.output_rejected': {
    agent: AgentId // whose output was rejected (the actor is "harness")
    round: 0 | 1 | 2
    reason: string
    invalid_fields: string[]
    action: 'retry' | 'dropped'
  }
  'reflection.recorded': {
    round: 0 | 1 | 2
    cycle: number // 1 = first check, 2 = after one revision (max 2)
    checks: { constraint: ReflectionCheck; evidence: ReflectionCheck; risk: ReflectionCheck; conflict: ReflectionCheck; action: ReflectionCheck }
    decision: 'keep' | 'revise' | 'reject'
  }
  'disagreement.detected': {
    round: 0
    score: number // 0 = all agree, up to 1
    method: string
    top_picks: { agent: AgentId; property_id: string }[]
    summary: string
  }
  'challenge.issued': {
    round: 1
    challenge_id: string
    to_agent: AgentId
    about_property_id: string | null
    question: string
  }
  'challenge.answered': { round: 2; challenge_id: string; answer: string; evidence: string[] }
  'vote.cast': { round: 2; vote: Vote; property_id: string | null; reason: string }
  // The actor is "harness"; `agent` is the one that missed its deadline.
  'agent.timed_out': { agent: AgentId; round: 0 | 1 | 2; deadline_ms: number; reason: string; fallback: string }
  'result.published': { result: AiResult }
  'decision.recorded': { decision: HumanDecision }
}

export type EventType = keyof EventPayloads

// One event. `T` narrows the payload when the event type is known.
export type StreamEvent<T extends EventType = EventType> = {
  [K in T]: {
    event_type: K
    trace_id: string
    timestamp: string // UTC, when the event was created
    actor_id: string // an AgentId, "harness", or the guest_id for decision.recorded
    entity: { entity_type: 'ai_task'; entity_id: string } // entity_id = task_id
    idempotency_key: string // "<task_id>:<seq>"
    seq: number // 1, 2, 3 ... within one task, no gaps
    payload: EventPayloads[K]
  }
}[T]

// ---------- Result and human decision ----------

export type ResultProperty = RankedProperty & { nightly_price: number; city: string }

export type HumanDecision = {
  decision: 'approved' | 'edited' | 'rejected'
  guest_id: string
  reason: string | null
  edited_property_id: string | null
  edited_rationale: string | null
  decided_datetime: string
}

export type AiResult = {
  task_id: string
  trace_id: string
  recommended: ResultProperty | null // null = nothing matched (see suggestions)
  ranked: ResultProperty[] // top 5 candidates
  confidence: number // 0-1
  rationale: string // plain-language explanation (generated text)
  evidence: { fact: string; source: string }[] // measured facts, kept apart from the generated text
  risks: { severity: 'low' | 'medium' | 'high'; text: string; source_agent: AgentId }[]
  consensus: boolean
  decision_rule: string | null // set when the chair had to break a tie or deadlock
  dissent: { agent: AgentId; preferred_property_id: string | null; reason: string }[]
  dissent_note: string | null
  missing_agents: { agent: AgentId; round: 0 | 1 | 2; reason: string }[]
  comparison: { rejected_property_id: string; rejected_title: string; why_lower: string } | null
  suggestions: string[] // only when nothing matched
  check_in: string | null // dates/guests to carry to the booking page
  check_out: string | null
  guest_count: number | null
  human_decision: HumanDecision | null
  matcher_version: string
  weights: MatcherWeights
  parent_task_id: string | null
  matcher_ranking: MatcherRankEntry[] // the Matcher's top 10 (measured), for comparing runs
  created_datetime: string
}

// ---------- Request / response bodies ----------

export type CreateAiRequest = {
  guest_id: string
  request_text: string
  demo?: Partial<DemoOptions>
  weights?: MatcherWeights // optional: rerun with these weights instead of the active version's
  parent_task_id?: string // optional: the task this one reruns (must be the same guest's)
}
export type CreateAiResponse = { task_id: string; trace_id: string; status: TaskStatus }
export type GetAiTaskResponse = { task: AiTask; events: StreamEvent[] }

export type ApproveAiRequest = {
  guest_id: string
  edits?: { property_id?: string; rationale?: string } // any edit makes the decision "edited"
  reason?: string
}
export type RejectAiRequest = { guest_id: string; reason: string }

// ---------- Self-improvement: feedback and versions (spec 7.5.4, 7.5.5) ----------

export type FeedbackItem = {
  feedback_id: string
  trace_id: string
  task_id: string
  guest_id: string
  recommended_property_id: string | null
  recommended_title: string | null
  decision: HumanDecision['decision']
  reason: string | null
  decided_datetime: string
  sample: boolean // true = a labelled sample entry, not a real decision
  outcome: 'led_to_version' | 'rejected' | null // what the team did with it
  outcome_version: string | null // e.g. "matcher-v2" when it led to a version
  outcome_reason: string | null // why it led to a change, or why it was rejected
}

export type VersionEvaluation = {
  precision_at_10: number
  recall_at_10: number
  mean_rank: number // of the human top choice; lower is better
  avg_latency_ms: number
}

export type MatcherVersion = {
  version_id: string // "matcher-v1"
  change: string // what changed compared with the previous version
  weights: MatcherWeights
  based_on_feedback_ids: string[]
  evaluation: VersionEvaluation
  created_datetime: string
}

export type VersionHistoryEntry = {
  action: 'promote' | 'rollback'
  version_id: string // the version made active
  by_id: string // admin id
  by_name: string
  at: string // datetime
}

export type VersionsResponse = {
  active_version_id: string
  versions: MatcherVersion[]
  baseline: { name: string } & VersionEvaluation // the filter-count baseline, for comparison
  history: VersionHistoryEntry[]
  evaluation_sample: boolean // true while the evaluation numbers are sample values
}
