// Analytics & Logging Service: POST /events/ingest and GET /analytics/*
import { apiBaseUrls } from '../config'
import type {
  AiDashboard,
  EventEnvelope,
  FunnelResponse,
  GeoRow,
  GuestDashboard,
  HostDashboard,
  IngestResponse,
  PlatformDashboard,
  TopProperty,
  Trace,
  TraceSummary,
  UiEventType,
} from '../types/analytics'
import type { ListResponse } from '../types/api'
import { get, post } from './client'

const base = apiBaseUrls.analytics

// "?days=30&trace_id=..." from an object, leaving out empty values.
function query(params: Record<string, string | number | null | undefined>): string {
  const q = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined && value !== '') q.set(key, String(value))
  }
  const text = q.toString()
  return text ? `?${text}` : ''
}

type Filters = { days: number; trace_id?: string | null }

export const getGuestDashboard = (guestId: string, f: Filters) =>
  get<GuestDashboard>(base, `/analytics/guest/dashboard${query({ guest_id: guestId, ...f })}`)
export const getHostDashboard = (hostId: string, f: Filters) =>
  get<HostDashboard>(base, `/analytics/host/dashboard${query({ host_id: hostId, ...f })}`)
export const getPlatformDashboard = (f: Filters) => get<PlatformDashboard>(base, `/analytics/platform/dashboard${query(f)}`)
export const getAiDashboard = (f: Filters) => get<AiDashboard>(base, `/analytics/ai/dashboard${query(f)}`)
export const listTraces = (limit = 20) => get<ListResponse<TraceSummary>>(base, `/analytics/traces${query({ limit })}`)
export const getTrace = (traceId: string) => get<Trace>(base, `/analytics/traces/${encodeURIComponent(traceId)}`)

// Spec endpoints (section 6); the dashboards above already include this data.
export const getTopProperties = (limit = 10) => get<ListResponse<TopProperty>>(base, `/analytics/properties/top${query({ limit })}`)
export const getFunnel = (f: Filters & { host_id?: string }) => get<FunnelResponse>(base, `/analytics/funnel${query(f)}`)
export const getGeo = () => get<ListResponse<GeoRow>>(base, '/analytics/geo')

export const ingestEvent = (envelope: EventEnvelope) => post<IngestResponse>(base, '/events/ingest', envelope)

// Fire-and-forget UI event in the shared envelope (team decision C4a).
// A failure is only logged to the console: a guest shouldn't see analytics errors.
export function trackEvent(eventType: UiEventType, actorId: string, entity: EventEnvelope['entity'], payload: Record<string, unknown> = {}) {
  const envelope: EventEnvelope = {
    event_type: eventType,
    trace_id: crypto.randomUUID(), // a UI event starts its own small journey
    timestamp: new Date().toISOString(),
    actor_id: actorId,
    entity,
    payload,
    idempotency_key: crypto.randomUUID(),
  }
  ingestEvent(envelope).catch((err: unknown) => console.warn('[analytics] event not recorded:', eventType, err))
}
