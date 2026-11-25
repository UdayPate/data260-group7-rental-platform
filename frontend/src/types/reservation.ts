// "processing" = accepted by the API, waiting for the booking worker (Kafka); the worker moves it
// to "pending" (dates held) or "failed" (see failure_code). Async booking, team decisions B1a–B6a.
export type ReservationStatus = 'processing' | 'pending' | 'approved' | 'declined' | 'cancelled' | 'completed' | 'failed'

// Why the booking worker couldn't hold the dates (only set when status is "failed").
export type BookingFailureCode = 'DATE_CONFLICT' | 'DUPLICATE_BOOKING'

export type PriceBreakdown = {
  nights: number
  nightly_price: number
  subtotal: number // nights x nightly_price
  cleaning_fee: number
  total: number // subtotal + cleaning_fee
}

// Spec section 4: Reservation.
export type Reservation = {
  reservation_id: string
  trace_id: string // set by the Booking Service when the request arrives; follows the whole journey (C2a)
  property_id: string
  guest_id: string
  check_in: string // date
  check_out: string // date (the guest leaves this day, so it's not a night)
  guest_count: number
  price_breakdown: PriceBreakdown
  booking_datetime: string
  status: ReservationStatus
  cancellation_reason: string | null // also the readable reason when status is "failed"
  failure_code: BookingFailureCode | null // set only when status is "failed"
  guest_message: string | null
}

// --- Request bodies (Booking Service, /bookings/*) ---
// The acting user's id is sent in the body, and the service checks it matches the login token.
// idempotency_key: a new random id per user action; resending the same key returns the first result.

export type RequestBookingRequest = {
  property_id: string
  guest_id: string
  check_in: string
  check_out: string
  guest_count: number
  guest_message?: string
  idempotency_key: string
}

export type GetBookingRequest = { reservation_id: string }

export type BookingsByPropertyRequest = { property_id: string; status?: ReservationStatus }
export type BookingsByGuestRequest = { guest_id: string; status?: ReservationStatus }

export type ApproveBookingRequest = { reservation_id: string; host_id: string; idempotency_key: string }

export type DeclineBookingRequest = {
  reservation_id: string
  host_id: string
  reason?: string
  idempotency_key: string
}

// Exactly one of guest_id / host_id is sent, depending on who cancels.
export type CancelBookingRequest = {
  reservation_id: string
  guest_id?: string
  host_id?: string
  cancellation_reason: string // required when the host cancels
  idempotency_key: string
}
