// Mock dashboard calculations. Each value is either "computed" from the mock database
// (bookings, saves, reviews, messages, this session's AI debates) or "sample" (Kafka
// metrics, the evaluation run, past debates) - the `sources` field says which (C5a).
import type {
  AiDashboard,
  ApprovalCounts,
  GuestDashboard,
  HostDashboard,
  PlatformDashboard,
  Source,
  TimelinePoint,
} from '../../types/analytics'
import type { AgentId } from '../../types/ai'
import { allTaskEntries } from '../ai/bus'
import { daysFromToday, today } from '../dates'
import { db } from '../db'
import { findTrace } from './journeys'
import {
  CONSUMER_GROUPS,
  sampleDeadLetters,
  sampleDebates,
  sampleErrorsPer30Days,
  sampleEvaluation,
  sampleWorkflowLatency,
  wave,
  type DebateSummary,
} from './sampleData'

const DAY = 24 * 60 * 60 * 1000
const computed = (note: string): Source => ({ kind: 'computed', note })
const sample = (note: string): Source => ({ kind: 'sample', note })

// True if an ISO time is within the last `days` days.
const withinDays = (iso: string, days: number) => Date.parse(iso) >= Date.now() - days * DAY && Date.parse(iso) <= Date.now()

// The last n months as "YYYY-MM", oldest first.
function lastMonths(n: number): string[] {
  const out: string[] = []
  const d = new Date()
  d.setDate(1)
  for (let i = n - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, 1)
    out.push(`${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

// ---------- AI debates of this browser session, in the same shape as the sample ones ----------

type SessionDebate = DebateSummary & { trace_id: string; task_id: string; verdict_ms: number | null }

function sessionDebates(): SessionDebate[] {
  return allTaskEntries()
    .filter((e) => e.result !== null)
    .map((e) => {
      const result = e.result!
      const disagreement = e.events.find((x) => x.event_type === 'disagreement.detected')
      const votes = { keep: 0, switch: 0, abstain: 0, timeout: 0 }
      for (const x of e.events) {
        if (x.event_type === 'vote.cast') votes[x.payload.vote] += 1
        if (x.event_type === 'agent.timed_out') votes.timeout += 1
      }
      const verdict = e.events.find((x) => x.event_type === 'result.published')
      return {
        guest_id: e.task.guest_id,
        days_ago: 0,
        disagreement: disagreement?.event_type === 'disagreement.detected' ? disagreement.payload.score : 0,
        challenges: e.events.filter((x) => x.event_type === 'challenge.issued').length,
        votes,
        dissent: result.dissent_note !== null,
        decision: result.human_decision?.decision ?? null,
        match_score: result.recommended?.score ?? 0,
        trace_id: e.task.trace_id,
        task_id: e.task.task_id,
        verdict_ms: verdict ? Date.parse(verdict.timestamp) - Date.parse(e.task.created_datetime) : null,
      }
    })
}

function approvalsOf(debates: DebateSummary[]): ApprovalCounts {
  const counts = { approved: 0, edited: 0, rejected: 0 }
  for (const d of debates) if (d.decision) counts[d.decision] += 1
  return counts
}

const average = (values: number[]) => (values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length)
const round2 = (n: number) => Math.round(n * 100) / 100

// ---------- Guest ----------

export function guestDashboard(guestId: string, days: number): GuestDashboard {
  const mine = db.reservations.filter((r) => r.guest_id === guestId)
  const bookings_per_day = Array.from({ length: days }, (_, i) => {
    const date = daysFromToday(-(days - 1 - i))
    return { date, count: mine.filter((r) => r.booking_datetime.slice(0, 10) === date).length }
  })
  const statuses = ['pending', 'approved', 'completed', 'declined', 'cancelled']
  const status_summary = statuses.map((status) => ({ status, count: mine.filter((r) => r.status === status).length }))

  const weeks = Math.ceil(days / 7)
  const saved_per_week = Array.from({ length: weeks }, (_, i) => {
    const w = weeks - 1 - i
    const start = daysFromToday(-(w * 7 + 6))
    const end = daysFromToday(-(w * 7))
    const saves = db.saved.filter((s) => {
      const d = (s.saved_datetime ?? '').slice(0, 10)
      return s.guest_id === guestId && d >= start && d <= end
    }).length
    return { week_start: start, saves }
  })

  const past = sampleDebates.filter((d) => d.guest_id === guestId && d.days_ago <= days)
  const session = sessionDebates().filter((d) => d.guest_id === guestId)
  const debates = [...past, ...session]
  const score = average(debates.map((d) => d.match_score).filter((s) => s > 0))

  return {
    guest_id: guestId,
    days,
    bookings_per_day,
    status_summary,
    saved_per_week,
    average_match_score: score === null ? null : round2(score),
    recommendation_approvals: approvalsOf(debates),
    sources: {
      bookings: computed('From this guest’s reservations'),
      saved: computed('From saved stays'),
      recommendations:
        past.length > 0
          ? sample(`${past.length} earlier debates are sample data; ${session.length} from this session are real`)
          : computed('From this session’s AI debates'),
    },
  }
}

// ---------- Host ----------

export function hostDashboard(hostId: string, days: number): HostDashboard {
  const host = db.hosts.find((h) => h.host_id === hostId)
  const allListings = db.properties.filter((p) => p.host_id === hostId)
  const active = allListings.filter((p) => p.status === 'active')
  const ids = allListings.map((p) => p.property_id)
  const theirs = db.reservations.filter((r) => ids.includes(r.property_id))

  // Funnel: views (UI events + a sample baseline), saves, requests, approved.
  const realViews = db.uiEvents.filter(
    (e) => e.event_type === 'property.viewed' && ids.includes(e.entity.entity_id) && withinDays(e.timestamp, days),
  ).length
  const baselineViews = Math.round(active.length * 35 * (days / 30))
  const requests = theirs.filter((r) => withinDays(r.booking_datetime, days))
  const funnel: HostDashboard['funnel'] = [
    { step: 'views', count: baselineViews + realViews },
    { step: 'saves', count: db.saved.filter((s) => ids.includes(s.property_id) && withinDays(s.saved_datetime ?? '', days)).length },
    { step: 'requests', count: requests.length },
    { step: 'approved', count: requests.filter((r) => r.status === 'approved' || r.status === 'completed').length },
  ]

  // Occupancy: share of the next `days` nights that are booked (approved stays).
  let bookedNights = 0
  for (const listing of active) {
    for (let i = 0; i < days; i++) {
      const night = daysFromToday(i)
      const booked = theirs.some(
        (r) => r.property_id === listing.property_id && (r.status === 'approved' || r.status === 'completed') && r.check_in <= night && night < r.check_out,
      )
      if (booked) bookedNights += 1
    }
  }
  const occupancy = active.length === 0 ? 0 : bookedNights / (active.length * days)

  const months = lastMonths(12)
  const paid = theirs.filter((r) => r.status === 'approved' || r.status === 'completed')
  const reviews = db.reviews.filter((v) => v.host_id === hostId)

  return {
    host_id: hostId,
    days,
    funnel,
    occupancy_rate: round2(occupancy),
    average_nightly_price: Math.round(average(active.map((p) => p.nightly_price)) ?? 0),
    average_response_minutes: host?.response_time ?? 0,
    response_rate: host?.response_rate ?? 0,
    revenue_by_month: months.map((month) => ({
      month,
      revenue: paid.filter((r) => r.check_in.startsWith(month)).reduce((sum, r) => sum + r.price_breakdown.total, 0),
    })),
    cancellations_by_month: months.map((month) => ({
      month,
      cancellations: theirs.filter((r) => (r.status === 'cancelled' || r.status === 'declined') && r.booking_datetime.startsWith(month)).length,
    })),
    rating_by_month: months.map((month) => {
      const inMonth = reviews.filter((v) => v.created_datetime.startsWith(month))
      const avg = average(inMonth.map((v) => v.rating))
      return { month, average_rating: avg === null ? null : round2(avg), reviews: inMonth.length }
    }),
    sources: {
      funnel: sample(`Views include a sample baseline (${baselineViews}) plus ${realViews} real page views; saves, requests and approvals are computed`),
      bookings: computed('From reservations'),
      reviews: computed('From reviews of your listings'),
      response: computed('From your host profile'),
    },
  }
}

// ---------- Platform ----------

// Domain events in the window, counted per Kafka topic.
function eventsByTopic(days: number) {
  const r = db.reservations
  const counts: Record<string, number> = {
    'booking.requested': r.filter((x) => withinDays(x.booking_datetime, days)).length,
    'booking.approved': r.filter((x) => (x.status === 'approved' || x.status === 'completed') && withinDays(x.booking_datetime, days)).length,
    'booking.declined': r.filter((x) => x.status === 'declined' && withinDays(x.booking_datetime, days)).length,
    'booking.cancelled': r.filter((x) => x.status === 'cancelled' && withinDays(x.booking_datetime, days)).length,
    'booking.completed': r.filter((x) => x.status === 'completed' && x.check_out >= daysFromToday(-days) && x.check_out <= today()).length,
    'review.created': db.reviews.filter((v) => withinDays(v.created_datetime, days)).length,
    'message.sent': db.messages.filter((m) => withinDays(m.timestamp, days)).length,
    'property.saved': db.saved.filter((s) => withinDays(s.saved_datetime ?? '', days)).length,
    'property.viewed': db.uiEvents.filter((e) => e.event_type === 'property.viewed' && withinDays(e.timestamp, days)).length,
    'search.performed': db.uiEvents.filter((e) => e.event_type === 'search.performed' && withinDays(e.timestamp, days)).length,
    'availability.notified': db.uiEvents.filter((e) => e.event_type === 'availability.notified' && withinDays(e.timestamp, days)).length,
    'ai.requests': allTaskEntries().length,
    'debate.round.0': 0,
    'debate.round.1': 0,
    'debate.round.2': 0,
    'ai.results': 0,
  }
  for (const e of allTaskEntries()) {
    for (const x of e.events) {
      if (x.event_type === 'opinion.published') counts['debate.round.0'] += 1
      if (x.event_type === 'challenge.issued') counts['debate.round.1'] += 1
      if (x.event_type === 'challenge.answered' || x.event_type === 'vote.cast') counts['debate.round.2'] += 1
      if (x.event_type === 'result.published') counts['ai.results'] += 1
    }
  }
  return Object.entries(counts)
    .map(([topic, count]) => ({ topic, count }))
    .sort((a, b) => b.count - a.count)
}

export function platformDashboard(days: number, traceId: string | null): PlatformDashboard {
  const step = days <= 30 ? 1 : 3 // one point per day, or every 3 days for 90 days
  const points = Math.ceil(days / step)
  const timeAt = (i: number) => daysFromToday(-(points - 1 - i) * step)

  const consumer_lag = Array.from({ length: points }, (_, i) => {
    const row: { time: string; [group: string]: number | string } = { time: timeAt(i) }
    CONSUMER_GROUPS.forEach((g, gi) => (row[g] = wave(i, gi + 1, [40, 120, 15, 25][gi], [25, 70, 10, 15][gi])))
    return row
  })
  const throughput = Array.from({ length: points }, (_, i) => ({ time: timeAt(i), events_per_sec: wave(i, 7, 180, 60) }))

  // With a trace: count that journey's steps per event type.
  const trace = traceId ? findTrace(traceId) : null
  const traceTopics = trace
    ? Object.entries(
        trace.steps.reduce<Record<string, number>>((acc, s) => {
          acc[s.event_type] = (acc[s.event_type] ?? 0) + 1
          return acc
        }, {}),
      ).map(([topic, count]) => ({ topic, count }))
    : null

  const session = sessionDebates().filter((d) => d.verdict_ms !== null)
  const aiAvg = average(session.map((d) => d.verdict_ms!))
  // Live calendar updates measured by guests' pages (spec 13.4, team decision R6a).
  const pushLatencies = db.uiEvents
    .filter((e) => e.event_type === 'availability.notified' && typeof e.payload.latency_ms === 'number')
    .map((e) => e.payload.latency_ms as number)
  const pushAvg = average(pushLatencies)
  const sorted = [...pushLatencies].sort((a, b) => a - b)
  const pushP95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]

  const workflow_latency = sampleWorkflowLatency.map((w) => {
    if (w.workflow === 'AI request → verdict' && aiAvg !== null) {
      return { workflow: w.workflow, avg_ms: Math.round(aiAvg), p95_ms: Math.round(Math.max(...session.map((d) => d.verdict_ms!))) }
    }
    if (w.workflow === 'Dates taken → other viewers’ pages' && pushAvg !== null) {
      return { workflow: w.workflow, avg_ms: Math.round(pushAvg), p95_ms: pushP95 }
    }
    return w
  })
  const measured = [aiAvg !== null && '“AI request → verdict”', pushAvg !== null && '“Dates taken → other viewers’ pages”'].filter(Boolean)

  const scale = days / 30
  return {
    days,
    trace_id: trace ? trace.trace_id : null,
    events_by_topic: traceTopics ?? eventsByTopic(days),
    consumer_lag,
    consumer_groups: CONSUMER_GROUPS,
    throughput,
    errors_retries: sampleErrorsPer30Days.map((e) => ({ service: e.service, errors: Math.round(e.errors * scale), retries: Math.round(e.retries * scale) })),
    dead_letters: [
      ...db.rejectedEnvelopes,
      ...sampleDeadLetters
        .filter((d) => d.days_ago <= days)
        .map((d) => ({ topic: d.topic, reason: d.reason, trace_id: `sample-dlq-${d.days_ago}`, timestamp: new Date(Date.now() - d.days_ago * DAY).toISOString() })),
    ],
    rejected_envelopes: db.rejectedEnvelopes.length,
    workflow_latency,
    sources: {
      events: trace ? computed('Steps of this journey') : computed('Counted from bookings, reviews, messages, saves, UI events and AI debates'),
      kafka: sample('Kafka consumer lag and throughput'),
      errors: sample('Service error and retry counters'),
      dead_letters: sample(`${db.rejectedEnvelopes.length} real rejected envelope(s) from /events/ingest, plus sample dead letters`),
      latency:
        measured.length > 0
          ? sample(`Sample, except ${measured.join(' and ')}, measured in this session`)
          : sample('Workflow timings'),
    },
  }
}

// ---------- AI ----------

// A typical debate, shown until a debate has run in this session.
const SAMPLE_TIMELINE: TimelinePoint[] = [
  { agent: 'parser', event_type: 'requirements.parsed', offset_ms: 3000, round: null },
  { agent: 'matcher', event_type: 'opinion.published', offset_ms: 5600, round: 0 },
  { agent: 'fairness', event_type: 'opinion.published', offset_ms: 7000, round: 0 },
  { agent: 'risk', event_type: 'opinion.published', offset_ms: 8200, round: 0 },
  { agent: 'chair', event_type: 'disagreement.detected', offset_ms: 10200, round: 0 },
  { agent: 'chair', event_type: 'challenge.issued', offset_ms: 11400, round: 1 },
  { agent: 'chair', event_type: 'challenge.issued', offset_ms: 12000, round: 1 },
  { agent: 'chair', event_type: 'challenge.issued', offset_ms: 12600, round: 1 },
  { agent: 'matcher', event_type: 'vote.cast', offset_ms: 15200, round: 2 },
  { agent: 'fairness', event_type: 'vote.cast', offset_ms: 16800, round: 2 },
  { agent: 'risk', event_type: 'vote.cast', offset_ms: 18400, round: 2 },
  { agent: 'chair', event_type: 'result.published', offset_ms: 21400, round: null },
]

const HIDDEN_TIMELINE_EVENTS = ['task.status', 'plan.step_updated', 'round.started']

function timelineOf(taskId: string): AiDashboard['timeline'] {
  const entry = allTaskEntries().find((e) => e.task.task_id === taskId)
  if (!entry) return null
  const start = Date.parse(entry.task.created_datetime)
  const points = entry.events
    .filter((e) => !HIDDEN_TIMELINE_EVENTS.includes(e.event_type))
    .map((e) => {
      const payload = e.payload as { agent?: AgentId; round?: number }
      // Timeouts and rejected outputs are reported by the harness but belong to an agent.
      const agent = e.actor_id === 'harness' ? (payload.agent ?? 'harness') : e.actor_id
      return { agent, event_type: e.event_type, offset_ms: Date.parse(e.timestamp) - start, round: payload.round ?? null }
    })
  return { trace_id: entry.task.trace_id, task_id: entry.task.task_id, request_text: entry.task.request_text, points }
}

export function aiDashboard(days: number, traceId: string | null): AiDashboard {
  const session = sessionDebates()
  const traced = traceId ? session.filter((d) => d.trace_id === traceId) : []
  // With a matching trace: just that debate. Otherwise: sample history + this session.
  const past = traced.length > 0 ? [] : sampleDebates.filter((d) => d.days_ago <= days)
  const debates: DebateSummary[] = traced.length > 0 ? traced : [...past, ...session]

  const latestTask = traced[0]?.task_id ?? session[session.length - 1]?.task_id ?? allTaskEntries().at(-1)?.task.task_id
  const timeline = latestTask
    ? timelineOf(latestTask)
    : { trace_id: 'sample', task_id: 'sample', request_text: 'Sample debate (run one on the AI Assistant page to see a real one)', points: SAMPLE_TIMELINE }

  const buckets = ['0', '0.33', '0.67']
  const votes = { keep: 0, switch: 0, abstain: 0, timeout: 0 }
  for (const d of debates) for (const k of Object.keys(votes) as (keyof typeof votes)[]) votes[k] += d.votes[k]

  return {
    days,
    trace_id: traced.length > 0 ? traceId : null,
    debates: debates.length,
    timeline,
    // With three agents the score is 0, 1/3 or 2/3, so score x 3 (rounded) picks the bucket.
    disagreement_histogram: buckets.map((bucket, index) => ({
      bucket,
      debates: debates.filter((d) => Math.round(d.disagreement * 3) === index).length,
    })),
    average_challenges: round2(average(debates.map((d) => d.challenges)) ?? 0),
    dissent_rate: round2(debates.length === 0 ? 0 : debates.filter((d) => d.dissent).length / debates.length),
    votes: (Object.keys(votes) as (keyof typeof votes)[]).map((vote) => ({ vote, count: votes[vote] })),
    evaluation: sampleEvaluation,
    approvals: approvalsOf(debates),
    sources: {
      debates:
        past.length > 0
          ? sample(`${past.length} earlier debates are sample data; ${session.length} from this session are real`)
          : computed(traced.length > 0 ? 'This debate only' : 'This session’s debates'),
      evaluation: sample('50-request benchmark results (sample until the evaluation run)'),
      approvals: past.length > 0 ? sample('Includes sample decisions from earlier debates') : computed('Guests’ approve / edit / reject decisions'),
    },
  }
}
