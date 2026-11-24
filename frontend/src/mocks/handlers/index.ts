// All mock handlers, in one list. MSW tries them in order and uses the first match.
import { http } from 'msw'
import { errorResponse } from '../responses'
import { aiHandlers } from './ai'
import { bookingHandlers } from './bookings'
import { propertyHandlers } from './properties'
import { userHandlers } from './users'

export const handlers = [
  ...userHandlers,
  ...propertyHandlers,
  ...bookingHandlers,
  ...aiHandlers,

  // Last: any other POST is an endpoint we haven't mocked yet. Answer with a clear
  // 404 instead of letting it fall through to the dev server.
  http.post('*', ({ request }) =>
    errorResponse('NOT_FOUND', `No mock for POST ${new URL(request.url).pathname} yet.`),
  ),
]
