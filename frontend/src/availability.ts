// Reading availability blocks (from /properties/availability) in the UI.
// The server still makes the final call when a booking is requested.
import type { AvailabilityBlock, AvailabilityEvent } from './types/availability'

// The blocked/booked block covering the night starting on `date`, or undefined if it's free.
export function blockForNight(blocks: AvailabilityBlock[], date: string): AvailabilityBlock | undefined {
  return blocks.find((b) => b.status !== 'available' && b.start_date <= date && date < b.end_date)
}

// True if any night of the stay (check-in up to, not including, check-out) is unavailable.
export function stayHasUnavailableNight(blocks: AvailabilityBlock[], checkIn: string, checkOut: string): boolean {
  return blocks.some((b) => b.status !== 'available' && b.start_date < checkOut && checkIn < b.end_date)
}

// A live update (spec 13.4) applied to the page's list of blocks:
// "blocked" adds the block (or replaces it if we already have it), "released" removes it.
export function applyAvailabilityEvent(blocks: AvailabilityBlock[], event: AvailabilityEvent): AvailabilityBlock[] {
  const block = event.payload.block
  const others = blocks.filter((b) => b.availability_id !== block.availability_id)
  return event.event_type === 'availability.blocked' ? [...others, block] : others
}
