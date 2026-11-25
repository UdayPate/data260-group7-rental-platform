// Demo controls that exist ONLY in the mock server (frontend/src/mocks). The real backend has
// no such endpoint: there you stop the worker process (docker compose stop booking-worker).
import { get, post } from './client'

// The mock Booking Service's Kafka worker (spec 13.2 demo): paused requests stay "processing".
export type BookingWorkerState = {
  paused: boolean
  queued_here: number // requests this window's worker still has to process
  processing: number // all reservations still "processing", in every window
}

export const getBookingWorker = () => get<BookingWorkerState>('', '/__mock/booking-worker')
export const setBookingWorkerPaused = (paused: boolean) => post<BookingWorkerState>('', '/__mock/booking-worker', { paused })
