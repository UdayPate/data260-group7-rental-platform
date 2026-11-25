// Host dashboard (spec section 8): views-to-booking funnel, occupancy, average nightly
// price, revenue trend, cancellations, rating trend, response time.
// It's about the current host, so a trace_id only adds the Journey panel above.
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router'
import { Bar, BarChart, CartesianGrid, LabelList, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { getHostDashboard } from '../../api/analytics'
import { errorMessage } from '../../api/client'
import { axisProps, BAR_RADIUS_RIGHT, BAR_RADIUS_UP, gridProps, seriesColor, shortMonth, themeColor, tooltipProps } from '../../components/dashboards/chartTheme'
import { ChartCard, DashboardFrame, KpiTile } from '../../components/dashboards/DashboardParts'
import { useCurrentUser } from '../../context/useCurrentUser'
import { readDashboardFilters } from '../../dashboardFilters'
import { formatPrice } from '../../labels'
import type { HostDashboard } from '../../types/analytics'

const STEP_LABELS = { views: 'Views', saves: 'Saves', requests: 'Booking requests', approved: 'Approved' }

function HostDashboardPage() {
  const [searchParams] = useSearchParams()
  const { hostId } = useCurrentUser()
  const { days } = readDashboardFilters(searchParams)
  return <HostDashboardView key={`${hostId}|${days}`} hostId={hostId} days={days} />
}

function HostDashboardView({ hostId, days }: { hostId: string; days: number }) {
  const [data, setData] = useState<HostDashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let ignore = false
    getHostDashboard(hostId, { days })
      .then((d) => {
        if (!ignore) setData(d)
      })
      .catch((err: unknown) => {
        if (!ignore) setError(errorMessage(err))
      })
    return () => {
      ignore = true
    }
  }, [hostId, days, attempt])

  return (
    <DashboardFrame
      loading={!data}
      error={error}
      onRetry={() => {
        setError(null)
        setAttempt((n) => n + 1)
      }}
    >
      {data && <HostCharts data={data} />}
    </DashboardFrame>
  )
}

function HostCharts({ data }: { data: HostDashboard }) {
  const views = data.funnel[0]?.count || 1
  // Each funnel step with the share of views it keeps, e.g. "12%".
  const funnel = data.funnel.map((s) => ({ ...s, label: STEP_LABELS[s.step], share: `${Math.round((s.count / views) * 100)}%` }))
  const months = (rows: { month: string }[]) => rows.map((r) => ({ ...r, name: shortMonth(r.month) }))

  return (
    <div className="space-y-6">
      <h1 className="cornice font-display text-3xl font-bold">Host dashboard</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiTile label={`Occupancy, next ${data.days} days`} value={`${Math.round(data.occupancy_rate * 100)}%`} sub="booked nights from today, across active listings" source={data.sources.bookings} />
        <KpiTile label="Average nightly price" value={formatPrice(data.average_nightly_price)} sub="across active listings" />
        <KpiTile
          label="Response time"
          value={data.average_response_minutes < 60 ? `${data.average_response_minutes} min` : `${Math.round(data.average_response_minutes / 60)} h`}
          sub={`replies to ${data.response_rate}% of messages`}
          source={data.sources.response}
        />
        <KpiTile
          label={`Cancellations, last 12 months`}
          value={String(data.cancellations_by_month.reduce((s, m) => s + m.cancellations, 0))}
          sub="cancelled or declined"
          source={data.sources.bookings}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard
          title={`Views to bookings, last ${data.days} days`}
          source={data.sources.funnel}
          wide
          height={220}
          table={{ columns: ['Step', 'Count', 'Share of views'], rows: funnel.map((s) => [s.label, s.count, s.share]) }}
        >
          <ResponsiveContainer>
            <BarChart data={funnel} layout="vertical" margin={{ top: 4, right: 56, left: 32, bottom: 0 }}>
              <CartesianGrid {...gridProps()} horizontal={false} vertical />
              <XAxis type="number" allowDecimals={false} {...axisProps()} />
              <YAxis type="category" dataKey="label" width={120} {...axisProps()} />
              <Tooltip {...tooltipProps()} />
              <Bar dataKey="count" name="Count" fill={seriesColor(0)} radius={BAR_RADIUS_RIGHT} maxBarSize={26}>
                {/* Direct label: share of views kept at each step */}
                <LabelList dataKey="share" position="right" fill={themeColor('fg-soft')} fontSize={12} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Revenue per month"
          source={data.sources.bookings}
          table={{ columns: ['Month', 'Revenue (USD)'], rows: data.revenue_by_month.map((m) => [m.month, m.revenue]) }}
        >
          <ResponsiveContainer>
            <LineChart data={months(data.revenue_by_month)} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid {...gridProps()} />
              <XAxis dataKey="name" {...axisProps()} />
              <YAxis tickFormatter={(v: number) => formatPrice(v)} width={64} {...axisProps()} />
              <Tooltip {...tooltipProps()} formatter={(v) => formatPrice(Number(v))} />
              <Line type="monotone" dataKey="revenue" name="Revenue" stroke={seriesColor(0)} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Cancellations per month"
          source={data.sources.bookings}
          table={{ columns: ['Month', 'Cancelled or declined'], rows: data.cancellations_by_month.map((m) => [m.month, m.cancellations]) }}
        >
          <ResponsiveContainer>
            <BarChart data={months(data.cancellations_by_month)} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid {...gridProps()} />
              <XAxis dataKey="name" {...axisProps()} />
              <YAxis allowDecimals={false} {...axisProps()} />
              <Tooltip {...tooltipProps()} />
              <Bar dataKey="cancellations" name="Cancellations" fill={seriesColor(1)} radius={BAR_RADIUS_UP} maxBarSize={24} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard
          title="Average rating per month"
          source={data.sources.reviews}
          wide
          table={{
            columns: ['Month', 'Average rating', 'Reviews'],
            rows: data.rating_by_month.map((m) => [m.month, m.average_rating ?? '—', m.reviews]),
          }}
        >
          <ResponsiveContainer>
            <LineChart data={months(data.rating_by_month)} margin={{ top: 8, right: 16, left: -20, bottom: 0 }}>
              <CartesianGrid {...gridProps()} />
              <XAxis dataKey="name" {...axisProps()} />
              <YAxis domain={[1, 5]} ticks={[1, 2, 3, 4, 5]} {...axisProps()} />
              <Tooltip {...tooltipProps()} />
              {/* Months without reviews are gaps in the line, not drops to zero */}
              <Line type="monotone" dataKey="average_rating" name="Average rating" stroke={seriesColor(2)} strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>
    </div>
  )
}

export default HostDashboardPage
