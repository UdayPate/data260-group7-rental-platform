// Mock Analytics & Logging Service: POST /events/ingest and GET /analytics/*
import { delay, http, HttpResponse } from 'msw'
import { UI_EVENT_TYPES, type EventEnvelope } from '../../types/analytics'
import { aiDashboard, guestDashboard, hostDashboard, platformDashboard } from '../analytics/dashboards'
import { findTrace, recentTraces } from '../analytics/journeys'
import { db } from '../db'
import { errorResponse, invalidJsonResponse, MOCK_DELAY_MS, readBody } from '../responses'

// ?days= must be 7, 30 or 90 (the UI's choices); default 30.
function daysParam(url: URL): number | Response {
  const raw = url.searchParams.get('days')
  if (raw === null) return 30
  const days = Number(raw)
  return [7, 30, 90].includes(days) ? days : errorResponse('VALIDATION_ERROR', 'days must be 7, 30 or 90.')
}

const traceParam = (url: URL) => url.searchParams.get('trace_id') || null

// Checks the shared envelope (spec 6.2). Returns the problem, or null if it's valid.
function envelopeProblem(body: Record<string, unknown>): string | null {
  for (const field of ['event_type', 'trace_id', 'timestamp', 'actor_id', 'idempotency_key']) {
    if (typeof body[field] !== 'string' || body[field] === '') return `Envelope is missing ${field}.`
  }
  if (!(UI_EVENT_TYPES as readonly string[]).includes(String(body.event_type))) return `Unknown event_type ${String(body.event_type)}.`
  if (Number.isNaN(Date.parse(String(body.timestamp)))) return 'timestamp must be an ISO date-time.'
  const entity = body.entity as Record<string, unknown> | undefined
  if (!entity || typeof entity.entity_type !== 'string' || typeof entity.entity_id !== 'string') {
    return 'entity must have entity_type and entity_id.'
  }
  if (typeof body.payload !== 'object' || body.payload === null) return 'payload must be an object.'
  return null
}

export const analyticsHandlers = [
  http.post('*/events/ingest', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const problem = envelopeProblem(body)
    if (problem) {
      // A malformed message is rejected, never accepted (spec 6.2), and counted.
      db.rejectedEnvelopes.push({
        topic: String(body.event_type ?? 'unknown'),
        reason: problem,
        trace_id: String(body.trace_id ?? 'none'),
        timestamp: new Date().toISOString(),
      })
      return errorResponse('VALIDATION_ERROR', problem)
    }
    const key = String(body.idempotency_key)
    if (db.ingestKeys.has(key)) return HttpResponse.json({ accepted: true, duplicate: true })
    db.ingestKeys.add(key)
    db.uiEvents.push(body as unknown as EventEnvelope)
    return HttpResponse.json({ accepted: true, duplicate: false }, { status: 202 })
  }),

  http.get('*/analytics/guest/dashboard', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const url = new URL(request.url)
    const days = daysParam(url)
    if (days instanceof Response) return days
    const guestId = url.searchParams.get('guest_id')
    if (!guestId) return errorResponse('VALIDATION_ERROR', 'guest_id is required.')
    if (!db.guests.some((g) => g.guest_id === guestId)) return errorResponse('NOT_FOUND', `No guest found with id ${guestId}.`)
    return HttpResponse.json(guestDashboard(guestId, days))
  }),

  http.get('*/analytics/host/dashboard', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const url = new URL(request.url)
    const days = daysParam(url)
    if (days instanceof Response) return days
    const hostId = url.searchParams.get('host_id')
    if (!hostId) return errorResponse('VALIDATION_ERROR', 'host_id is required.')
    if (!db.hosts.some((h) => h.host_id === hostId)) return errorResponse('NOT_FOUND', `No host found with id ${hostId}.`)
    return HttpResponse.json(hostDashboard(hostId, days))
  }),

  http.get('*/analytics/platform/dashboard', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const url = new URL(request.url)
    const days = daysParam(url)
    if (days instanceof Response) return days
    return HttpResponse.json(platformDashboard(days, traceParam(url)))
  }),

  http.get('*/analytics/ai/dashboard', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const url = new URL(request.url)
    const days = daysParam(url)
    if (days instanceof Response) return days
    return HttpResponse.json(aiDashboard(days, traceParam(url)))
  }),

  http.get('*/analytics/traces', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const limit = Number(new URL(request.url).searchParams.get('limit') ?? 20)
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) return errorResponse('VALIDATION_ERROR', 'limit must be 1-100.')
    return HttpResponse.json({ items: recentTraces(limit) })
  }),

  http.get('*/analytics/traces/:traceId', async ({ params }) => {
    await delay(MOCK_DELAY_MS)
    const trace = findTrace(String(params.traceId))
    return trace ? HttpResponse.json(trace) : errorResponse('NOT_FOUND', `No journey found for trace_id ${String(params.traceId)}.`)
  }),

  // ---------- Spec endpoints (section 6) ----------
  http.get('*/analytics/properties/top', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const limit = Number(new URL(request.url).searchParams.get('limit') ?? 10)
    const items = db.properties
      .map((p) => {
        const paid = db.reservations.filter((r) => r.property_id === p.property_id && (r.status === 'approved' || r.status === 'completed'))
        return { property_id: p.property_id, title: p.title, city: p.city, bookings: paid.length, revenue: paid.reduce((s, r) => s + r.price_breakdown.total, 0) }
      })
      .sort((a, b) => b.bookings - a.bookings || b.revenue - a.revenue)
      .slice(0, Math.max(1, Math.min(100, limit)))
    return HttpResponse.json({ items })
  }),

  http.get('*/analytics/funnel', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const url = new URL(request.url)
    const days = daysParam(url)
    if (days instanceof Response) return days
    const hostId = url.searchParams.get('host_id')
    if (hostId && !db.hosts.some((h) => h.host_id === hostId)) return errorResponse('NOT_FOUND', `No host found with id ${hostId}.`)
    // Without host_id: add up every host's funnel.
    const hosts = hostId ? [hostId] : db.hosts.map((h) => h.host_id)
    const totals = new Map<string, number>()
    for (const h of hosts) for (const s of hostDashboard(h, days).funnel) totals.set(s.step, (totals.get(s.step) ?? 0) + s.count)
    return HttpResponse.json({ host_id: hostId, days, funnel: [...totals].map(([step, count]) => ({ step, count })) })
  }),

  http.get('*/analytics/geo', async () => {
    await delay(MOCK_DELAY_MS)
    const cities = [...new Set(db.properties.map((p) => p.city))]
    const items = cities.map((city) => {
      const ids = db.properties.filter((p) => p.city === city).map((p) => p.property_id)
      return {
        city,
        listings: ids.length,
        bookings: db.reservations.filter((r) => ids.includes(r.property_id) && (r.status === 'approved' || r.status === 'completed')).length,
      }
    })
    return HttpResponse.json({ items })
  }),
]
