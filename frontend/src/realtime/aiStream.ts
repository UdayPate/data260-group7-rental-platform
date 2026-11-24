// Live debate stream over a native WebSocket: /ai/tasks/{task_id}/stream?after_seq=N
//
// - after_seq: the server first replays every event after N, then sends new ones live,
//   so after a reconnect nothing is missed (team decision A3a).
// - trace isolation (spec 13.11): every event must carry OUR trace_id and task_id.
//   Anything else is dropped and logged, never shown.
// - duplicates (seq we already have) are dropped.
// - each event's receive time is logged next to its server timestamp, to measure
//   WebSocket delivery latency (spec section 9).
import { currentToken, endSession } from '../auth/session'
import { apiBaseUrls } from '../config'
import type { StreamEvent } from '../types/ai'

export type StreamStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

type Options = {
  taskId: string
  traceId: string
  afterSeq: number // the last seq we already have (0 = none)
  onEvent: (event: StreamEvent, receivedAt: number) => void
  onStatus: (status: StreamStatus) => void
  onForeignEvent?: (event: unknown) => void // an event for another trace (should never happen)
}

const RETRY_DELAYS_MS = [1000, 2000, 4000, 8000] // then give up

// ws:// or wss:// URL of the AI service. An empty base URL means "same server as the page".
function streamUrl(taskId: string, afterSeq: number): string {
  const httpBase = apiBaseUrls.ai || window.location.origin
  const wsBase = httpBase.replace(/^http/, 'ws') // http -> ws, https -> wss
  // Browsers can't send headers on a WebSocket, so the login token goes in the URL.
  const token = encodeURIComponent(currentToken() ?? '')
  return `${wsBase}/ai/tasks/${encodeURIComponent(taskId)}/stream?after_seq=${afterSeq}&token=${token}`
}

// Basic shape check before we trust a message.
function looksLikeEvent(data: unknown): data is StreamEvent {
  if (typeof data !== 'object' || data === null) return false
  const e = data as Record<string, unknown>
  return (
    typeof e.event_type === 'string' &&
    typeof e.trace_id === 'string' &&
    typeof e.seq === 'number' &&
    typeof e.entity === 'object' &&
    e.entity !== null
  )
}

// Opens the stream and returns a function that closes it for good.
export function openAiStream(options: Options): () => void {
  let lastSeq = options.afterSeq
  let socket: WebSocket | null = null
  let attempt = 0
  let stopped = false
  let retryTimer: ReturnType<typeof setTimeout> | undefined

  function connect() {
    options.onStatus(attempt === 0 ? 'connecting' : 'reconnecting')
    socket = new WebSocket(streamUrl(options.taskId, lastSeq))

    socket.onopen = () => {
      attempt = 0
      options.onStatus('open')
    }

    socket.onmessage = (message) => {
      const receivedAt = Date.now()
      let data: unknown
      try {
        data = JSON.parse(String(message.data))
      } catch {
        console.warn('[ai-stream] ignored a message that is not JSON')
        return
      }
      if (!looksLikeEvent(data)) {
        console.warn('[ai-stream] ignored a message that is not a stream event', data)
        return
      }
      // Trace isolation: drop anything that belongs to another debate.
      if (data.trace_id !== options.traceId || data.entity.entity_id !== options.taskId) {
        console.error('[ai-stream] DROPPED event from another trace', {
          expected: options.traceId,
          got: data.trace_id,
          event_type: data.event_type,
        })
        options.onForeignEvent?.(data)
        return
      }
      if (data.seq <= lastSeq) return // duplicate (e.g. replayed after a reconnect)
      lastSeq = data.seq

      const latencyMs = receivedAt - Date.parse(data.timestamp)
      console.log(
        `[ai-stream] ${data.trace_id} #${data.seq} ${data.event_type} (${data.actor_id}) ` +
          `sent ${data.timestamp}, received ${new Date(receivedAt).toISOString()}, latency ${latencyMs} ms`,
      )
      options.onEvent(data, receivedAt)
    }

    socket.onclose = (event) => {
      if (stopped) return
      // 4401 = missing, invalid or expired token: back to the login page.
      if (event.code === 4401) endSession()
      // 1000 = the server finished the stream on purpose (debate over);
      // 4000+ = the server refused it (e.g. 4404 unknown task). Don't retry those.
      if (event.code === 1000 || event.code >= 4000 || attempt >= RETRY_DELAYS_MS.length) {
        options.onStatus('closed')
        return
      }
      options.onStatus('reconnecting')
      retryTimer = setTimeout(connect, RETRY_DELAYS_MS[attempt])
      attempt += 1
    }
  }

  connect()

  return () => {
    stopped = true
    clearTimeout(retryTimer)
    socket?.close()
    options.onStatus('closed')
  }
}
