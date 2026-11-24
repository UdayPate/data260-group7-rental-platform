import { Link, NavLink, useLocation, useNavigate } from 'react-router'
import { BRAND } from '../brand'
import { mocksEnabled } from '../config'
import { useCurrentUser } from '../context/useCurrentUser'
import { isHostPath } from '../mode'
import BrandLogo from './BrandLogo'
import FilterStrip from './FilterStrip'
import HostFilterStrip from './HostFilterStrip'
import SearchBar from './SearchBar'
import UnreadBadge from './UnreadBadge'
import UserPicker from './UserPicker'

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
  { to: '/host/reviews', label: 'Reviews' },
  { to: '/host/messages', label: 'Messages' },
  { to: '/dashboards/host', label: 'Dashboards' },
]

// Layout (team decision): row 1 = logo, nav, badge, picker, toggle;
// row 2 = search bar (guest mode); then the cream filter strip (search page, and host "My listings").
function Header() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  const { usersVersion, guestId, hostId } = useCurrentUser()

  // The mode comes from the URL (see mode.ts). No separate state, so the toggle
  // and the page can never disagree.
  const isHost = isHostPath(pathname, search)
  const navItems = isHost ? hostNav : guestNav
  const userId = isHost ? hostId : guestId // whose unread messages the badge counts
  const onSearchPage = pathname === '/'

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
              end={item.to === '/'} // "/" would otherwise count as active on every page
              className={({ isActive }) =>
                `whitespace-nowrap ${isActive ? 'font-semibold text-fg' : 'text-fg-muted hover:text-fg'}`
              }
            >
              {item.label}
              {item.to.endsWith('/messages') && <UnreadBadge key={userId} userId={userId} />}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-4">
          {mocksEnabled && (
            <span className="rounded-full border border-status-pending px-3 py-0.5 font-condensed text-xs font-bold tracking-[0.08em] whitespace-nowrap text-status-pending uppercase">
              Mock data
            </span>
          )}

          {/* key={...} makes React start a fresh picker when the mode or the list of guests changes */}
          <UserPicker key={`${isHost ? 'host' : 'guest'}-${usersVersion}`} mode={isHost ? 'host' : 'guest'} />

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

      {!isHost && (
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
