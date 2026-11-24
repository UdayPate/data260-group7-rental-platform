// One complete journey for a trace_id (team decision C3a): every step across services,
// with time since the start, latency and status. Problems (retries, timeouts) stand out.
import { useEffect, useState } from 'react'
import { Link } from 'react-router'
import { getTrace } from '../../api/analytics'
import { errorMessage } from '../../api/client'
import { formatDateTime } from '../../dates'
import type { StepStatus, Trace } from '../../types/analytics'
import ErrorBanner from '../ErrorBanner'
import { SourceLine } from './DashboardParts'

const STATUS_STYLE: Record<StepStatus, string> = {
  ok: 'border-status-ok text-status-ok',
  retried: 'border-status-pending text-status-pending',
  timed_out: 'border-status-error-border text-status-error',
  failed: 'border-status-error-border text-status-error',
  dead_lettered: 'border-status-error-border text-status-error',
}

// 450 -> "450 ms", 23400 -> "23.4 s", 7200000 -> "2.0 h"
function duration(ms: number): string {
  if (ms < 1000) return `${ms} ms`
  if (ms < 60 * 60 * 1000) return `${(ms / 1000).toFixed(1)} s`
  if (ms < 48 * 60 * 60 * 1000) return `${(ms / 3600000).toFixed(1)} h`
  return `${(ms / 86400000).toFixed(1)} d`
}

// The dashboards layout renders this with key={traceId}, so a new trace starts fresh.
function JourneyPanel({ traceId }: { traceId: string }) {
  const [trace, setTrace] = useState<Trace | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let ignore = false
    getTrace(traceId)
      .then((t) => {
        if (!ignore) setTrace(t)
      })
      .catch((err: unknown) => {
        if (!ignore) setError(errorMessage(err))
      })
    return () => {
      ignore = true
    }
  }, [traceId, attempt])

  if (error) {
    return (
      <ErrorBanner
        message={error}
        onRetry={() => {
          setError(null)
          setAttempt((n) => n + 1)
        }}
      />
    )
  }
  if (!trace) return <p className="text-fg-muted">Loading journey…</p>

  const start = Date.parse(trace.started)
  return (
    <section data-journey className="space-y-3 rounded-2xl border border-mustard bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-condensed text-lg font-bold tracking-[0.06em] uppercase">Journey · {trace.title}</h2>
          <p className="font-mono text-xs text-fg-muted">trace_id {trace.trace_id}</p>
          <SourceLine source={trace.source} />
        </div>
        <div className="text-right text-sm">
          <p>
            {trace.step_count} steps · total <span className="font-mono">{duration(trace.total_ms)}</span>
          </p>
          {trace.kind === 'ai' && (
            <Link to={`/ai/tasks/${trace.entity_id}`} className="font-semibold text-primary hover:underline">
              Open the debate →
            </Link>
          )}
        </div>
      </div>
      <ol className="max-h-80 space-y-1 overflow-y-auto">
        {trace.steps.map((s, i) => (
          <li key={i} data-step-status={s.status} className="grid grid-cols-[5.5rem_1fr_auto] items-start gap-3 rounded-lg px-2 py-1 text-sm odd:bg-surface-2/50">
            <span className="font-mono text-xs text-fg-muted">+{duration(Date.parse(s.timestamp) - start)}</span>
            <span>
              <span className="font-semibold">{s.event_type}</span> <span className="text-fg-muted">· {s.service}</span>
              {s.error && <span className="block text-xs text-status-error">{s.error}</span>}
            </span>
            <span className="flex items-center gap-2">
              <span className="font-mono text-xs text-fg-soft">{s.latency_ms} ms</span>
              <span className={`rounded-full border px-2 py-px text-xs font-semibold ${STATUS_STYLE[s.status]}`}>{s.status.replace('_', ' ')}</span>
            </span>
          </li>
        ))}
      </ol>
      <p className="text-xs text-fg-muted">Started {formatDateTime(trace.started)}</p>
    </section>
  )
}

export default JourneyPanel
