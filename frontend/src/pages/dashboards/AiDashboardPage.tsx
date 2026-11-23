import PlaceholderPage from '../../components/PlaceholderPage'

function AiDashboardPage() {
  return (
    <PlaceholderPage
      title="AI dashboard"
      specItems={[
        'Agent publication timeline, disagreement size, challenge count, votes, dissent rate',
        'precision@10, recall@10, human approval categories',
        'Filter by trace_id',
      ]}
    />
  )
}

export default AiDashboardPage
