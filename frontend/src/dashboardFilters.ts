// Dashboard filters live in the URL (team decision U2a): ?days=7|30|90&trace_id=...
// plus ?as=host on the Platform and AI dashboards when you came from host mode (U3a).
export const DAY_OPTIONS = [7, 30, 90] as const

export type DashboardFilters = { days: number; traceId: string | null }

export function readDashboardFilters(params: URLSearchParams): DashboardFilters {
  const days = Number(params.get('days'))
  return {
    days: (DAY_OPTIONS as readonly number[]).includes(days) ? days : 30,
    traceId: params.get('trace_id') || null,
  }
}
