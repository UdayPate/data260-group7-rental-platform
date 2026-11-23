import { Link, NavLink, useLocation, useNavigate } from 'react-router'
import { mocksEnabled } from '../config'

type NavItem = { to: string; label: string }

const guestNav: NavItem[] = [
  { to: '/', label: 'Search' },
  { to: '/guest/trips', label: 'Trips' },
  { to: '/guest/messages', label: 'Messages' },
  { to: '/ai', label: 'AI Assistant' },
  { to: '/dashboards/guest', label: 'Dashboards' },
  { to: '/guest/profile', label: 'Profile' },
]

const hostNav: NavItem[] = [
  { to: '/host/listings', label: 'Listings' },
  { to: '/host/reservations', label: 'Reservations' },
  { to: '/host/messages', label: 'Messages' },
  { to: '/dashboards/host', label: 'Dashboards' },
]

function Header() {
  const { pathname } = useLocation()
  const navigate = useNavigate()

  // The mode comes from the URL: host pages live under /host (plus the host dashboard).
  // No separate state, so the toggle and the page can never disagree.
  const isHost = pathname.startsWith('/host') || pathname === '/dashboards/host'
  const navItems = isHost ? hostNav : guestNav

  return (
    <header className="border-b border-line bg-bg">
      <div className="mx-auto flex max-w-6xl items-center gap-8 px-6 py-4">
        <Link to="/" className="font-display text-2xl font-extrabold text-fg">
          Cedar <span className="text-primary">&amp;</span> Rye
        </Link>

        <nav className="flex gap-5">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'} // "/" would otherwise count as active on every page
              className={({ isActive }) =>
                isActive ? 'font-semibold text-fg' : 'text-fg-muted hover:text-fg'
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-4">
          {mocksEnabled && (
            <span className="rounded-full border border-status-pending px-3 py-0.5 font-condensed text-xs font-bold tracking-[0.08em] text-status-pending uppercase">
              Mock data
            </span>
          )}

          {/* Guest/Host toggle: switching mode just goes to that area's start page. */}
          <div className="flex rounded-full bg-surface-2 p-1">
            <button
              type="button"
              aria-pressed={!isHost}
              onClick={() => navigate('/')}
              className={`rounded-full px-4 py-1 font-semibold ${!isHost ? 'bg-mustard text-bg' : 'text-fg-muted'}`}
            >
              Guest
            </button>
            <button
              type="button"
              aria-pressed={isHost}
              onClick={() => navigate('/host/listings')}
              className={`rounded-full px-4 py-1 font-semibold ${isHost ? 'bg-mustard text-bg' : 'text-fg-muted'}`}
            >
              Host
            </button>
          </div>
        </div>
      </div>
    </header>
  )
}

export default Header
