// Building blocks for the dashboards: a chart card (with a table view and a source line),
// a KPI tile, and a page-level loader frame.
import { useState, type ReactNode } from 'react'
import type { Source } from '../../types/analytics'
import ErrorBanner from '../ErrorBanner'

// "computed — From bookings" or a muted SAMPLE chip (team decision C5a).
export function SourceLine({ source }: { source: Source }) {
  return (
    <p data-source={source.kind} className="flex items-center gap-2 text-xs text-fg-muted">
      {source.kind === 'sample' && (
        <span className="rounded-full border border-line-strong px-1.5 py-px font-condensed font-bold tracking-[0.08em] uppercase">Sample</span>
      )}
      {source.note}
    </p>
  )
}

type ChartCardProps = {
  title: string
  source: Source
  table: { columns: string[]; rows: (string | number)[][] } // same data as the chart
  children: ReactNode // the chart
  wide?: boolean // spans both columns
  height?: number
}

// A chart on a surface card. "View as table" shows the same numbers as a table
// (accessibility, and handy when someone asks for exact values during the demo).
export function ChartCard({ title, source, table, children, wide = false, height = 240 }: ChartCardProps) {
  const [asTable, setAsTable] = useState(false)
  return (
    <section data-chart={title} className={`space-y-3 rounded-2xl border border-line bg-surface p-4 ${wide ? 'lg:col-span-2' : ''}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-condensed text-lg font-bold tracking-[0.06em] uppercase">{title}</h2>
          <SourceLine source={source} />
        </div>
        <button
          type="button"
          onClick={() => setAsTable(!asTable)}
          aria-pressed={asTable}
          className="shrink-0 rounded-full border border-line px-3 py-1 text-xs font-semibold text-fg-muted hover:text-fg"
        >
          {asTable ? 'View as chart' : 'View as table'}
        </button>
      </div>
      {asTable ? (
        <div className="max-h-72 overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-left font-condensed text-xs tracking-[0.08em] text-fg-muted uppercase">
              <tr>
                {table.columns.map((c) => (
                  <th key={c} className="border-b border-line px-2 py-1">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {table.rows.map((row, i) => (
                <tr key={i} className="border-b border-line/50">
                  {row.map((cell, j) => (
                    <td key={j} className={`px-2 py-1 ${typeof cell === 'number' ? 'font-mono' : ''}`}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ height }}>{children}</div>
      )}
    </section>
  )
}

// One headline number (Barlow Condensed, per CLAUDE.md).
export function KpiTile({ label, value, sub, source }: { label: string; value: string; sub?: string; source?: Source }) {
  return (
    <div data-kpi={label} className="space-y-1 rounded-2xl border border-line bg-surface p-4">
      <p className="font-condensed text-xs font-bold tracking-[0.08em] text-fg-muted uppercase">{label}</p>
      <p className="font-condensed text-4xl font-bold">{value}</p>
      {sub && <p className="text-sm text-fg-soft">{sub}</p>}
      {source && <SourceLine source={source} />}
    </div>
  )
}

// Loading / error frame shared by the four dashboards.
export function DashboardFrame({ loading, error, onRetry, children }: { loading: boolean; error: string | null; onRetry: () => void; children: ReactNode }) {
  if (error) return <ErrorBanner message={error} onRetry={onRetry} />
  if (loading) return <p className="text-fg-muted">Loading dashboard…</p>
  return <>{children}</>
}
