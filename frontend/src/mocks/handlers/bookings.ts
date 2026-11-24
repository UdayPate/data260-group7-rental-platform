// Mock Booking Service: /bookings/*
// Rules (team decisions, see docs/api/data-contract.md):
//  - pending and approved reservations hold their dates; decline/cancel frees them
//  - only the listing's host approves/declines, and only while pending
//  - the guest cancels pending/approved before check-in; the host cancels approved before check-in, with a reason
//  - the same idempotency_key twice returns the first result instead of acting twice
import { delay, http, HttpResponse } from 'msw'
import type { AvailabilityChangeReason } from '../../types/availability'
import type { Reservation, ReservationStatus } from '../../types/reservation'
import { publishAvailability } from '../availability/bus'
import { isValidDate, nowDatetime, rangesOverlap, today } from '../dates'
import { db, hasDateConflict, holdsDates, nextId, priceBreakdown } from '../db'
import { errorResponse, invalidJsonResponse, MOCK_DELAY_MS, readBody, requireFields } from '../responses'

const reservationNotFound = (id: unknown) => errorResponse('NOT_FOUND', `No reservation found with id ${String(id)}.`)

// If this idempotency key was already used, returns the reservation it produced.
function alreadyDone(key: unknown): Reservation | undefined {
  const reservationId = db.idempotencyKeys.get(String(key))
  return db.reservations.find((r) => r.reservation_id === reservationId)
}

// Frees the reservation's dates by removing its "booked" availability block,
// and tells everyone viewing the property (spec 13.4).
function releaseDates(reservation: Reservation, reason: AvailabilityChangeReason) {
  const blockId = db.bookingBlockIds.get(reservation.reservation_id)
  const index = db.availability.findIndex((a) => a.availability_id === blockId)
  if (index !== -1) {
    const [block] = db.availability.splice(index, 1)
    publishAvailability('availability.released', block, reason, reservation.trace_id)
  }
  db.bookingBlockIds.delete(reservation.reservation_id)
}

const hostOf = (reservation: Reservation) =>
  db.properties.find((p) => p.property_id === reservation.property_id)?.host_id

const STATUSES: ReservationStatus[] = ['pending', 'approved', 'declined', 'cancelled', 'completed']

