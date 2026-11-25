// AI dashboard (spec section 8): agent publication timeline, disagreement size, challenge
// count, votes, dissent rate, precision@10, recall@10, human approval categories.
// With the trace_id of a debate, everything narrows to that debate (C3a).
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Scatter, ScatterChart, Tooltip, XAxis, YAxis, ZAxis } from 'recharts'
import { AGENT_LABELS } from '../../agents'
import { getAiDashboard } from '../../api/analytics'
import { errorMessage } from '../../api/client'
import { axisProps, BAR_RADIUS_RIGHT, BAR_RADIUS_UP, gridProps, legendProps, seriesColor, themeColor, tooltipProps } from '../../components/dashboards/chartTheme'
import { ChartCard, DashboardFrame, KpiTile } from '../../components/dashboards/DashboardParts'
import VersionsPanel from '../../components/dashboards/VersionsPanel'
import { readDashboardFilters } from '../../dashboardFilters'
import { AGENTS, type AgentId } from '../../types/ai'
import type { AiDashboard } from '../../types/analytics'

function AiDashboardPage() {
  const [searchParams] = useSearchParams()
  const { days, traceId } = readDashboardFilters(searchParams)
  return <AiView key={`${days}|${traceId}`} days={days} traceId={traceId} />
}

function AiView({ days, traceId }: { days: number; traceId: string | null }) {
  const [data, setData] = useState<AiDashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let ignore = false
    getAiDashboard({ days, trace_id: traceId })
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
      {data && <AiCharts data={data} />}
    </DashboardFrame>
  )
}

const PROBLEM_EVENTS = ['agent.timed_out', 'agent.output_rejected']

