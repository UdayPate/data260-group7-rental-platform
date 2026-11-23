import PlaceholderPage from '../../components/PlaceholderPage'

function GuestDashboardPage() {
  return (
    <PlaceholderPage
      title="Guest dashboard"
      specItems={[
        'Bookings over 30 days, reservation-status summary, saved-property activity',
        'Average match score, recommendation approvals',
        'Filter by trace_id',
      ]}
    />
  )
}

export default GuestDashboardPage
