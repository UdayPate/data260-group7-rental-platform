// Reading availability blocks (from /properties/availability) in the UI.
// The server still makes the final call when a booking is requested.
import type { AvailabilityBlock } from './types/availability'

// The blocked/booked block covering the night starting on `date`, or undefined if it's free.
export function blockForNight(blocks: AvailabilityBlock[], date: string): AvailabilityBlock | undefined {
  return blocks.find((b) => b.status !== 'available' && b.start_date <= date && date < b.end_date)
}

// True if any night of the stay (check-in up to, not including, check-out) is unavailable.
export function stayHasUnavailableNight(blocks: AvailabilityBlock[], checkIn: string, checkOut: string): boolean {
  return blocks.some((b) => b.status !== 'available' && b.start_date < checkOut && checkIn < b.end_date)
}
