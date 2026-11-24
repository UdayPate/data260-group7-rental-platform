// Shared frame for the dashboards: tabs, the filter row (date range; trace_id for the admin),
// and the Journey panel when a trace_id is chosen. All filters live in the URL.
// Each role sees only its own dashboards: a guest the Guest one, a host the Host one,
// the admin Platform and AI (with journeys).
import { useEffect, useState, type FormEvent } from 'react'
import { NavLink, Outlet, useSearchParams } from 'react-router'
import { listTraces } from '../../api/analytics'
import { errorMessage } from '../../api/client'
import { useAuth } from '../../auth/useAuth'
import JourneyPanel from '../../components/dashboards/JourneyPanel'
import { DAY_OPTIONS, readDashboardFilters } from '../../dashboardFilters'
import type { TraceSummary } from '../../types/analytics'
import type { Role } from '../../types/auth'

const TABS: Record<Role, { path: string; label: string }[]> = {
  guest: [{ path: '/dashboards/guest', label: 'Guest' }],
  host: [{ path: '/dashboards/host', label: 'Host' }],
  admin: [
    { path: '/dashboards/platform', label: 'Platform' },
    { path: '/dashboards/ai', label: 'AI' },
  ],
}

function DashboardsLayout() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { days, traceId } = readDashboardFilters(searchParams)
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams)
    if (value) params.set(key, value)
    else params.delete(key)
    setSearchParams(params)
  }

  // Tab links keep the filters.
  function tabLink(path: string) {
    const query = searchParams.toString()
    return query ? `${path}?${query}` : path
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        {(user ? TABS[user.role] : []).map((tab) => (
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
        {/* Journeys (trace_id) are for the admin only */}
        {isAdmin && <TraceFilters traceId={traceId} setParam={setParam} />}
      </div>

      {isAdmin && traceId && (
        <div className="mb-6">
          <JourneyPanel key={traceId} traceId={traceId} />
        </div>
      )}

      <Outlet />
    </>
  )
}

// The admin's trace_id box, "Recent traces" list and "Clear trace".
function TraceFilters({ traceId, setParam }: { traceId: string | null; setParam: (key: string, value: string | null) => void }) {
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

  function applyTrace(event: FormEvent) {
    event.preventDefault()
    setParam('trace_id', traceText.trim() || null)
  }

  return (
    <>
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
      {tracesError && <p className="w-full text-sm text-status-error">Recent traces: {tracesError}</p>}
    </>
  )
}

export default DashboardsLayout
