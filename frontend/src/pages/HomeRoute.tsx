// What "/" (and the XENIA logo) shows. Logged out: the home page. Logged in: your role's
// home page (guest /search, host /host/listings, admin /dashboards/platform).
// Old links with filters (e.g. "/?location=San+Jose") go on to /search.
import { Navigate, useLocation } from 'react-router'
import { HOME, useAuth } from '../auth/useAuth'
import HomePage from './HomePage'

function HomeRoute() {
  const { user } = useAuth()
  const location = useLocation()
  if (location.search) {
    return <Navigate to={`/search${location.search}`} replace state={location.state} />
  }
  if (user) {
    return <Navigate to={HOME[user.role]} replace state={location.state} />
  }
  return <HomePage />
}

export default HomeRoute
