import PlaceholderPage from '../../components/PlaceholderPage'

function HostDashboardPage() {
  return (
    <PlaceholderPage
      title="Host dashboard"
      specItems={[
        'Views-to-booking funnel, occupancy, average nightly price, revenue trend',
        'Cancellations, rating trend, response time',
        'Filter by trace_id',
      ]}
    />
  )
}

export default HostDashboardPage
