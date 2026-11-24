// Platform dashboard (spec section 8): events by topic, consumer lag, throughput, errors
// and retries, dead-letter messages, average workflow latency, rejected envelopes.
// With a trace_id, "events by topic" shows only that journey's events (C3a).
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { getPlatformDashboard } from '../../api/analytics'
import { errorMessage } from '../../api/client'
import { axisProps, BAR_RADIUS_RIGHT, BAR_RADIUS_UP, gridProps, legendProps, seriesColor, shortDay, tooltipProps } from '../../components/dashboards/chartTheme'
import { ChartCard, DashboardFrame, KpiTile, SourceLine } from '../../components/dashboards/DashboardParts'
import { readDashboardFilters } from '../../dashboardFilters'
import { formatDateTime } from '../../dates'
import type { PlatformDashboard } from '../../types/analytics'

function PlatformDashboardPage() {
  const [searchParams] = useSearchParams()
  const { days, traceId } = readDashboardFilters(searchParams)
  return <PlatformView key={`${days}|${traceId}`} days={days} traceId={traceId} />
}

function PlatformView({ days, traceId }: { days: number; traceId: string | null }) {
  const [data, setData] = useState<PlatformDashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let ignore = false
    getPlatformDashboard({ days, trace_id: traceId })
      .then((d) => {
        if (!ignore) setData(d)
      })
      .catch((err: unknown) => {
        if (!ignore) setError(errorMessage(err))
      })
    return () => {
      ignore = true
    }
  }, [days, traceId, attempt])

  return (
    <DashboardFrame
      loading={!data}
      error={error}
      onRetry={() => {
        setError(null)
        setAttempt((n) => n + 1)
      }}
    >
      {data && <PlatformCharts data={data} />}
    </DashboardFrame>
  )
}

const ms = (n: number) => (n < 1000 ? `${n} ms` : `${(n / 1000).toFixed(1)} s`)

