// Journeys (trace_id -> every workflow step), for GET /analytics/traces and the Journey panel.
//  - Booking journeys are rebuilt from the reservation record: the steps follow the
//    contract's booking flow, the latencies are sample values (labelled as such).
//  - AI journeys are the debate's real stream events, so they're "computed".
import type { Source, Trace, TraceStep, TraceSummary } from '../../types/analytics'
import type { Reservation } from '../../types/reservation'
import { allTaskEntries } from '../ai/bus'
import { db } from '../db'

// A small repeatable number from a string (same reservation -> same sample latencies).
function hash(text: string): number {
  let h = 0
  for (const ch of text) h = (h * 31 + ch.charCodeAt(0)) % 9973
  return h
}

const addMs = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString()
const HOUR = 60 * 60 * 1000

// The one booking whose consumer fails once and retries, to show retries in the demo.
const RETRY_DEMO_RESERVATION = 'r_002'

function bookingSteps(r: Reservation): TraceStep[] {
  const steps: TraceStep[] = []
  const jitter = hash(r.reservation_id)
  let time = r.booking_datetime
  const add = (service: string, eventType: string, latency: number, status: TraceStep['status'] = 'ok', error: string | null = null, gapMs = 0) => {
    time = addMs(time, gapMs + latency)
    steps.push({ trace_id: r.trace_id, event_type: eventType, service, timestamp: time, latency_ms: latency, status, error })
  }

  add('booking-service', 'POST /bookings/request', 30 + (jitter % 25))
  add('kafka', 'booking.requested', 4 + (jitter % 6))
  if (r.reservation_id === RETRY_DEMO_RESERVATION) {
    add('booking-worker', 'booking.requested consumed', 2000, 'retried', 'MySQL deadlock on availability row; retrying after 2 s backoff')
  }
  add('booking-worker', 'booking.requested consumed → MySQL write', 35 + (jitter % 30))
  add('property-service', 'availability.blocked (WebSocket push to viewers)', 8 + (jitter % 9))

  // Later steps happen hours or days after the request (the host's decision, check-out, a review).
  if (r.status === 'approved' || r.status === 'completed') {
    add('booking-service', 'POST /bookings/approve', 25 + (jitter % 20), 'ok', null, (2 + (jitter % 10)) * HOUR)
    add('kafka', 'booking.approved', 5)
    add('booking-worker', 'booking.approved consumed → MySQL update', 30 + (jitter % 20))
  }
  if (r.status === 'declined' || r.status === 'cancelled') {
    const type = r.status === 'declined' ? 'booking.declined' : 'booking.cancelled'
    add('booking-service', `POST /bookings/${r.status === 'declined' ? 'decline' : 'cancel'}`, 28, 'ok', null, (3 + (jitter % 20)) * HOUR)
    add('kafka', type, 5)
    add('booking-worker', `${type} consumed → dates released`, 33)
    add('property-service', 'availability.released (WebSocket push to viewers)', 9)
  }
  if (r.status === 'completed') {
    time = `${r.check_out}T10:00:00.000Z`
    add('booking-service', 'booking.completed (daily job)', 12)
    const review = db.reviews.find((v) => v.reservation_id === r.reservation_id)
    if (review) {
      time = review.created_datetime
      add('review-service', 'review.created', 22)
    }
  }
  return steps
}

function aiSteps(entryIndex: number): { steps: TraceStep[]; trace_id: string; task_id: string; title: string; started: string } {
  const entry = allTaskEntries()[entryIndex]
  let previous = entry.task.created_datetime
  const steps = entry.events.map((e) => {
    const latency = Math.max(0, Date.parse(e.timestamp) - Date.parse(previous))
    previous = e.timestamp
    const status: TraceStep['status'] =
      e.event_type === 'agent.output_rejected' ? 'retried' : e.event_type === 'agent.timed_out' ? 'timed_out' : 'ok'
    const error =
      e.event_type === 'agent.output_rejected' || e.event_type === 'agent.timed_out' ? (e.payload as { reason: string }).reason : null
    return {
      trace_id: e.trace_id,
      event_type: e.event_type,
      service: e.actor_id === 'harness' ? 'ai-service (harness)' : `ai-service (${e.actor_id})`,
      timestamp: e.timestamp,
      latency_ms: latency,
      status,
      error,
    }
  })
  return { steps, trace_id: entry.task.trace_id, task_id: entry.task.task_id, title: `AI debate ${entry.task.task_id} · “${entry.task.request_text.slice(0, 40)}…”`, started: entry.task.created_datetime }
}

const BOOKING_SOURCE: Source = { kind: 'sample', note: 'Steps rebuilt from the booking record; latencies are sample values' }
const AI_SOURCE: Source = { kind: 'computed', note: 'The debate’s own stream events' }

function summarize(kind: 'booking' | 'ai', entityId: string, traceId: string, title: string, started: string, steps: TraceStep[]): TraceSummary {
  const last = steps[steps.length - 1]
  return {
    trace_id: traceId,
    kind,
    entity_id: entityId,
    title,
    started,
    total_ms: last ? Date.parse(last.timestamp) - Date.parse(started) : 0,
    step_count: steps.length,
    has_problem: steps.some((s) => s.status !== 'ok'),
  }
}

function bookingTitle(r: Reservation) {
  const title = db.properties.find((p) => p.property_id === r.property_id)?.title ?? r.property_id
  return `Booking ${r.reservation_id} · ${title}`
}

// Newest first: this session's AI debates, then recent bookings.
export function recentTraces(limit: number): TraceSummary[] {
  const ai = allTaskEntries().map((_, i) => {
    const t = aiSteps(i)
    return summarize('ai', t.task_id, t.trace_id, t.title, t.started, t.steps)
  })
  const bookings = [...db.reservations]
    .sort((a, b) => b.booking_datetime.localeCompare(a.booking_datetime))
    .slice(0, limit)
    .map((r) => summarize('booking', r.reservation_id, r.trace_id, bookingTitle(r), r.booking_datetime, bookingSteps(r)))
  return [...ai.reverse(), ...bookings].slice(0, limit)
}

export function findTrace(traceId: string): Trace | null {
  const aiIndex = allTaskEntries().findIndex((e) => e.task.trace_id === traceId)
  if (aiIndex !== -1) {
    const t = aiSteps(aiIndex)
    return { ...summarize('ai', t.task_id, t.trace_id, t.title, t.started, t.steps), steps: t.steps, source: AI_SOURCE }
  }
  const r = db.reservations.find((x) => x.trace_id === traceId)
  if (!r) return null
  const steps = bookingSteps(r)
  return { ...summarize('booking', r.reservation_id, r.trace_id, bookingTitle(r), r.booking_datetime, steps), steps, source: BOOKING_SOURCE }
}
