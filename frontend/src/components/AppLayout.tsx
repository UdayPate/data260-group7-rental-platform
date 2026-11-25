import { Outlet, useLocation, useNavigate } from 'react-router'
import { ROLE_PLURAL, useAuth } from '../auth/useAuth'
import type { Role } from '../types/auth'
import AssistantLauncher from './ai/AssistantLauncher'
import Header from './Header'

// Wraps every page: the header on top, then the current page (<Outlet />) below it.
// The AI assistant launcher lives here (not in a page) so its current request
// survives moving between pages. It hides itself where it doesn't belong.
function AppLayout() {
  const { user } = useAuth()
  const { pathname } = useLocation()

  return (
    <>
      <Header />
      {/* The logged-out home page is full width (its hero photo spans the screen);
          every other page sits in the usual centred column. */}
      {pathname === '/' && !user ? (
        <main>
          <Outlet />
        </main>
      ) : (
        <main className="mx-auto max-w-7xl px-6 py-8">
          <WrongRoleNote />
          <Outlet />
        </main>
      )}
      {/* key: a different account in this tab starts a fresh assistant (no one else's request) */}
      <AssistantLauncher key={user?.id ?? 'logged-out'} />
    </>
  )
}

// After RequireRole sent you away from another role's page (team decision A9a).
function WrongRoleNote() {
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const wrongRole = (location.state as { wrongRole?: Role } | null)?.wrongRole
  if (!wrongRole || !user) return null

  return (
    <div role="status" data-wrong-role className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-status-pending px-4 py-3 text-status-pending">
      <p className="flex-1">
        That page is for {ROLE_PLURAL[wrongRole]}. You’re logged in as {user.role === 'admin' ? 'the admin' : `a ${user.role}`}, so here is your
        home page.
      </p>
      <button
        type="button"
        // Same page, without the note.
        onClick={() => navigate(location.pathname + location.search, { replace: true, state: null })}
        className="rounded-full border border-status-pending px-4 py-1 text-sm font-semibold hover:bg-surface-2"
      >
        Dismiss
      </button>
    </div>
  )
}

export default AppLayout
