import PlaceholderPage from '../../components/PlaceholderPage'

function PlatformDashboardPage() {
  return (
    <PlaceholderPage
      title="Platform dashboard"
      specItems={[
        'Events by topic, consumer lag, throughput, errors and retries',
        'Dead-letter messages, average workflow latency, rejected envelopes',
        'Filter by trace_id',
      ]}
    />
  )
}

export default PlatformDashboardPage
