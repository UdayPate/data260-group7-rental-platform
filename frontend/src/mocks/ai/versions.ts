// Matcher versions and the feedback behind them (spec 7.5.4 and 7.5.5).
//
// - A change to the Matcher becomes a NEW version (matcher-v2); the old one is kept, so
//   the admin can roll back. Nothing is promoted automatically (team decisions V3a, V4a).
// - The evaluation numbers are SAMPLE values until the team's evaluation run (V2a). They
//   match the evaluation chart: the baseline is "Filter-count baseline" and matcher-v1 is
//   today's system ("Debate with Bias Auditor").
// - `state` is shared across browser windows by mocks/sync.ts (team decision S1a).
import type { FeedbackItem, MatcherVersion, MatcherWeights, VersionHistoryEntry } from '../../types/ai'
import { daysAgoDatetime } from '../dates'

const V1_WEIGHTS: MatcherWeights = { amenity_fit: 0.6, price: 0.35, rating: 0.1, risk_penalty: 0, review_count: 0.1 }

export const VERSIONS: MatcherVersion[] = [
  {
    version_id: 'matcher-v1',
    change: 'First version: amenity fit, price and rating, plus a small review-count term.',
    weights: V1_WEIGHTS,
    based_on_feedback_ids: [],
    evaluation: { precision_at_10: 0.59, recall_at_10: 0.71, mean_rank: 3.2, avg_latency_ms: 23400 },
    created_datetime: daysAgoDatetime(40),
  },
  {
    version_id: 'matcher-v2',
    change: 'Remove review count from the Matcher score (review_count weight 0.1 → 0), as the Fairness Auditor proposes in debates: popular listings were ranked above equally good newer ones.',
    weights: { ...V1_WEIGHTS, review_count: 0 },
    based_on_feedback_ids: ['fb_s01'],
    evaluation: { precision_at_10: 0.62, recall_at_10: 0.73, mean_rank: 2.9, avg_latency_ms: 23300 },
    created_datetime: daysAgoDatetime(3),
  },
]

export const BASELINE = { name: 'Filter-count baseline', precision_at_10: 0.41, recall_at_10: 0.52, mean_rank: 6.8, avg_latency_ms: 120 }

// Which version is active, and every promote / rollback (who and when).
export const state: { active_version_id: string; history: VersionHistoryEntry[] } = {
  active_version_id: 'matcher-v1',
  history: [],
}

export const versionById = (id: string) => VERSIONS.find((v) => v.version_id === id)
export const activeVersion = () => versionById(state.active_version_id)!

// Labelled sample feedback (team decision V1a). Two of them are the report's examples:
// one that led to matcher-v2, one rejected as insufficient or unreliable.
export const SAMPLE_FEEDBACK: FeedbackItem[] = [
  {
    feedback_id: 'fb_s01',
    trace_id: 'sample-trace-01',
    task_id: 'sample-task-01',
    guest_id: 'g_004',
    recommended_property_id: 'p_002',
    recommended_title: 'Budget Studio near SJSU',
    decision: 'edited',
    reason: 'Picked the newer Japantown flat instead: same amenities and price, it only ranked lower because it has few reviews.',
    decided_datetime: daysAgoDatetime(9),
    sample: true,
    outcome: 'led_to_version',
    outcome_version: 'matcher-v2',
    outcome_reason: 'Specific and checkable: the Fairness Auditor’s rerun without review count gives the same order change in 6 of 8 similar debates. Became matcher-v2.',
  },
  {
    feedback_id: 'fb_s02',
    trace_id: 'sample-trace-02',
    task_id: 'sample-task-02',
    guest_id: 'g_007',
    recommended_property_id: 'p_008',
    recommended_title: 'Naglee Park Guest Suite',
    decision: 'rejected',
    reason: 'Didn’t like it.',
    decided_datetime: daysAgoDatetime(6),
    sample: true,
    outcome: 'rejected',
    outcome_version: null,
    outcome_reason: 'Insufficient and unreliable: no reason the Matcher could use, and the same guest approved two very similar listings that week. No rule change.',
  },
  {
    feedback_id: 'fb_s03',
    trace_id: 'sample-trace-03',
    task_id: 'sample-task-03',
    guest_id: 'g_002',
    recommended_property_id: 'p_005',
    recommended_title: 'Santana Row Modern Condo',
    decision: 'approved',
    reason: null,
    decided_datetime: daysAgoDatetime(5),
    sample: true,
    outcome: null,
    outcome_version: null,
    outcome_reason: null,
  },
  {
    feedback_id: 'fb_s04',
    trace_id: 'sample-trace-04',
    task_id: 'sample-task-04',
    guest_id: 'g_009',
    recommended_property_id: 'p_011',
    recommended_title: 'Berryessa BART-side Condo',
    decision: 'rejected',
    reason: 'Host cancelled on a friend last month.',
    decided_datetime: daysAgoDatetime(4),
    sample: true,
    outcome: null,
    outcome_version: null,
    outcome_reason: null,
  },
  {
    feedback_id: 'fb_s05',
    trace_id: 'sample-trace-05',
    task_id: 'sample-task-05',
    guest_id: 'g_006',
    recommended_property_id: 'p_014',
    recommended_title: 'Las Palmas Park Townhome',
    decision: 'approved',
    reason: null,
    decided_datetime: daysAgoDatetime(2),
    sample: true,
    outcome: null,
    outcome_version: null,
    outcome_reason: null,
  },
]
