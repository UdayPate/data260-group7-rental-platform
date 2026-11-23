// Date helpers for the mocks. Seed dates are relative to today, so "upcoming"
// trips are always upcoming no matter when the demo runs.

// A Date as "YYYY-MM-DD" in local time.
function toDateString(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

// daysFromToday(3) = the date 3 days from now; daysFromToday(-3) = 3 days ago.
export function daysFromToday(days: number): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return toDateString(date)
}

export const today = () => daysFromToday(0)

// A UTC datetime "days" days ago, e.g. "2026-11-20T18:05:09Z".
export function daysAgoDatetime(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

export const nowDatetime = () => daysAgoDatetime(0)

// Number of nights between two "YYYY-MM-DD" dates.
export function nightsBetween(start: string, end: string): number {
  return Math.round((Date.parse(end) - Date.parse(start)) / (24 * 60 * 60 * 1000))
}

// True if two date ranges share at least one night. End dates are exclusive
// (check-out day), so 12-01..12-03 and 12-03..12-05 do NOT overlap.
// Comparing "YYYY-MM-DD" strings works because they sort like dates.
export function rangesOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd
}

// A real calendar date in "YYYY-MM-DD" form (rejects "2026-13-40" and "next week").
export function isValidDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value))
}
