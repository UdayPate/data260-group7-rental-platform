// Booking Service: /bookings/*
import { apiBaseUrls } from '../config'
import type { ListResponse } from '../types/api'
import type {
  ApproveBookingRequest,
  BookingsByGuestRequest,
  BookingsByPropertyRequest,
  CancelBookingRequest,
  DeclineBookingRequest,
  GetBookingRequest,
  RequestBookingRequest,
  Reservation,
} from '../types/reservation'
import { post } from './client'

const base = apiBaseUrls.bookings

export const requestBooking = (body: RequestBookingRequest) => post<Reservation>(base, '/bookings/request', body)
export const getBooking = (body: GetBookingRequest) => post<Reservation>(base, '/bookings/get', body)
export const bookingsByProperty = (body: BookingsByPropertyRequest) =>
  post<ListResponse<Reservation>>(base, '/bookings/byProperty', body)
export const bookingsByGuest = (body: BookingsByGuestRequest) =>
  post<ListResponse<Reservation>>(base, '/bookings/byGuest', body)
export const approveBooking = (body: ApproveBookingRequest) => post<Reservation>(base, '/bookings/approve', body)
export const declineBooking = (body: DeclineBookingRequest) => post<Reservation>(base, '/bookings/decline', body)
export const cancelBooking = (body: CancelBookingRequest) => post<Reservation>(base, '/bookings/cancel', body)

// A fresh idempotency key for one user action (e.g. one click on "Request to book").
// Reuse the same key when retrying that action, so the server doesn't create it twice.
export const newIdempotencyKey = () => crypto.randomUUID()