export const bookingHandlers = [
  http.post('*/bookings/request', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['property_id', 'guest_id', 'check_in', 'check_out', 'guest_count', 'idempotency_key'])
    if (missing) return missing

    // A retry of a request we already handled: return the same reservation, don't create another.
    const previous = alreadyDone(body.idempotency_key)
    if (previous) return HttpResponse.json(previous)

    const { check_in, check_out } = body
    if (!isValidDate(check_in) || !isValidDate(check_out)) {
      return errorResponse('VALIDATION_ERROR', 'Dates must be real dates in YYYY-MM-DD format.')
    }
    if (check_in < today()) return errorResponse('VALIDATION_ERROR', 'Check-in can’t be in the past.')
    if (check_out <= check_in) return errorResponse('VALIDATION_ERROR', 'Check-out must be after check-in.')
    if (!Number.isInteger(body.guest_count) || (body.guest_count as number) < 1) {
      return errorResponse('VALIDATION_ERROR', 'Number of guests must be a whole number of at least 1.')
    }

    const property = db.properties.find((p) => p.property_id === body.property_id)
    if (!property) return errorResponse('NOT_FOUND', `No property found with id ${String(body.property_id)}.`)
    if (property.status !== 'active') {
      return errorResponse('INVALID_STATUS', 'This listing isn’t taking bookings right now.')
    }
    const guest = db.guests.find((g) => g.guest_id === body.guest_id)
    if (!guest) return errorResponse('NOT_FOUND', `No guest found with id ${String(body.guest_id)}.`)
    if ((body.guest_count as number) > property.capacity) {
      return errorResponse('VALIDATION_ERROR', `This place fits at most ${property.capacity} guest(s).`)
    }

    // Same guest already has an active request for these dates (sent with a different key).
    const duplicate = db.reservations.find(
      (r) =>
        r.guest_id === guest.guest_id &&
        r.property_id === property.property_id &&
        holdsDates(r) &&
        rangesOverlap(r.check_in, r.check_out, check_in, check_out),
    )
    if (duplicate) {
      return errorResponse('DUPLICATE_BOOKING', 'You already have a request for these dates at this place.', {
        reservation_id: duplicate.reservation_id,
      })
    }
    if (hasDateConflict(property.property_id, check_in, check_out)) {
      return errorResponse('DATE_CONFLICT', 'Some of these dates are no longer available. Please pick other dates.')
    }

    const reservation: Reservation = {
      reservation_id: nextId('r', db.reservations.map((r) => r.reservation_id)),
      trace_id: crypto.randomUUID(), // starts this booking's journey (C2a)
      property_id: property.property_id,
      guest_id: guest.guest_id,
      check_in,
      check_out,
      guest_count: body.guest_count as number,
      price_breakdown: priceBreakdown(property, check_in, check_out),
      booking_datetime: nowDatetime(),
      status: 'pending',
      cancellation_reason: null,
      guest_message: typeof body.guest_message === 'string' && body.guest_message !== '' ? body.guest_message : null,
    }
    db.reservations.push(reservation)

    // Hold the dates (pending requests block them too).
    const block = {
      availability_id: nextId('a', db.availability.map((a) => a.availability_id)),
      property_id: property.property_id,
      start_date: check_in,
      end_date: check_out,
      status: 'booked' as const,
      source: 'booking' as const,
      updated_datetime: reservation.booking_datetime,
    }
    db.availability.push(block)
    db.bookingBlockIds.set(reservation.reservation_id, block.availability_id)
    // Live update for everyone viewing this property (spec 13.4), in this booking's journey.
    publishAvailability('availability.blocked', block, 'booking_requested', reservation.trace_id)
    db.idempotencyKeys.set(String(body.idempotency_key), reservation.reservation_id)
    guest.booking_count += 1

    return HttpResponse.json(reservation, { status: 201 })
  }),

  http.post('*/bookings/get', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['reservation_id'])
    if (missing) return missing
    const reservation = db.reservations.find((r) => r.reservation_id === body.reservation_id)
    return reservation ? HttpResponse.json(reservation) : reservationNotFound(body.reservation_id)
  }),

  http.post('*/bookings/byProperty', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['property_id'])
    if (missing) return missing
    if (body.status !== undefined && !STATUSES.includes(body.status as ReservationStatus)) {
      return errorResponse('VALIDATION_ERROR', `status must be one of: ${STATUSES.join(', ')}.`)
    }
    if (!db.properties.some((p) => p.property_id === body.property_id)) {
      return errorResponse('NOT_FOUND', `No property found with id ${String(body.property_id)}.`)
    }
    const items = db.reservations.filter(
      (r) => r.property_id === body.property_id && (body.status === undefined || r.status === body.status),
    )
    return HttpResponse.json({ items })
  }),

  http.post('*/bookings/byGuest', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['guest_id'])
    if (missing) return missing
    if (body.status !== undefined && !STATUSES.includes(body.status as ReservationStatus)) {
      return errorResponse('VALIDATION_ERROR', `status must be one of: ${STATUSES.join(', ')}.`)
    }
    if (!db.guests.some((g) => g.guest_id === body.guest_id)) {
      return errorResponse('NOT_FOUND', `No guest found with id ${String(body.guest_id)}.`)
    }
    const items = db.reservations.filter(
      (r) => r.guest_id === body.guest_id && (body.status === undefined || r.status === body.status),
    )
    return HttpResponse.json({ items })
  }),

  http.post('*/bookings/approve', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['reservation_id', 'host_id', 'idempotency_key'])
    if (missing) return missing
    const previous = alreadyDone(body.idempotency_key)
    if (previous) return HttpResponse.json(previous)

    const reservation = db.reservations.find((r) => r.reservation_id === body.reservation_id)
    if (!reservation) return reservationNotFound(body.reservation_id)
    if (hostOf(reservation) !== body.host_id) {
      return errorResponse('UNAUTHORIZED', 'Only the host of this listing can approve this request.')
    }
    if (reservation.status !== 'pending') {
      return errorResponse('INVALID_STATUS', `This reservation is already ${reservation.status}, so it can’t be approved.`)
    }

    reservation.status = 'approved' // dates stay held
    db.idempotencyKeys.set(String(body.idempotency_key), reservation.reservation_id)
    return HttpResponse.json(reservation)
  }),

  http.post('*/bookings/decline', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['reservation_id', 'host_id', 'idempotency_key'])
    if (missing) return missing
    const previous = alreadyDone(body.idempotency_key)
    if (previous) return HttpResponse.json(previous)

    const reservation = db.reservations.find((r) => r.reservation_id === body.reservation_id)
    if (!reservation) return reservationNotFound(body.reservation_id)
    if (hostOf(reservation) !== body.host_id) {
      return errorResponse('UNAUTHORIZED', 'Only the host of this listing can decline this request.')
    }
    if (reservation.status !== 'pending') {
      return errorResponse('INVALID_STATUS', `This reservation is already ${reservation.status}, so it can’t be declined.`)
    }

    reservation.status = 'declined'
    reservation.cancellation_reason = typeof body.reason === 'string' && body.reason !== '' ? body.reason : null
    releaseDates(reservation, 'booking_declined')
    db.idempotencyKeys.set(String(body.idempotency_key), reservation.reservation_id)
    return HttpResponse.json(reservation)
  }),

  http.post('*/bookings/cancel', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['reservation_id', 'idempotency_key'])
    if (missing) return missing
    const previous = alreadyDone(body.idempotency_key)
    if (previous) return HttpResponse.json(previous)

    const byGuest = body.guest_id !== undefined
    const byHost = body.host_id !== undefined
    if (byGuest === byHost) {
      return errorResponse('VALIDATION_ERROR', 'Send exactly one of guest_id or host_id to say who is cancelling.')
    }

    const reservation = db.reservations.find((r) => r.reservation_id === body.reservation_id)
    if (!reservation) return reservationNotFound(body.reservation_id)

    const reason = typeof body.cancellation_reason === 'string' ? body.cancellation_reason.trim() : ''
    if (byGuest) {
      if (reservation.guest_id !== body.guest_id) {
        return errorResponse('UNAUTHORIZED', 'You can only cancel your own reservations.')
      }
      if (!holdsDates(reservation)) {
        return errorResponse('INVALID_STATUS', `This reservation is already ${reservation.status}, so it can’t be cancelled.`)
      }
    } else {
      if (hostOf(reservation) !== body.host_id) {
        return errorResponse('UNAUTHORIZED', 'Only the host of this listing can cancel this reservation.')
      }
      if (reservation.status !== 'approved') {
        return errorResponse('INVALID_STATUS', 'Hosts can only cancel approved reservations. Decline pending requests instead.')
      }
      if (reason === '') return errorResponse('VALIDATION_ERROR', 'Please give the guest a reason for cancelling.')
    }
    if (reservation.check_in <= today()) {
      return errorResponse('INVALID_STATUS', 'Reservations can only be cancelled before the check-in day.')
    }

    reservation.status = 'cancelled'
    reservation.cancellation_reason = reason === '' ? null : reason
    releaseDates(reservation, 'booking_cancelled')
    db.idempotencyKeys.set(String(body.idempotency_key), reservation.reservation_id)
    return HttpResponse.json(reservation)
  }),
]
