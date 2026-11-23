// Reading availability blocks (from /properties/availability) in the UI.
// The server still makes the final call when a booking is requested.
import type { AvailabilityBlock } from './types/availability'

// True if the night starting on `date` is blocked or booked.
// Blocks end on their end_date (exclusive, like check-out), so end_date itself is free.
export function isNightUnavailable(blocks: AvailabilityBlock[], date: string): boolean {
  return blocks.some((b) => b.status !== 'available' && b.start_date <= date && date < b.end_date)
}

// True if any night of the stay (check-in up to, not including, check-out) is unavailable.
export function stayHasUnavailableNight(blocks: AvailabilityBlock[], checkIn: string, checkOut: string): boolean {
  return blocks.some((b) => b.status !== 'available' && b.start_date < checkOut && checkIn < b.end_date)
}
