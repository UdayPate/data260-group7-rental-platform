// Mock Property Service WebSocket: /properties/{property_id}/availability/stream (spec 13.4).
// Sends every block added to or removed from that property while the socket is open.
// Nothing is sent on connect: the page reads the calendar with POST /properties/availability.
// Public (logged-out visitors see live updates too), but a token that is sent must be valid.
import { ws } from 'msw'
import { socketClaims } from '../auth/gate'
import { subscribeAvailability } from '../availability/bus'
import { db } from '../db'

const availabilityStream = ws.link(/\/properties\/[^/]+\/availability\/stream/)

// addEventListener returns the handler that goes in the handlers list.
export const availabilityStreamHandler = availabilityStream.addEventListener('connection', async ({ client }) => {
  if (client.url.searchParams.has('token') && !(await socketClaims(client.url))) {
    client.close(4401, 'Invalid or expired token')
    return
  }
  const propertyId = decodeURIComponent(client.url.pathname.split('/')[2] ?? '')
  if (!db.properties.some((p) => p.property_id === propertyId)) {
    client.close(4404, 'No property with this id') // 4000+ = the page should not retry
    return
  }
  const unsubscribe = subscribeAvailability(propertyId, (event) => client.send(JSON.stringify(event)))
  client.addEventListener('close', unsubscribe)
})
