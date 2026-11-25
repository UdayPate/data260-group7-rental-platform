// Mock of the Booking Service's Kafka worker (async booking, team decisions B1a–B6a).
//
// The real flow: POST /bookings/request saves the reservation as "processing", publishes
// booking.requested and answers 202. The worker consumes the event and, in one database
// transaction, either holds the dates (status "pending") or marks it "failed" with a reason.
//
// Here: the API puts the reservation id in a queue; WORKER_DELAY_MS later this "worker"
// processes it. "Pause the booking worker" (the Mock data menu in the header) stops processing,
// like stopping the consumer for the spec 13.2 demo: requests wait as "processing", and on
// resume they are processed in order, each exactly once.
//
// Browser windows: the paused/running switch is shared by all windows (mocks/sync.ts). Each
// request is processed by the window that accepted it; that window keeps its queue in
// sessionStorage, so a reload doesn't lose it.
import type { Reservation } from '../types/reservation'
import { publishAvailability } from './availability/bus'
import { rangesOverlap } from './dates'
import { db, hasDateConflict, holdsDates, nextId } from './db'

export const WORKER_DELAY_MS = 2500 // long enough to see "Processing…" in a demo

// Shared with the other windows by mocks/sync.ts.
export const workerState = { paused: false }

const QUEUE_KEY = 'xenia.mock-booking-queue'
const canStore = typeof sessionStorage !== 'undefined'
// Reservation ids waiting for this window's worker, oldest first.
const queue: string[] = canStore ? JSON.parse(sessionStorage.getItem(QUEUE_KEY) ?? '[]') : []
const saveQueue = () => canStore && sessionStorage.setItem(QUEUE_KEY, JSON.stringify(queue))

// Called after the worker changed data (mocks/browser.ts shares it with the other windows).
let afterWork: () => void = () => {}
export function setAfterWork(callback: () => void) {
  afterWork = callback
}

let timer: ReturnType<typeof setTimeout> | null = null

// Process the next queued request after the worker delay (unless paused or already scheduled).
function scheduleNext() {
  if (timer || workerState.paused || queue.length === 0) return
  timer = setTimeout(() => {
    timer = null
    if (workerState.paused) return
    const id = queue.shift()
    saveQueue()
    if (id) processRequest(id)
    afterWork()
    scheduleNext()
  }, WORKER_DELAY_MS)
}

// The API calls this after saving a "processing" reservation.
export function enqueueBookingRequest(reservationId: string) {
  queue.push(reservationId)
  saveQueue()
  scheduleNext()
}

export function setWorkerPaused(paused: boolean) {
  workerState.paused = paused
  if (paused && timer) {
    clearTimeout(timer)
    timer = null
  }
  scheduleNext()
}

// Another window switched the worker on or off (mocks/sync.ts): resume this window's queue.
export function workerStateChanged() {
  if (workerState.paused && timer) {
    clearTimeout(timer)
    timer = null
  }
  scheduleNext()
}

export const queuedCount = () => queue.length

// The worker's job for one request. Idempotent: a reservation that is no longer "processing"
// (already handled, e.g. a redelivered event) is left alone.
export function processRequest(reservationId: string) {
  const reservation = db.reservations.find((r) => r.reservation_id === reservationId)
  if (!reservation || reservation.status !== 'processing') return

  // Same guest already holds overlapping dates at this property (an earlier request).
  const duplicate = db.reservations.find(
    (r) =>
      r.reservation_id !== reservation.reservation_id &&
      r.guest_id === reservation.guest_id &&
      r.property_id === reservation.property_id &&
      holdsDates(r) &&
      rangesOverlap(r.check_in, r.check_out, reservation.check_in, reservation.check_out),
  )
  if (duplicate) {
    fail(reservation, 'DUPLICATE_BOOKING', `You already have a request for these dates at this place (${duplicate.reservation_id}).`)
    return
  }
  // In the real worker this check and the hold below are ONE database transaction
  // (a unique key per property and night), so two requests can never both succeed.
  if (hasDateConflict(reservation.property_id, reservation.check_in, reservation.check_out)) {
    fail(reservation, 'DATE_CONFLICT', 'Some of these dates are no longer available. Please pick other dates.')
    return
  }

  const block = {
    availability_id: nextId('a', db.availability.map((a) => a.availability_id)),
    property_id: reservation.property_id,
    start_date: reservation.check_in,
    end_date: reservation.check_out,
    status: 'booked' as const,
    source: 'booking' as const,
    updated_datetime: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  }
  db.availability.push(block)
  db.bookingBlockIds.set(reservation.reservation_id, block.availability_id)
  reservation.status = 'pending'
  // Live update for everyone viewing this property (spec 13.4), sent when the dates are held (B6a).
  publishAvailability('availability.blocked', block, 'booking_requested', reservation.trace_id)
}

function fail(reservation: Reservation, code: 'DATE_CONFLICT' | 'DUPLICATE_BOOKING', message: string) {
  reservation.status = 'failed'
  reservation.failure_code = code
  reservation.cancellation_reason = message
}

// Start working through anything this window had queued before a reload.
scheduleNext()
