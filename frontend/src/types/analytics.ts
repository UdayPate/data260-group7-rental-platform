// Analytics & Logging Service contract (owners: Rohini and Shashank).
// See docs/api/data-contract.md, section "Analytics".

// ---------- Where a number comes from (team decision C5a) ----------
// "computed" = calculated from the platform's own records; "sample" = realistic sample values
// (Kafka metrics, the evaluation run) until the real pipeline provides them.
export type Source = { kind: 'computed' | 'sample'; note: string }

// ---------- Events sent by the UI (C4a) ----------
// Same envelope as every Kafka message (spec 6.2).
// availability.notified (team decision R6a): one per live calendar update, with the measured latency.
export const UI_EVENT_TYPES = ['property.viewed', 'search.performed', 'availability.notified'] as const
export type UiEventType = (typeof UI_EVENT_TYPES)[number]

export type EventEnvelope = {
  event_type: string
  trace_id: string
  timestamp: string // UTC
  actor_id: string
  entity: { entity_type: string; entity_id: string }
  payload: Record<string, unknown>
  idempotency_key: string
}
export type IngestResponse = { accepted: true; duplicate: boolean }

// ---------- Journeys (trace_id) ----------
export type StepStatus = 'ok' | 'retried' | 'failed' | 'timed_out' | 'dead_lettered'

// One workflow step, with the fields spec section 8 asks to persist.
export type TraceStep = {
  trace_id: string
  event_type: string
  service: string
  timestamp: string
  latency_ms: number
  status: StepStatus
  error: string | null
}

export type TraceSummary = {
  trace_id: string
  kind: 'booking' | 'ai'
  entity_id: string // the reservation_id (booking) or task_id (ai) this journey is about
  title: string // e.g. "Booking r_008 · Santana Row Modern Condo"
  started: string
  total_ms: number
  step_count: number
  has_problem: boolean // any step not "ok"
}

export type Trace = TraceSummary & { steps: TraceStep[]; source: Source }

// ---------- Dashboards ----------
export type DayCount = { date: string; count: number }
export type ApprovalCounts = { approved: number; edited: number; rejected: number }

export type GuestDashboard = {
  guest_id: string
  days: number
  bookings_per_day: DayCount[] // one entry per day in the range
  status_summary: { status: string; count: number }[]
  saved_per_week: { week_start: string; saves: number }[]
  average_match_score: number | null // 0-1, of recommendations this guest received
  recommendation_approvals: ApprovalCounts
  sources: Record<'bookings' | 'saved' | 'recommendations', Source>
}

export type HostDashboard = {
  host_id: string
  days: number
  funnel: { step: 'views' | 'saves' | 'requests' | 'approved'; count: number }[]
  occupancy_rate: number // 0-1: booked nights / (active listings x days)
  average_nightly_price: number
  average_response_minutes: number
  response_rate: number // percent
  revenue_by_month: { month: string; revenue: number }[] // last 6 months, "2026-06"
  cancellations_by_month: { month: string; cancellations: number }[]
  rating_by_month: { month: string; average_rating: number | null; reviews: number }[]
  sources: Record<'funnel' | 'bookings' | 'reviews' | 'response', Source>
}

export type PlatformDashboard = {
  days: number
  trace_id: string | null
  events_by_topic: { topic: string; count: number }[]
  consumer_lag: { time: string; [group: string]: number | string }[] // one key per consumer group
  consumer_groups: string[] // up to 4 (team decision P1a)
  throughput: { time: string; events_per_sec: number }[]
  errors_retries: { service: string; errors: number; retries: number }[]
  dead_letters: { topic: string; reason: string; trace_id: string; timestamp: string }[]
  rejected_envelopes: number
  workflow_latency: { workflow: string; avg_ms: number; p95_ms: number }[]
  sources: Record<'events' | 'kafka' | 'errors' | 'dead_letters' | 'latency', Source>
}

export type TimelinePoint = { agent: string; event_type: string; offset_ms: number; round: number | null }

export type AiDashboard = {
  days: number
  trace_id: string | null
  debates: number
  timeline: { trace_id: string; task_id: string; request_text: string; points: TimelinePoint[] } | null
  disagreement_histogram: { bucket: string; debates: number }[] // "0", "0.33", "0.67"
  average_challenges: number
  dissent_rate: number // 0-1, share of debates whose result has a dissent note
  votes: { vote: 'keep' | 'switch' | 'abstain' | 'timeout'; count: number }[]
  evaluation: { configuration: string; precision_at_10: number; recall_at_10: number; mean_rank: number }[]
  approvals: ApprovalCounts
  sources: Record<'debates' | 'evaluation' | 'approvals', Source>
}

// Spec endpoints also defined in the contract (used for completeness / other tools).
export type TopProperty = { property_id: string; title: string; city: string; bookings: number; revenue: number }
export type FunnelResponse = { host_id: string | null; days: number; funnel: HostDashboard['funnel'] }
export type GeoRow = { city: string; bookings: number; listings: number }
