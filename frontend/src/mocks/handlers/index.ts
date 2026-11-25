// All mock handlers, in one list. MSW tries them in order and uses the first match.
import { http } from 'msw'
import { apiBaseUrls } from '../../config'
import { authGate } from '../auth/gate'
import { runBookingJob } from '../db'
import { errorResponse } from '../responses'
import { aiHandlers } from './ai'
import { analyticsHandlers } from './analytics'
import { authHandlers } from './auth'
import { availabilityStreamHandler } from './availability'
import { bookingHandlers } from './bookings'
import { messagingHandlers } from './messaging'
import { propertyHandlers } from './properties'
import { reviewHandlers } from './reviews'
import { userHandlers } from './users'

// One service at a time can be switched to its real backend: set its VITE_..._API_BASE_URL
// (e.g. VITE_PROPERTY_API_BASE_URL=http://localhost:8002) and its mocks below are left out,
// so its requests go to the real server. A service whose URL is empty stays mocked.
const mocked = (service: keyof typeof apiBaseUrls) => apiBaseUrls[service] === ''

export const handlers = [
  // First of all: the token check (401 / 403) in front of every endpoint, like the
  // shared helper each real service runs. See mocks/auth/gate.ts.
  authGate,

  // Then: before every API call (all POSTs, plus the analytics GETs), run the Booking
  // Service's "daily job" (complete finished stays, expire old pending requests).
  // Returning nothing lets MSW carry on to the real handler below.
  http.post('*', () => {
    runBookingJob()
  }),
  http.get('*/analytics/*', () => {
    runBookingJob()
  }),

  ...(mocked('users') ? [...authHandlers, ...userHandlers] : []), // log in / sign up belong to the User Service
  ...(mocked('properties') ? [...propertyHandlers, availabilityStreamHandler] : []),
  ...(mocked('bookings') ? bookingHandlers : []),
  ...(mocked('ai') ? aiHandlers : []),
  ...(mocked('reviews') ? reviewHandlers : []),
  ...(mocked('messaging') ? messagingHandlers : []),
  ...(mocked('analytics') ? analyticsHandlers : []),

  // Last: any other POST is an endpoint we haven't mocked yet. Answer with a clear
  // 404 instead of letting it fall through to the dev server.
  // (Only for this site's own address: a POST to a real service's address goes through.)
  http.post('*', ({ request }) => {
    const url = new URL(request.url)
    if (typeof location !== 'undefined' && url.origin !== location.origin) return
    return errorResponse('NOT_FOUND', `No mock for POST ${url.pathname} yet.`)
  }),
]
