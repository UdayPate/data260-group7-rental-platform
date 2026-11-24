// Sample values for numbers that will come from Kafka or the evaluation run (team decision C5a).
// The dashboards label everything from this file as "sample".

// ---------- Past AI debates (before this browser session) ----------
export type DebateSummary = {
  guest_id: string
  days_ago: number
  disagreement: number // 0, 0.33 or 0.67
  challenges: number
  votes: { keep: number; switch: number; abstain: number; timeout: number }
  dissent: boolean
  decision: 'approved' | 'edited' | 'rejected' | null // null = no decision yet
  match_score: number // 0-1, score of the recommended stay
}

// One row = one past debate.
const ROWS: [string, number, number, number, [number, number, number, number], boolean, DebateSummary['decision'], number][] = [
  // guest, days ago, disagreement, challenges, [keep, switch, abstain, timeout], dissent, decision, match score
  ['g_001', 3, 0.33, 3, [2, 1, 0, 0], true, 'approved', 0.84],
  ['g_001', 18, 0, 1, [3, 0, 0, 0], false, 'approved', 0.91],
  ['g_001', 40, 0.33, 3, [1, 1, 0, 1], true, 'edited', 0.78],
  ['g_002', 2, 0.67, 4, [1, 1, 1, 0], true, 'rejected', 0.69],
  ['g_002', 21, 0.33, 3, [2, 1, 0, 0], true, 'approved', 0.82],
  ['g_003', 5, 0, 1, [3, 0, 0, 0], false, 'approved', 0.88],
  ['g_003', 26, 0.33, 3, [2, 0, 1, 0], true, 'edited', 0.8],
  ['g_004', 7, 0.33, 2, [2, 1, 0, 0], false, 'approved', 0.86],
  ['g_004', 29, 0.67, 4, [1, 1, 0, 1], true, 'rejected', 0.64],
  ['g_006', 4, 0, 1, [3, 0, 0, 0], false, 'approved', 0.93],
  ['g_006', 12, 0.33, 3, [2, 1, 0, 0], true, 'approved', 0.81],
  ['g_007', 9, 0.33, 3, [1, 2, 0, 0], false, 'edited', 0.77],
  ['g_008', 6, 0, 1, [3, 0, 0, 0], false, 'approved', 0.9],
  ['g_008', 33, 0.33, 2, [2, 0, 0, 1], true, null, 0.79],
  ['g_009', 11, 0.67, 4, [1, 1, 1, 0], true, 'rejected', 0.66],
  ['g_010', 14, 0.33, 3, [2, 1, 0, 0], true, 'approved', 0.83],
  ['g_010', 47, 0, 1, [3, 0, 0, 0], false, 'approved', 0.89],
  ['g_011', 8, 0.33, 3, [2, 1, 0, 0], false, 'approved', 0.85],
  ['g_011', 23, 0.33, 2, [1, 1, 0, 1], true, 'edited', 0.74],
  ['g_012', 1, 0, 1, [3, 0, 0, 0], false, null, 0.87],
  ['g_012', 16, 0.67, 4, [1, 1, 1, 0], true, 'approved', 0.71],
  ['g_002', 52, 0.33, 3, [2, 1, 0, 0], true, 'approved', 0.8],
  ['g_005', 61, 0, 1, [3, 0, 0, 0], false, 'approved', 0.9],
  ['g_009', 75, 0.33, 3, [2, 0, 0, 1], true, 'rejected', 0.72],
]

export const sampleDebates: DebateSummary[] = ROWS.map(([guest_id, days_ago, disagreement, challenges, v, dissent, decision, match_score]) => ({
  guest_id,
  days_ago,
  disagreement,
  challenges,
  votes: { keep: v[0], switch: v[1], abstain: v[2], timeout: v[3] },
  dissent,
  decision,
  match_score,
}))

// ---------- The 50-request benchmark (spec 7.3.1) ----------
export const sampleEvaluation = [
  { configuration: 'Filter-count baseline', precision_at_10: 0.41, recall_at_10: 0.52, mean_rank: 6.8 },
  { configuration: 'Single-agent matching', precision_at_10: 0.49, recall_at_10: 0.61, mean_rank: 4.9 },
  { configuration: 'Debate without Bias Auditor', precision_at_10: 0.56, recall_at_10: 0.68, mean_rank: 3.7 },
  { configuration: 'Debate with Bias Auditor', precision_at_10: 0.59, recall_at_10: 0.71, mean_rank: 3.2 },
  { configuration: 'Human agreement ceiling', precision_at_10: 0.78, recall_at_10: 0.86, mean_rank: 1.6 },
]

// ---------- Kafka and service metrics ----------
export const CONSUMER_GROUPS = ['booking-workers', 'analytics-consumers', 'ai-chair', 'notifications'] // max 4 (P1a)

// A repeatable wiggle (no Math.random, so every reload looks the same).
export const wave = (i: number, seed: number, base: number, amplitude: number) =>
  Math.max(0, Math.round(base + amplitude * Math.sin(i * 0.9 + seed) + (amplitude / 2) * Math.sin(i * 0.37 + seed * 2)))

export const sampleErrorsPer30Days = [
  { service: 'booking-service', errors: 14, retries: 31 },
  { service: 'property-service', errors: 6, retries: 9 },
  { service: 'messaging-service', errors: 3, retries: 7 },
  { service: 'review-service', errors: 2, retries: 4 },
  { service: 'ai-service', errors: 11, retries: 26 },
  { service: 'analytics-service', errors: 4, retries: 12 },
]

export const sampleDeadLetters = [
  { topic: 'booking.requested', reason: 'Envelope missing idempotency_key', days_ago: 2 },
  { topic: 'debate.round.0', reason: 'Agent output failed schema check after 1 retry (unknown property_id)', days_ago: 5 },
  { topic: 'review.created', reason: 'Consumer failed 3 times: property not found', days_ago: 11 },
]

// Average / 95th-percentile end-to-end times per workflow (ms).
export const sampleWorkflowLatency = [
  { workflow: 'Property search', avg_ms: 95, p95_ms: 240 },
  { workflow: 'Booking request → stored', avg_ms: 140, p95_ms: 390 },
  { workflow: 'Booking request → host notified', avg_ms: 820, p95_ms: 2100 },
  { workflow: 'Dates taken → other viewers’ pages', avg_ms: 60, p95_ms: 180 },
  { workflow: 'AI request → verdict', avg_ms: 23400, p95_ms: 26900 },
]
