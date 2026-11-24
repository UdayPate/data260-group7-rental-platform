import { Route, Routes } from 'react-router'
import AppLayout from './components/AppLayout'
import NotFoundPage from './pages/NotFoundPage'
import ThemeCheckPage from './pages/ThemeCheckPage'
import AiDebatePage from './pages/ai/AiDebatePage'
import AiRequestPage from './pages/ai/AiRequestPage'
import AiDashboardPage from './pages/dashboards/AiDashboardPage'
import DashboardsLayout from './pages/dashboards/DashboardsLayout'
import GuestDashboardPage from './pages/dashboards/GuestDashboardPage'
import HostDashboardPage from './pages/dashboards/HostDashboardPage'
import PlatformDashboardPage from './pages/dashboards/PlatformDashboardPage'
import GuestMessagesPage from './pages/guest/GuestMessagesPage'
import GuestProfileNewPage from './pages/guest/GuestProfileNewPage'
import GuestProfilePage from './pages/guest/GuestProfilePage'
import PropertyDetailsPage from './pages/guest/PropertyDetailsPage'
import ReservationStatusPage from './pages/guest/ReservationStatusPage'
import SearchPage from './pages/guest/SearchPage'
import TripsPage from './pages/guest/TripsPage'
import WriteReviewPage from './pages/guest/WriteReviewPage'
import HostAvailabilityPage from './pages/host/HostAvailabilityPage'
import HostListingsPage from './pages/host/HostListingsPage'
import HostMessagesPage from './pages/host/HostMessagesPage'
import HostReservationsPage from './pages/host/HostReservationsPage'
import HostReviewsPage from './pages/host/HostReviewsPage'
import ListingFormPage from './pages/host/ListingFormPage'

// Every URL in the app. All pages render inside AppLayout (header + page).
// ":propertyId" etc. are URL parameters the page reads with useParams().
function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        {/* Guest */}
        <Route path="/" element={<SearchPage />} />
        <Route path="/properties/:propertyId" element={<PropertyDetailsPage />} />
        <Route path="/guest/profile" element={<GuestProfilePage />} />
        <Route path="/guest/profile/new" element={<GuestProfileNewPage />} />
        <Route path="/guest/trips" element={<TripsPage />} />
        <Route path="/guest/trips/:reservationId" element={<ReservationStatusPage />} />
        <Route path="/guest/messages" element={<GuestMessagesPage />} />
        <Route path="/guest/reviews/new/:reservationId" element={<WriteReviewPage />} />

        {/* Host */}
        <Route path="/host/listings" element={<HostListingsPage />} />
        <Route path="/host/listings/new" element={<ListingFormPage />} />
        <Route path="/host/listings/:propertyId/edit" element={<ListingFormPage />} />
        <Route path="/host/listings/:propertyId/availability" element={<HostAvailabilityPage />} />
        <Route path="/host/reservations" element={<HostReservationsPage />} />
        <Route path="/host/reviews" element={<HostReviewsPage />} />
        <Route path="/host/messages" element={<HostMessagesPage />} />

        {/* AI */}
        <Route path="/ai" element={<AiRequestPage />} />
        <Route path="/ai/tasks/:taskId" element={<AiDebatePage />} />

        {/* Dashboards (share a tab row) */}
        <Route element={<DashboardsLayout />}>
          <Route path="/dashboards/guest" element={<GuestDashboardPage />} />
          <Route path="/dashboards/host" element={<HostDashboardPage />} />
          <Route path="/dashboards/platform" element={<PlatformDashboardPage />} />
          <Route path="/dashboards/ai" element={<AiDashboardPage />} />
        </Route>

        {/* Developer-only theme check (remove once the theme is settled) */}
        <Route path="/theme-check" element={<ThemeCheckPage />} />

        {/* Any other URL */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

export default App
