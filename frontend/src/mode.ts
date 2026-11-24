// Guest or host mode comes from the URL (team decision): host pages live under /host,
// plus the host dashboard. Used by the header and the floating AI assistant.
export function isHostPath(pathname: string): boolean {
  return pathname.startsWith('/host') || pathname === '/dashboards/host'
}
