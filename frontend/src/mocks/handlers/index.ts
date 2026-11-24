// All mock handlers, in one list. MSW tries them in order and uses the first match.
import { http } from 'msw'
import { runBookingJob } from '../db'
import { errorResponse } from '../responses'
import { aiHandlers } from './ai'
import { analyticsHandlers } from './analytics'
import { bookingHandlers } from './bookings'
import { messagingHandlers } from './messaging'
import { propertyHandlers } from './properties'
import { reviewHandlers } from './reviews'
import { userHandlers } from './users'

export const handlers = [
  // First: before every API call (all POSTs, plus the analytics GETs), run the Booking
  // Service's "daily job" (complete finished stays, expire old pending requests).
  // Returning nothing lets MSW carry on to the real handler below.
  http.post('*', () => {
    runBookingJob()
  }),
  http.get('*/analytics/*', () => {
    runBookingJob()
  }),

  ...userHandlers,
  ...propertyHandlers,
  ...bookingHandlers,
  ...aiHandlers,
  ...reviewHandlers,
  ...messagingHandlers,
  ...analyticsHandlers,

  // Last: any other POST is an endpoint we haven't mocked yet. Answer with a clear
  // 404 instead of letting it fall through to the dev server.
  http.post('*', ({ request }) =>
    errorResponse('NOT_FOUND', `No mock for POST ${new URL(request.url).pathname} yet.`),
  ),
]
