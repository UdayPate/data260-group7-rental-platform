// Route guard: the pages inside it are only for one role.
//  - logged out           -> login page, then back here (?next=)
//  - logged in, wrong role -> your own home page, with a short note (team decision A9a)
import { Navigate, Outlet, useLocation } from 'react-router'
import type { Role } from '../types/auth'
import { HOME, useAuth } from './useAuth'

function RequireRole({ role }: { role: Role }) {
  const { user } = useAuth()
  const location = useLocation()

  if (!user) {
    const here = location.pathname + location.search
    return <Navigate to={`/login?next=${encodeURIComponent(here)}`} replace />
  }
  if (user.role !== role) {
    return <Navigate to={HOME[user.role]} replace state={{ wrongRole: role }} />
  }
  return <Outlet />
}

export default RequireRole
