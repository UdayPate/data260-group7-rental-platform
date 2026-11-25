import { lazy, Suspense } from 'react'
import { Route, Routes } from 'react-router'
import RequireRole from './auth/RequireRole'
import AppLayout from './components/AppLayout'
import HomeRoute from './pages/HomeRoute'
import NotFoundPage from './pages/NotFoundPage'
import AiDebatePage from './pages/ai/AiDebatePage'
import LoginPage from './pages/auth/LoginPage'
import SignupPage from './pages/auth/SignupPage'
import AiRequestPage from './pages/ai/AiRequestPage'
import GuestMessagesPage from './pages/guest/GuestMessagesPage'
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

// The dashboards (and Recharts, which only they use) are loaded on demand: the browser
// downloads that code the first time someone opens a dashboard, which keeps the
// first page load small. <Suspense> shows "Loading…" while it downloads.
const DashboardsLayout = lazy(() => import('./pages/dashboards/DashboardsLayout'))
const GuestDashboardPage = lazy(() => import('./pages/dashboards/GuestDashboardPage'))
const HostDashboardPage = lazy(() => import('./pages/dashboards/HostDashboardPage'))
const PlatformDashboardPage = lazy(() => import('./pages/dashboards/PlatformDashboardPage'))
const AiDashboardPage = lazy(() => import('./pages/dashboards/AiDashboardPage'))

const loading = <p className="text-fg-muted">Loading…</p>

// Every URL in the app. All pages render inside AppLayout (header + page).
// ":propertyId" etc. are URL parameters the page reads with useParams().
function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        {/* Public: anyone, logged in or not */}
        {/* "/" = the home page when logged out; logged-in users go on to /search. */}
        <Route path="/" element={<HomeRoute />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/properties/:propertyId" element={<PropertyDetailsPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />

        {/* Guest accounts only (RequireRole sends anyone else away) */}
        <Route element={<RequireRole role="guest" />}>
          <Route path="/guest/profile" element={<GuestProfilePage />} />
          <Route path="/guest/trips" element={<TripsPage />} />
          <Route path="/guest/trips/:reservationId" element={<ReservationStatusPage />} />
          <Route path="/guest/messages" element={<GuestMessagesPage />} />
          <Route path="/guest/reviews/new/:reservationId" element={<WriteReviewPage />} />
          <Route path="/ai" element={<AiRequestPage />} />
          <Route path="/ai/tasks/:taskId" element={<AiDebatePage />} />
        </Route>

        {/* Host accounts only */}
        <Route element={<RequireRole role="host" />}>
          <Route path="/host/listings" element={<HostListingsPage />} />
          <Route path="/host/listings/new" element={<ListingFormPage />} />
          <Route path="/host/listings/:propertyId/edit" element={<ListingFormPage />} />
          <Route path="/host/listings/:propertyId/availability" element={<HostAvailabilityPage />} />
          <Route path="/host/reservations" element={<HostReservationsPage />} />
          <Route path="/host/reviews" element={<HostReviewsPage />} />
          <Route path="/host/messages" element={<HostMessagesPage />} />
        </Route>

        {/* Dashboards share a tab row; each one is for one role */}
        <Route element={<Suspense fallback={loading}><DashboardsLayout /></Suspense>}>
          <Route element={<RequireRole role="guest" />}>
            <Route path="/dashboards/guest" element={<Suspense fallback={loading}><GuestDashboardPage /></Suspense>} />
          </Route>
          <Route element={<RequireRole role="host" />}>
            <Route path="/dashboards/host" element={<Suspense fallback={loading}><HostDashboardPage /></Suspense>} />
          </Route>
          <Route element={<RequireRole role="admin" />}>
            <Route path="/dashboards/platform" element={<Suspense fallback={loading}><PlatformDashboardPage /></Suspense>} />
            <Route path="/dashboards/ai" element={<Suspense fallback={loading}><AiDashboardPage /></Suspense>} />
          </Route>
        </Route>

        {/* Any other URL */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}

export default App
