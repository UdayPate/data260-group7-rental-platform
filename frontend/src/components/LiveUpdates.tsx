// Live availability on the property page (spec 13.4):
//  - LiveStatusPill: is the WebSocket connected?
//  - LiveUpdatesLog: every update received, with its measured notification latency (R6a).
import { clockTime, formatDate } from '../dates'
import { AVAILABILITY_REASON_TEXT } from '../labels'
import type { LiveStatus } from '../realtime/availabilityStream'
import { notificationLatencyMs, type LiveUpdate } from '../realtime/useAvailabilityStream'

const STATUS: Record<LiveStatus, { text: string; style: string }> = {
  connecting: { text: 'Connecting…', style: 'border-line-strong text-fg-muted' },
  live: { text: 'Live', style: 'border-status-ok text-status-ok' },
  reconnecting: { text: 'Reconnecting…', style: 'border-status-pending text-status-pending' },
  closed: { text: 'Live updates off', style: 'border-status-error-border text-status-error' },
}

export function LiveStatusPill({ status }: { status: LiveStatus }) {
  const { text, style } = STATUS[status]
  return (
    <span data-live-status={status} className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-0.5 text-xs font-semibold ${style}`}>
      <span className="h-2 w-2 rounded-full bg-current" aria-hidden="true" />
      {text}
    </span>
  )
}

export function LiveUpdatesLog({ updates }: { updates: LiveUpdate[] }) {
  const latencies = updates.map(notificationLatencyMs).filter((ms): ms is number => ms !== null)
  const average = latencies.length > 0 ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length) : null

  return (
    <details data-live-log className="rounded-2xl border border-line bg-surface p-4 text-sm">
      <summary className="cursor-pointer font-semibold text-fg-soft">
        Live updates ({updates.length})
        {average !== null && <span className="font-normal text-fg-muted"> · average notification latency {average} ms</span>}
      </summary>
      {updates.length === 0 ? (
        <p className="mt-3 text-fg-muted">Nothing yet. Changes made by other guests or the host will appear here.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left">
            <thead className="font-condensed text-xs tracking-[0.08em] text-fg-muted uppercase">
              <tr>
                <th className="py-1 pr-3">Changed at</th>
                <th className="py-1 pr-3">What</th>
                <th className="py-1 pr-3">trace_id</th>
                <th className="py-1 pr-3 text-right">Delivery</th>
                <th className="py-1 pr-3 text-right">Page</th>
                <th className="py-1 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {updates.map((u) => {
                const sent = Date.parse(u.event.timestamp)
                const block = u.event.payload.block
                return (
                  <tr key={u.event.idempotency_key} className="border-t border-line">
                    <td className="py-1.5 pr-3 font-mono text-xs">{clockTime(sent)}</td>
                    <td className="py-1.5 pr-3 text-fg-soft">
                      {AVAILABILITY_REASON_TEXT[u.event.payload.reason]} {formatDate(block.start_date)} → {formatDate(block.end_date)}
                    </td>
                    <td className="py-1.5 pr-3 font-mono text-xs text-fg-muted" title={u.event.trace_id}>
                      {u.event.trace_id.slice(0, 8)}…
                    </td>
                    <td className="py-1.5 pr-3 text-right font-mono text-xs">{u.receivedAt - sent} ms</td>
                    <td className="py-1.5 pr-3 text-right font-mono text-xs">{u.shownAt === null ? '…' : `${u.shownAt - u.receivedAt} ms`}</td>
                    <td data-latency className="py-1.5 text-right font-mono text-xs font-semibold">
                      {u.shownAt === null ? '…' : `${notificationLatencyMs(u)} ms`}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-fg-muted">
            Delivery = the service’s timestamp to this tab receiving it; Page = receiving it to the calendar showing it.
          </p>
        </div>
      )}
    </details>
  )
}
