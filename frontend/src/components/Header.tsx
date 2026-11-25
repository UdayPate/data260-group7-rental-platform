import { Link, NavLink, useLocation } from 'react-router'
import { useAuth } from '../auth/useAuth'
import { BRAND } from '../brand'
import { mocksEnabled } from '../config'
import type { Role } from '../types/auth'
import BrandLogo from './BrandLogo'
import FilterStrip from './FilterStrip'
import HostFilterStrip from './HostFilterStrip'
import SearchBar from './SearchBar'
import UnreadBadge from './UnreadBadge'

type NavItem = { to: string; label: string }

const guestNav: NavItem[] = [
  { to: '/search', label: 'Search' },
  { to: '/guest/trips', label: 'Trips' },
  { to: '/guest/messages', label: 'Messages' },
  { to: '/ai', label: 'AI Assistant' },
  { to: '/dashboards/guest', label: 'Dashboards' },
  { to: '/guest/profile', label: 'Profile' },
]

const hostNav: NavItem[] = [
  { to: '/host/listings', label: 'Listings' },
  { to: '/host/reservations', label: 'Reservations' },
  { to: '/host/reviews', label: 'Reviews' },
  { to: '/host/messages', label: 'Messages' },
  { to: '/dashboards/host', label: 'Dashboards' },
]

const adminNav: NavItem[] = [
  { to: '/dashboards/platform', label: 'Platform dashboard' },
  { to: '/dashboards/ai', label: 'AI dashboard' },
]

// Logged out: only the public pages (search and property pages).
const publicNav: NavItem[] = [{ to: '/search', label: 'Search' }]

const NAV: Record<Role, NavItem[]> = { guest: guestNav, host: hostNav, admin: adminNav }

// Layout: row 1 = logo, nav, mock badge, who is logged in + Log out (or Log in / Sign up);
// row 2 = search bar (guests and logged-out visitors); then the travertine filter strip
// (search page, and the host's "My listings").
function Header() {
  const { pathname, search } = useLocation()
  const { user, logOut } = useAuth()

  // The role in the token decides everything (no Guest/Host toggle any more).
  const navItems = user ? NAV[user.role] : publicNav
  const onSearchPage = pathname === '/search'
  // Not on the log in / sign up pages (nothing to search there), and not on the
  // logged-out home page, whose hero has its own search bar.
  const onHomePage = pathname === '/' && !user
  const showSearchBar = (!user || user.role === 'guest') && !['/login', '/signup'].includes(pathname) && !onHomePage

  return (
    <header className="border-b border-line bg-bg">
      <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
        {/* Logo with the tagline underneath (tagline hidden on narrower screens). Both from brand.ts. */}
        <Link to="/" className="leading-tight text-fg">
          <BrandLogo className="block text-2xl" />
          <span data-tagline className="hidden text-xs whitespace-nowrap text-fg-muted xl:block">
            {BRAND.tagline}
          </span>
        </Link>

        <nav className="flex gap-4">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `whitespace-nowrap ${isActive ? 'font-semibold text-fg' : 'text-fg-muted hover:text-fg'}`
              }
            >
              {item.label}
              {item.to.endsWith('/messages') && user && <UnreadBadge key={user.id} userId={user.id} />}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-4">
          {mocksEnabled && (
            <span className="rounded-full border border-status-pending px-3 py-0.5 font-condensed text-xs font-bold tracking-[0.08em] whitespace-nowrap text-status-pending uppercase">
              Mock data
            </span>
          )}

          {user ? (
            <>
              <span data-account className="flex items-center gap-2 whitespace-nowrap">
                <span className="text-fg">{user.name}</span>
                <span className="rounded-full border border-gold px-2 py-0.5 font-condensed text-xs font-bold tracking-[0.08em] text-gold uppercase">
                  {user.role}
                </span>
              </span>
              <button type="button" onClick={() => logOut()} className="rounded-full border border-line-strong px-4 py-1.5 font-semibold whitespace-nowrap hover:bg-surface">
                Log out
              </button>
            </>
          ) : (
            <>
              <Link
                // Come back to this page after logging in (but not to the login/sign-up pages themselves).
                to={pathname === '/login' || pathname === '/signup' ? '/login' : `/login?next=${encodeURIComponent(pathname + search)}`}
                className="rounded-full border border-line-strong px-4 py-1.5 font-semibold whitespace-nowrap hover:bg-surface"
              >
                Log in
              </Link>
              <Link to="/signup" className="rounded-full bg-primary px-4 py-1.5 font-semibold whitespace-nowrap text-on-primary hover:brightness-110">
                Sign up
              </Link>
            </>
          )}
        </div>
      </div>

      {showSearchBar && (
        <div className="px-6 pb-4">
          {/* The key changes whenever the search URL changes, so the bar's fields reset to match it. */}
          <SearchBar key={onSearchPage ? search : 'not-search-page'} />
        </div>
      )}

      {onSearchPage && <FilterStrip />}
      {/* Host "My listings" gets its own strip (listing filters). key = reset its text box when the URL changes. */}
      {pathname === '/host/listings' && <HostFilterStrip key={search} />}
    </header>
  )
}

export default Header