function PlatformCharts({ data }: { data: PlatformDashboard }) {
  const ai = data.workflow_latency.find((w) => w.workflow.startsWith('AI'))
  const booking = data.workflow_latency.find((w) => w.workflow === 'Booking request → stored')
  // Bars per topic: one row each, so the chart grows with the number of topics.
  const topicHeight = Math.max(200, data.events_by_topic.length * 26 + 40)

  return (
    <div className="space-y-6">
      <h1 className="font-condensed text-3xl font-bold tracking-[0.06em] uppercase">Platform dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label="Dead-letter messages" value={String(data.dead_letters.length)} sub={`last ${data.days} days`} source={data.sources.dead_letters} />
        <KpiTile label="Rejected envelopes" value={String(data.rejected_envelopes)} sub="failed validation at /events/ingest" source={{ kind: 'computed', note: 'Counted by the ingest endpoint' }} />
        {booking && <KpiTile label="Booking → stored" value={ms(booking.avg_ms)} sub={`p95 ${ms(booking.p95_ms)}`} source={data.sources.latency} />}
        {ai && <KpiTile label="AI request → verdict" value={ms(ai.avg_ms)} sub={`p95 ${ms(ai.p95_ms)}`} source={data.sources.latency} />}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title={data.trace_id ? 'Events in this journey' : `Events by topic, last ${data.days} days`}
          source={data.sources.events}
          height={topicHeight}
          table={{ columns: ['Topic / event', 'Events'], rows: data.events_by_topic.map((t) => [t.topic, t.count]) }}
        >
          <ResponsiveContainer>
            <BarChart data={data.events_by_topic} layout="vertical" margin={{ top: 4, right: 16, left: 24, bottom: 0 }}>
              <CartesianGrid {...gridProps()} horizontal={false} vertical />
              <XAxis type="number" allowDecimals={false} {...axisProps()} />
              <YAxis type="category" dataKey="topic" width={170} interval={0} {...axisProps()} />
              <Tooltip {...tooltipProps()} />
              <Bar dataKey="count" name="Events" fill={seriesColor(0)} radius={BAR_RADIUS_RIGHT} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <div className="space-y-4">
          <ChartCard
            title="Consumer lag (messages)"
            source={data.sources.kafka}
            table={{ columns: ['Date', ...data.consumer_groups], rows: data.consumer_lag.map((p) => [String(p.time), ...data.consumer_groups.map((g) => Number(p[g]))]) }}
          >
            <ResponsiveContainer>
              <LineChart data={data.consumer_lag} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
                <CartesianGrid {...gridProps()} />
                <XAxis dataKey="time" tickFormatter={(d: string) => shortDay(d)} minTickGap={24} {...axisProps()} />
                <YAxis {...axisProps()} />
                <Tooltip {...tooltipProps()} labelFormatter={(d) => shortDay(String(d))} />
                <Legend {...legendProps()} />
                {data.consumer_groups.map((g, i) => (
                  <Line key={g} type="monotone" dataKey={g} stroke={seriesColor(i)} strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard
            title="Throughput (events per second)"
            source={data.sources.kafka}
            height={180}
            table={{ columns: ['Date', 'Events/s'], rows: data.throughput.map((p) => [p.time, p.events_per_sec]) }}
          >
            <ResponsiveContainer>
              <LineChart data={data.throughput} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
                <CartesianGrid {...gridProps()} />
                <XAxis dataKey="time" tickFormatter={(d: string) => shortDay(d)} minTickGap={24} {...axisProps()} />
                <YAxis {...axisProps()} />
                <Tooltip {...tooltipProps()} labelFormatter={(d) => shortDay(String(d))} />
                <Line type="monotone" dataKey="events_per_sec" name="Events/s" stroke={seriesColor(1)} strokeWidth={2} dot={false} activeDot={{ r: 5 }} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>

        <ChartCard
          title={`Errors and retries, last ${data.days} days`}
          source={data.sources.errors}
          table={{ columns: ['Service', 'Errors', 'Retries'], rows: data.errors_retries.map((e) => [e.service, e.errors, e.retries]) }}
        >
          <ResponsiveContainer>
            <BarChart data={data.errors_retries} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid {...gridProps()} />
              <XAxis dataKey="service" tickFormatter={(s: string) => s.replace('-service', '')} interval={0} {...axisProps()} />
              <YAxis allowDecimals={false} {...axisProps()} />
              <Tooltip {...tooltipProps()} />
              <Legend {...legendProps()} />
              <Bar dataKey="errors" name="Errors" fill={seriesColor(0)} radius={BAR_RADIUS_UP} maxBarSize={18} />
              <Bar dataKey="retries" name="Retries" fill={seriesColor(1)} radius={BAR_RADIUS_UP} maxBarSize={18} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Average workflow latency"
          source={data.sources.latency}
          table={{ columns: ['Workflow', 'Average (ms)', 'p95 (ms)'], rows: data.workflow_latency.map((w) => [w.workflow, w.avg_ms, w.p95_ms]) }}
        >
          <ResponsiveContainer>
            {/* Seconds on one shared axis (no second axis), so AI and booking times compare honestly */}
            <BarChart
              data={data.workflow_latency.map((w) => ({ ...w, avg_s: w.avg_ms / 1000, p95_s: w.p95_ms / 1000 }))}
              layout="vertical"
              margin={{ top: 4, right: 16, left: 24, bottom: 0 }}
            >
              <CartesianGrid {...gridProps()} horizontal={false} vertical />
              <XAxis type="number" unit=" s" {...axisProps()} />
              <YAxis type="category" dataKey="workflow" width={170} interval={0} {...axisProps()} />
              <Tooltip {...tooltipProps()} formatter={(v) => `${Number(v).toFixed(2)} s`} />
              <Legend {...legendProps()} />
              <Bar dataKey="avg_s" name="Average" fill={seriesColor(0)} radius={BAR_RADIUS_RIGHT} maxBarSize={14} />
              <Bar dataKey="p95_s" name="p95" fill={seriesColor(2)} radius={BAR_RADIUS_RIGHT} maxBarSize={14} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <section data-dead-letters className="space-y-3 rounded-2xl border border-line bg-surface p-4 lg:col-span-2">
          <div>
            <h2 className="font-condensed text-lg font-bold tracking-[0.06em] uppercase">Dead-letter messages</h2>
            <SourceLine source={data.sources.dead_letters} />
          </div>
          {data.dead_letters.length === 0 ? (
            <p className="text-sm text-fg-muted">None in this range.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left font-condensed text-xs tracking-[0.08em] text-fg-muted uppercase">
                <tr>
                  <th className="border-b border-line px-2 py-1">When</th>
                  <th className="border-b border-line px-2 py-1">Topic</th>
                  <th className="border-b border-line px-2 py-1">Reason</th>
                  <th className="border-b border-line px-2 py-1">trace_id</th>
                </tr>
              </thead>
              <tbody>
                {data.dead_letters.map((d, i) => (
                  <tr key={i} className="border-b border-line/50 align-top">
                    <td className="px-2 py-1 whitespace-nowrap">{formatDateTime(d.timestamp)}</td>
                    <td className="px-2 py-1 font-mono">{d.topic}</td>
                    <td className="px-2 py-1 text-status-error">{d.reason}</td>
                    <td className="px-2 py-1 font-mono text-xs text-fg-muted">{d.trace_id}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  )
}

export default PlatformDashboardPage