function AiCharts({ data }: { data: AiDashboard }) {
  const a = data.approvals
  const decided = a.approved + a.edited + a.rejected
  const approvals = [
    { category: 'Approved as-is', count: a.approved },
    { category: 'Edited', count: a.edited },
    { category: 'Rejected', count: a.rejected },
  ]

  // Timeline rows: one per agent that appears, in the standard agent order.
  const points = (data.timeline?.points ?? []).map((p) => ({
    ...p,
    seconds: Math.round(p.offset_ms / 100) / 10,
    row: AGENT_LABELS[p.agent as AgentId] ?? p.agent,
  }))
  const agentsShown = AGENTS.filter((agent) => points.some((p) => p.agent === agent))
  const rows = agentsShown.map((agent) => AGENT_LABELS[agent])
  const problems = points.filter((p) => PROBLEM_EVENTS.includes(p.event_type))

  return (
    <div className="space-y-6">
      <h1 className="cornice font-display text-3xl font-bold">AI dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label={data.trace_id ? 'Debate' : `Debates, last ${data.days} days`} value={String(data.debates)} source={data.sources.debates} />
        <KpiTile label="Challenges per debate" value={data.average_challenges.toFixed(1)} sub="the Fairness Auditor is always challenged" source={data.sources.debates} />
        <KpiTile label="Dissent rate" value={`${Math.round(data.dissent_rate * 100)}%`} sub="debates whose result has a dissent note" source={data.sources.debates} />
        <KpiTile
          label="Human approval"
          value={decided === 0 ? '—' : `${Math.round(((a.approved + a.edited) / decided) * 100)}%`}
          sub={`${a.approved} as-is, ${a.edited} edited, ${a.rejected} rejected`}
          source={data.sources.approvals}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title={problems.length > 0 ? "Agent publication timeline (× = timeout or rejected output)" : "Agent publication timeline"}
          source={data.timeline?.trace_id === 'sample' ? { kind: 'sample', note: 'A typical debate (run one to see a real one)' } : { kind: 'computed', note: `Debate ${data.timeline?.task_id ?? ''}: “${data.timeline?.request_text ?? ''}”` }}
          wide
          height={Math.max(200, rows.length * 44 + 60)}
          table={{ columns: ['Seconds', 'Agent', 'Event', 'Round'], rows: points.map((p) => [p.seconds, p.row, p.event_type, p.round ?? '—']) }}
        >
          <ResponsiveContainer>
            <ScatterChart margin={{ top: 8, right: 24, left: 24, bottom: 0 }}>
              <CartesianGrid {...gridProps()} horizontal vertical={false} />
              <XAxis type="number" dataKey="seconds" name="Time" unit=" s" {...axisProps()} />
              {/* Each agent is a labelled row (so identity never relies on color, P1a); "reversed" puts the parser on top */}
              <YAxis type="category" dataKey="row" name="Agent" ticks={rows} width={170} allowDuplicatedCategory={false} reversed {...axisProps()} />
              <ZAxis range={[70, 70]} />
              <Tooltip {...tooltipProps()} />
              {agentsShown.map((agent) => (
                <Scatter
                  key={agent}
                  name={AGENT_LABELS[agent]}
                  data={points.filter((p) => p.agent === agent && !PROBLEM_EVENTS.includes(p.event_type))}
                  fill={themeColor(`agent-${agent}`)}
                />
              ))}
              {problems.length > 0 && <Scatter name="Timeout / rejected output" data={problems} fill={themeColor('status-error')} shape="cross" />}
            </ScatterChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Disagreement size"
          source={data.sources.debates}
          table={{ columns: ['Disagreement score', 'Debates'], rows: data.disagreement_histogram.map((b) => [b.bucket, b.debates]) }}
        >
          <ResponsiveContainer>
            <BarChart data={data.disagreement_histogram} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid {...gridProps()} />
              <XAxis dataKey="bucket" {...axisProps()} />
              <YAxis allowDecimals={false} {...axisProps()} />
              <Tooltip {...tooltipProps()} labelFormatter={(b) => `Disagreement ${String(b)}`} />
              <Bar dataKey="debates" name="Debates" fill={seriesColor(0)} radius={BAR_RADIUS_UP} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Round 2 votes"
          source={data.sources.debates}
          table={{ columns: ['Vote', 'Count'], rows: data.votes.map((v) => [v.vote, v.count]) }}
        >
          <ResponsiveContainer>
            <BarChart data={data.votes} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid {...gridProps()} />
              <XAxis dataKey="vote" {...axisProps()} />
              <YAxis allowDecimals={false} {...axisProps()} />
              <Tooltip {...tooltipProps()} />
              <Bar dataKey="count" name="Votes" fill={seriesColor(1)} radius={BAR_RADIUS_UP} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Precision@10 and recall@10"
          source={data.sources.evaluation}
          wide
          height={260}
          table={{
            columns: ['Configuration', 'Precision@10', 'Recall@10', 'Mean rank of top pick'],
            rows: data.evaluation.map((e) => [e.configuration, e.precision_at_10, e.recall_at_10, e.mean_rank]),
          }}
        >
          <ResponsiveContainer>
            <BarChart data={data.evaluation} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid {...gridProps()} />
              <XAxis dataKey="configuration" interval={0} tick={{ ...axisProps().tick, fontSize: 11 }} axisLine={axisProps().axisLine} tickLine={false} />
              <YAxis domain={[0, 1]} {...axisProps()} />
              <Tooltip {...tooltipProps()} />
              <Legend {...legendProps()} />
              <Bar dataKey="precision_at_10" name="Precision@10" fill={seriesColor(0)} radius={BAR_RADIUS_UP} maxBarSize={28} />
              <Bar dataKey="recall_at_10" name="Recall@10" fill={seriesColor(1)} radius={BAR_RADIUS_UP} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Mean rank can't share the 0-1 axis above, so it gets its own chart (spec 7.3.1). */}
        <ChartCard
          title="Mean rank of the human top choice (lower is better)"
          source={data.sources.evaluation}
          wide
          height={220}
          table={{ columns: ['Configuration', 'Mean rank'], rows: data.evaluation.map((e) => [e.configuration, e.mean_rank]) }}
        >
          <ResponsiveContainer>
            <BarChart data={data.evaluation} layout="vertical" margin={{ top: 4, right: 40, left: 24, bottom: 0 }}>
              <CartesianGrid {...gridProps()} horizontal={false} vertical />
              <XAxis type="number" domain={[0, 'dataMax']} {...axisProps()} />
              <YAxis type="category" dataKey="configuration" width={190} {...axisProps()} />
              <Tooltip {...tooltipProps()} />
              <Bar dataKey="mean_rank" name="Mean rank" fill={seriesColor(2)} radius={BAR_RADIUS_RIGHT} maxBarSize={20}>
                <LabelList dataKey="mean_rank" position="right" fill={themeColor('fg-soft')} fontSize={12} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Human approval categories"
          source={data.sources.approvals}
          wide
          height={180}
          table={{ columns: ['Decision', 'Recommendations'], rows: approvals.map((x) => [x.category, x.count]) }}
        >
          <ResponsiveContainer>
            <BarChart data={approvals} layout="vertical" margin={{ top: 4, right: 16, left: 24, bottom: 0 }}>
              <CartesianGrid {...gridProps()} horizontal={false} vertical />
              <XAxis type="number" allowDecimals={false} {...axisProps()} />
              <YAxis type="category" dataKey="category" width={110} {...axisProps()} />
              <Tooltip {...tooltipProps()} />
              <Bar dataKey="count" name="Recommendations" fill={seriesColor(0)} radius={BAR_RADIUS_RIGHT} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <VersionsPanel />
    </div>
  )
}

export default AiDashboardPage
