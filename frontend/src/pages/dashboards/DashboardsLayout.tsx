import { NavLink, Outlet } from 'react-router'

const tabs = [
  { to: '/dashboards/guest', label: 'Guest' },
  { to: '/dashboards/host', label: 'Host' },
  { to: '/dashboards/platform', label: 'Platform' },
  { to: '/dashboards/ai', label: 'AI' },
]

// Tab row shared by the four dashboards, then the current dashboard (<Outlet />) below it.
function DashboardsLayout() {
  return (
    <>
      <div className="mb-6 flex gap-2">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            className={({ isActive }) =>
              `rounded-full border px-4 py-1 font-semibold ${
                isActive ? 'border-mustard-border bg-mustard text-bg' : 'border-line text-fg-muted hover:text-fg'
              }`
            }
          >
            {tab.label}
          </NavLink>
        ))}
      </div>
      <Outlet />
    </>
  )
}

export default DashboardsLayout
