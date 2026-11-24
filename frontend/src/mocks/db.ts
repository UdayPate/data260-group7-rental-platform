// The mock "database": in-memory copies of the seed data that the handlers
// read and change. Reloading the page rebuilds it from the seed, so every demo
// starts from the same state.
import type { AvailabilityBlock } from '../types/availability'
import type { Guest } from '../types/guest'
import type { Host } from '../types/host'
import type { Property } from '../types/property'
import type { PriceBreakdown, Reservation } from '../types/reservation'
import type { Review } from '../types/review'
import { seedHostBlocks } from './data/availability'
import { seedGuests } from './data/guests'
import { seedHosts } from './data/hosts'
import { seedProperties } from './data/properties'
import { seedReservations } from './data/reservations'
import { seedReviews } from './data/reviews'
import { seedSaved, type SavedProperty } from './data/saved'
import { pastStayReservations, pastStayReviews } from './data/pastStays'
import { seedMessages, seedThreads } from './data/threads'
import { nightsBetween, rangesOverlap, today } from './dates'
import type { Message, Thread } from '../types/message'

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
// Recent reviews plus the older San Jose stays' reviews (data/pastStays.ts).
const reviews: Review[] = structuredClone([...seedReviews, ...pastStayReviews])

const reservations: Reservation[] = [...seedReservations, ...pastStayReservations].map((seed) => {
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

// Threads get the display names copied in from the guest, host and listing (C2a).
const threads: Thread[] = seedThreads.map((t) => {
  const guest = guests.find((g) => g.guest_id === t.guest_id)!
  return {
    ...t,
    guest_name: `${guest.first_name} ${guest.last_name}`,
    host_name: hosts.find((h) => h.host_id === t.host_id)!.name,
    property_title: properties.find((p) => p.property_id === t.property_id)!.title,
  }
})
const messages: Message[] = structuredClone(seedMessages)

export const db = {
  hosts,
  guests,
  properties,
  reservations,
  availability,
  saved,
  reviews,
  threads,
  messages,
  bookingBlockIds,
  // idempotency_key -> reservation_id: a repeated booking action returns the first result.
  idempotencyKeys: new Map<string, string>(),
  // idempotency_key -> message_id: a repeated send returns the first message.
  messageKeys: new Map<string, string>(),
}

// The Booking Service's daily job (contract booking rule 6, team decisions M1a/M2a):
//  - approved stays whose check-out day has come become "completed" (so they can be reviewed)
//  - pending requests whose check-in date has passed expire to "declined" and free their dates
// The mock runs it before every API call, so a long demo behaves like the real service.
export function runBookingJob() {
  const now = today()
  for (const r of db.reservations) {
    if (r.status === 'approved' && r.check_out <= now) {
      r.status = 'completed'
    } else if (r.status === 'pending' && r.check_in < now) {
      r.status = 'declined'
      r.cancellation_reason = 'Expired: the host didn’t respond before check-in.'
      const blockId = db.bookingBlockIds.get(r.reservation_id)
      const index = db.availability.findIndex((a) => a.availability_id === blockId)
      if (index !== -1) db.availability.splice(index, 1)
      db.bookingBlockIds.delete(r.reservation_id)
    }
  }
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
