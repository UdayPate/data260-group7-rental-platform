// Date helpers for the UI. Dates in the API are 'YYYY-MM-DD' strings (see the data contract);
// these turn them into readable text and do the little bits of date math the pages need.

// 'YYYY-MM-DD' for a year, month (1-12) and day.
export function dateString(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

// A local calendar date as 'YYYY-MM-DD'. localDate() = today, localDate(1) = tomorrow,
// localDate(1, '2026-12-04') = '2026-12-05'.
export function localDate(offsetDays = 0, from?: string): string {
  const date = from ? new Date(`${from}T00:00:00`) : new Date()
  date.setDate(date.getDate() + offsetDays)
  return dateString(date.getFullYear(), date.getMonth() + 1, date.getDate())
}

// Nights between check-in and check-out ('2026-12-04' -> '2026-12-06' = 2).
export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round((Date.parse(checkOut) - Date.parse(checkIn)) / (24 * 60 * 60 * 1000))
}

// '2026-12-04' -> 'Dec 4, 2026'
export function formatDate(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

// '2026-11-23T18:05:09Z' -> 'Nov 23, 2026, 10:05 AM' (in the viewer's own time zone)
export function formatDateTime(datetime: string): string {
  return new Date(datetime).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })
}

// "14:03:22.481" in the viewer's time zone
export function clockTime(ms: number): string {
  const d = new Date(ms)
  return `${d.toLocaleTimeString('en-US', { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`
}
