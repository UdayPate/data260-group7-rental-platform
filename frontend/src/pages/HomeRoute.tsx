// What "/" shows. Logged out: the home page. Logged in: search is your home, so go to
// /search. Old links with filters (e.g. "/?location=San+Jose") also go on to /search.
import { Navigate, useLocation } from 'react-router'
import { useAuth } from '../auth/useAuth'
import HomePage from './HomePage'

function HomeRoute() {
  const { user } = useAuth()
  const location = useLocation()
  if (user || location.search) {
    return <Navigate to={`/search${location.search}`} replace state={location.state} />
  }
  return <HomePage />
}

export default HomeRoute
