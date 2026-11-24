// Live availability of one property over a native WebSocket (spec 13.4):
//   /properties/{property_id}/availability/stream   (Property Service)
//
// - The server pushes availability.blocked / availability.released events (team decision R2a).
// - Events for another property are dropped and logged, never shown.
// - Repeats (same idempotency_key) are dropped.
// - If the socket drops, it keeps retrying (1 s, 2 s, 4 s, then every 8 s). Each time it
//   opens, the page re-reads the calendar (R7a), so nothing missed while it was down is lost.
import { currentToken, endSession } from '../auth/session'
import { apiBaseUrls } from '../config'
import type { AvailabilityEvent } from '../types/availability'

export type LiveStatus = 'connecting' | 'live' | 'reconnecting' | 'closed'

type Options = {
  propertyId: string
  onEvent: (event: AvailabilityEvent, receivedAt: number) => void
  onOpen: () => void // every time the socket opens (first time and after a reconnect)
  onStatus: (status: LiveStatus) => void
}

const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000] // the last one repeats

// ws:// or wss:// URL of the Property Service. An empty base URL means "same server as the page".
function streamUrl(propertyId: string): string {
  const httpBase = apiBaseUrls.properties || window.location.origin
  const wsBase = httpBase.replace(/^http/, 'ws') // http -> ws, https -> wss
  const url = `${wsBase}/properties/${encodeURIComponent(propertyId)}/availability/stream`
  // Public stream, but a logged-in tab sends its token (in the URL: WebSockets can't send headers).
  const token = currentToken()
  return token ? `${url}?token=${encodeURIComponent(token)}` : url
}

// Basic shape check before we trust a message.
function looksLikeEvent(data: unknown): data is AvailabilityEvent {
  if (typeof data !== 'object' || data === null) return false
  const e = data as Record<string, unknown>
  const payload = e.payload as Record<string, unknown> | null
  return (
    (e.event_type === 'availability.blocked' || e.event_type === 'availability.released') &&
    typeof e.trace_id === 'string' &&
    typeof e.timestamp === 'string' &&
    typeof e.idempotency_key === 'string' &&
    typeof e.entity === 'object' &&
    e.entity !== null &&
    typeof payload === 'object' &&
    payload !== null &&
    typeof payload.block === 'object'
  )
}

// Opens the stream and returns a function that closes it for good.
export function openAvailabilityStream(options: Options): () => void {
  const seen = new Set<string>() // idempotency keys already handled
  let socket: WebSocket | null = null
  let attempt = 0
  let stopped = false
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  function connect() {
    options.onStatus(attempt === 0 ? 'connecting' : 'reconnecting')
    socket = new WebSocket(streamUrl(options.propertyId))

    socket.onopen = () => {
      attempt = 0
      options.onStatus('live')
      options.onOpen()
    }

    socket.onmessage = (message) => {
      const receivedAt = Date.now()
      let data: unknown
      try {
        data = JSON.parse(String(message.data))
      } catch {
        console.warn('[availability] ignored a message that is not JSON')
        return
      }
      if (!looksLikeEvent(data)) {
        console.warn('[availability] ignored a message that is not an availability event', data)
        return
      }
      if (data.entity.entity_id !== options.propertyId) {
        console.error('[availability] DROPPED an event for another property', data.entity.entity_id)
        return
      }
      if (seen.has(data.idempotency_key)) return
      seen.add(data.idempotency_key)
      options.onEvent(data, receivedAt)
    }

    socket.onclose = (event) => {
      if (stopped) return
      // 4401 = invalid or expired token: back to the login page.
      if (event.code === 4401) endSession()
      // 4000+ = the server refused (e.g. 4404 unknown property): retrying won't help.
      if (event.code >= 4000) {
        options.onStatus('closed')
        return
      }
      options.onStatus('reconnecting')
      retryTimer = setTimeout(connect, RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)])
      attempt += 1
    }
  }

  connect()

  return () => {
    stopped = true
    clearTimeout(retryTimer)
    socket?.close()
  }
}
