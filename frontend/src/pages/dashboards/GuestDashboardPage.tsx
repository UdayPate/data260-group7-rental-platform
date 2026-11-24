// Guest dashboard (spec section 8): bookings over the range, reservation-status summary,
// saved-property activity, average match score, recommendation approvals.
// It's about the current guest, so a trace_id only adds the Journey panel above.
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { getGuestDashboard } from '../../api/analytics'
import { errorMessage } from '../../api/client'
import { axisProps, BAR_RADIUS_RIGHT, BAR_RADIUS_UP, gridProps, seriesColor, shortDay, themeColor, tooltipProps } from '../../components/dashboards/chartTheme'
import { ChartCard, DashboardFrame, KpiTile } from '../../components/dashboards/DashboardParts'
import { useCurrentUser } from '../../context/useCurrentUser'
import { readDashboardFilters } from '../../dashboardFilters'
import type { GuestDashboard } from '../../types/analytics'

// Reservation statuses use the status tokens; each bar is also labelled on the axis.
const STATUS_TOKEN: Record<string, string> = {
  pending: 'status-pending',
  approved: 'status-ok',
  completed: 'teal',
  declined: 'status-error',
  cancelled: 'status-error',
}

function GuestDashboardPage() {
  const [searchParams] = useSearchParams()
  const { guestId } = useCurrentUser()
  const { days } = readDashboardFilters(searchParams)
  return <GuestDashboardView key={`${guestId}|${days}`} guestId={guestId} days={days} />
}

function GuestDashboardView({ guestId, days }: { guestId: string; days: number }) {
  const [data, setData] = useState<GuestDashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let ignore = false
    getGuestDashboard(guestId, { days })
      .then((d) => {
        if (!ignore) setData(d)
      })
      .catch((err: unknown) => {
        if (!ignore) setError(errorMessage(err))
      })
    return () => {
      ignore = true
    }
  }, [guestId, days, attempt])

  const retry = () => {
    setError(null)
    setAttempt((n) => n + 1)
  }

  return (
    <DashboardFrame loading={!data} error={error} onRetry={retry}>
      {data && <GuestCharts data={data} />}
    </DashboardFrame>
  )
}

function GuestCharts({ data }: { data: GuestDashboard }) {
  const totalBookings = data.bookings_per_day.reduce((s, d) => s + d.count, 0)
  const totalSaves = data.saved_per_week.reduce((s, w) => s + w.saves, 0)
  const a = data.recommendation_approvals
  const approvals = [
    { category: 'Approved', count: a.approved },
    { category: 'Edited', count: a.edited },
    { category: 'Rejected', count: a.rejected },
  ]

  return (
    <div className="space-y-6">
      <h1 className="font-condensed text-3xl font-bold tracking-[0.06em] uppercase">Guest dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label={`Bookings, last ${data.days} days`} value={String(totalBookings)} source={data.sources.bookings} />
        <KpiTile label={`Saves, last ${data.days} days`} value={String(totalSaves)} source={data.sources.saved} />
        <KpiTile
          label="Average match score"
          value={data.average_match_score === null ? '—' : `${Math.round(data.average_match_score * 100)}%`}
          sub="of stays the AI recommended to you"
          source={data.sources.recommendations}
        />
        <KpiTile
          label="Recommendations"
          value={`${a.approved + a.edited}/${a.approved + a.edited + a.rejected}`}
          sub={`approved (${a.edited} with edits), ${a.rejected} rejected`}
          source={data.sources.recommendations}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title="Bookings per day"
          source={data.sources.bookings}
          wide
          table={{ columns: ['Date', 'Bookings'], rows: data.bookings_per_day.map((d) => [d.date, d.count]) }}
        >
          <ResponsiveContainer>
            <BarChart data={data.bookings_per_day} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid {...gridProps()} />
              <XAxis dataKey="date" tickFormatter={shortDay} minTickGap={24} {...axisProps()} />
              <YAxis allowDecimals={false} {...axisProps()} />
              <Tooltip {...tooltipProps()} labelFormatter={(d) => shortDay(String(d))} />
              <Bar dataKey="count" name="Bookings" fill={seriesColor(0)} radius={BAR_RADIUS_UP} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Reservation status"
          source={data.sources.bookings}
          table={{ columns: ['Status', 'Reservations'], rows: data.status_summary.map((s) => [s.status, s.count]) }}
        >
          <ResponsiveContainer>
            <BarChart data={data.status_summary} layout="vertical" margin={{ top: 4, right: 16, left: 16, bottom: 0 }}>
              <CartesianGrid {...gridProps()} horizontal={false} vertical />
              <XAxis type="number" allowDecimals={false} {...axisProps()} />
              <YAxis type="category" dataKey="status" width={80} {...axisProps()} />
              <Tooltip {...tooltipProps()} />
              <Bar dataKey="count" name="Reservations" radius={BAR_RADIUS_RIGHT} maxBarSize={22}>
                {data.status_summary.map((s) => (
                  <Cell key={s.status} fill={themeColor(STATUS_TOKEN[s.status] ?? 'teal')} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Saved stays per week"
          source={data.sources.saved}
          table={{ columns: ['Week starting', 'Saves'], rows: data.saved_per_week.map((w) => [w.week_start, w.saves]) }}
        >
          <ResponsiveContainer>
            <LineChart data={data.saved_per_week} margin={{ top: 8, right: 16, left: -20, bottom: 0 }}>
              <CartesianGrid {...gridProps()} />
              <XAxis dataKey="week_start" tickFormatter={shortDay} {...axisProps()} />
              <YAxis allowDecimals={false} {...axisProps()} />
              <Tooltip {...tooltipProps()} labelFormatter={(d) => `Week of ${shortDay(String(d))}`} />
              <Line type="monotone" dataKey="saves" name="Saves" stroke={seriesColor(1)} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Recommendation decisions"
          source={data.sources.recommendations}
          wide
          height={180}
          table={{ columns: ['Decision', 'Recommendations'], rows: approvals.map((x) => [x.category, x.count]) }}
        >
          <ResponsiveContainer>
            <BarChart data={approvals} layout="vertical" margin={{ top: 4, right: 16, left: 16, bottom: 0 }}>
              <CartesianGrid {...gridProps()} horizontal={false} vertical />
              <XAxis type="number" allowDecimals={false} {...axisProps()} />
              <YAxis type="category" dataKey="category" width={80} {...axisProps()} />
              <Tooltip {...tooltipProps()} />
              <Bar dataKey="count" name="Recommendations" fill={seriesColor(0)} radius={BAR_RADIUS_RIGHT} maxBarSize={22} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  )
}

export default GuestDashboardPage
