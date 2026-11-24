// Guest or host mode comes from the URL (team decision): host pages live under /host,
// plus the host dashboard. The Platform and AI dashboards belong to neither, so they keep
// the mode you came from through "?as=host" in their URL (team decision U3a).
// Used by the header, the dashboard tabs and the floating AI assistant.
export function isHostPath(pathname: string, search = ''): boolean {
  if (pathname.startsWith('/host') || pathname === '/dashboards/host') return true
  const neutralDashboard = pathname === '/dashboards/platform' || pathname === '/dashboards/ai'
  return neutralDashboard && new URLSearchParams(search).get('as') === 'host'
}
