// Shared frame for the four dashboards: tabs, the filter row (date range + trace_id),
// and the Journey panel when a trace_id is chosen. All filters live in the URL.
import { useEffect, useState, type FormEvent } from 'react'
import { NavLink, Outlet, useLocation, useSearchParams } from 'react-router'
import { listTraces } from '../../api/analytics'
import { errorMessage } from '../../api/client'
import JourneyPanel from '../../components/dashboards/JourneyPanel'
import { DAY_OPTIONS, readDashboardFilters } from '../../dashboardFilters'
import { isHostPath } from '../../mode'
import type { TraceSummary } from '../../types/analytics'

const tabs = [
  { path: '/dashboards/guest', label: 'Guest' },
  { path: '/dashboards/host', label: 'Host' },
  { path: '/dashboards/platform', label: 'Platform' },
  { path: '/dashboards/ai', label: 'AI' },
]

function DashboardsLayout() {
  const { pathname, search } = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const { days, traceId } = readDashboardFilters(searchParams)
  const hostMode = isHostPath(pathname, search)

  const [traceText, setTraceText] = useState(traceId ?? '')
  const [traces, setTraces] = useState<TraceSummary[]>([])
  const [tracesError, setTracesError] = useState<string | null>(null)

  // The "Recent traces" list, loaded once.
  useEffect(() => {
    let ignore = false
    listTraces(20)
      .then((r) => {
        if (!ignore) setTraces(r.items)
      })
      .catch((err: unknown) => {
        if (!ignore) setTracesError(errorMessage(err))
      })
    return () => {
      ignore = true
    }
  }, [])

  // Tab links keep the filters; Platform/AI also keep host mode (?as=host).
  function tabLink(path: string) {
    const params = new URLSearchParams(searchParams)
    params.delete('as')
    const neutral = path === '/dashboards/platform' || path === '/dashboards/ai'
    if (neutral && hostMode) params.set('as', 'host')
    const query = params.toString()
    return query ? `${path}?${query}` : path
  }

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams)
    if (value) params.set(key, value)
    else params.delete(key)
    setSearchParams(params)
  }

  function applyTrace(event: FormEvent) {
    event.preventDefault()
    setParam('trace_id', traceText.trim() || null)
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <NavLink
            key={tab.path}
            to={tabLink(tab.path)}
            className={({ isActive }) =>
              `rounded-full border px-4 py-1 font-semibold ${
                isActive ? 'border-mustard-border bg-mustard text-bg' : 'border-line text-fg-muted hover:text-fg'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </div>

      {/* ---------- Filter row: one row above the charts ---------- */}
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-surface p-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="font-condensed text-xs font-bold tracking-[0.08em] text-fg-muted uppercase">Range</span>
          <select
            value={days}
            onChange={(e) => setParam('days', e.target.value === '30' ? null : e.target.value)}
            className="rounded-full border border-line bg-surface-2 px-3 py-1.5 text-fg"
          >
            {DAY_OPTIONS.map((d) => (
              <option key={d} value={d}>
                Last {d} days
              </option>
            ))}
          </select>
        </label>

        <form onSubmit={applyTrace} className="flex flex-1 items-center gap-2">
          <span className="font-condensed text-xs font-bold tracking-[0.08em] text-fg-muted uppercase">trace_id</span>
          <input
            value={traceText}
            onChange={(e) => setTraceText(e.target.value)}
            aria-label="Filter by trace_id"
            placeholder="Paste a trace_id"
            className="min-w-0 flex-1 rounded-full border border-line bg-surface-2 px-3 py-1.5 font-mono text-sm text-fg placeholder:font-sans placeholder:text-fg-muted"
          />
          <button type="submit" className="rounded-full bg-primary px-4 py-1.5 text-sm font-semibold text-on-primary">
            Show journey
          </button>
        </form>

        <select
          value=""
          onChange={(e) => {
            setTraceText(e.target.value)
            setParam('trace_id', e.target.value)
          }}
          aria-label="Recent traces"
          className="max-w-72 rounded-full border border-line bg-surface-2 px-3 py-1.5 text-sm text-fg"
        >
          <option value="">{tracesError ? 'Couldn’t load recent traces' : 'Recent traces…'}</option>
          {traces.map((t) => (
            <option key={t.trace_id} value={t.trace_id}>
              {t.title}
              {t.has_problem ? ' (has a retry or timeout)' : ''}
            </option>
          ))}
        </select>

        {traceId && (
          <button
            type="button"
            onClick={() => {
              setTraceText('')
              setParam('trace_id', null)
            }}
            className="text-sm font-semibold text-fg-muted hover:text-fg"
          >
            Clear trace
          </button>
        )}
      </div>
      {tracesError && <p className="-mt-4 mb-4 text-sm text-status-error">Recent traces: {tracesError}</p>}

      {traceId && (
        <div className="mb-6">
          <JourneyPanel key={traceId} traceId={traceId} />
        </div>
      )}

      <Outlet />
    </>
  )
}

export default DashboardsLayout
