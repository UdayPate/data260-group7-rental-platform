// The mock "database": in-memory copies of the seed data that the handlers
// read and change. Reloading the page rebuilds it from the seed, so every demo
// starts from the same state.
import type { AvailabilityBlock } from '../types/availability'
import type { Guest } from '../types/guest'
import type { Host } from '../types/host'
import type { Property } from '../types/property'
import type { PriceBreakdown, Reservation } from '../types/reservation'
import { seedHostBlocks } from './data/availability'
import { seedGuests } from './data/guests'
import { seedHosts } from './data/hosts'
import { seedProperties } from './data/properties'
import { seedReservations } from './data/reservations'
import { seedSaved, type SavedProperty } from './data/saved'
import { nightsBetween, rangesOverlap } from './dates'

// nights x nightly price + cleaning fee (no taxes or service fee in this project).
export function priceBreakdown(property: Property, checkIn: string, checkOut: string): PriceBreakdown {
  const nights = nightsBetween(checkIn, checkOut)
  const subtotal = nights * property.nightly_price
  return {
    nights,
    nightly_price: property.nightly_price,
    subtotal,
    cleaning_fee: property.cleaning_fee,
    total: subtotal + property.cleaning_fee,
  }
}

// Next id for a prefix, e.g. nextId('r', ['r_001', 'r_024']) -> 'r_025'.
export function nextId(prefix: string, existingIds: string[]): string {
  const numbers = existingIds.map((id) => Number(id.split('_')[1]) || 0)
  const next = Math.max(0, ...numbers) + 1
  return `${prefix}_${String(next).padStart(3, '0')}`
}

// Pending and approved reservations hold their dates (team rule), so each gets a "booked" block.
export function holdsDates(reservation: Reservation): boolean {
  return reservation.status === 'pending' || reservation.status === 'approved'
}

// structuredClone makes deep copies, so changing the db never changes the seed arrays.
const properties: Property[] = structuredClone(seedProperties)
const hosts: Host[] = structuredClone(seedHosts)
const saved: SavedProperty[] = structuredClone(seedSaved)

const reservations: Reservation[] = seedReservations.map((seed) => {
  const property = properties.find((p) => p.property_id === seed.property_id)!
  return { ...seed, price_breakdown: priceBreakdown(property, seed.check_in, seed.check_out) }
})

// Guests' counters are counted from the data, not typed in, so they always match.
const guests: Guest[] = structuredClone(seedGuests).map((guest) => ({
  ...guest,
  saved_properties_count: saved.filter((s) => s.guest_id === guest.guest_id).length,
  booking_count: reservations.filter((r) => r.guest_id === guest.guest_id).length,
}))

const availability: AvailabilityBlock[] = structuredClone(seedHostBlocks)

// reservation_id -> availability_id of its "booked" block, so the block can be
// removed when the reservation is declined or cancelled.
const bookingBlockIds = new Map<string, string>()

for (const reservation of reservations.filter(holdsDates)) {
  const availabilityId = nextId('a', availability.map((a) => a.availability_id))
  availability.push({
    availability_id: availabilityId,
    property_id: reservation.property_id,
    start_date: reservation.check_in,
    end_date: reservation.check_out,
    status: 'booked',
    source: 'booking',
    updated_datetime: reservation.booking_datetime,
  })
  bookingBlockIds.set(reservation.reservation_id, availabilityId)
}

export const db = {
  hosts,
  guests,
  properties,
  reservations,
  availability,
  saved,
  bookingBlockIds,
  // idempotency_key -> reservation_id: a repeated booking action returns the first result.
  idempotencyKeys: new Map<string, string>(),
}

// True if any blocked or booked dates on the property overlap the requested stay.
export function hasDateConflict(propertyId: string, checkIn: string, checkOut: string): boolean {
  return db.availability.some(
    (block) =>
      block.property_id === propertyId &&
      block.status !== 'available' &&
      rangesOverlap(block.start_date, block.end_date, checkIn, checkOut),
  )
}
