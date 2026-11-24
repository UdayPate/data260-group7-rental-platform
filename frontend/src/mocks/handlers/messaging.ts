// Mock Messaging Service: /threads/* and /messages/*
// Rules (team decisions, see docs/api/data-contract.md):
//  C1a one thread per guest + host + listing; only its two participants may use it (403)
//  C3a delivery: "sent" when stored, "delivered" when it shows in the receiver's thread list,
//      "read" when the receiver lists the thread's messages
//  C5a a host may only open a thread with a guest who has a reservation at that listing
import { delay, http, HttpResponse } from 'msw'
import { MESSAGE_TEXT_MAX, type Message, type Thread, type ThreadSummary } from '../../types/message'
import { nowDatetime } from '../dates'
import { db, nextId } from '../db'
import { errorResponse, invalidJsonResponse, MOCK_DELAY_MS, readBody, requireFields } from '../responses'

const threadNotFound = (id: unknown) => errorResponse('NOT_FOUND', `No conversation found with id ${String(id)}.`)
const notParticipant = () => errorResponse('UNAUTHORIZED', 'Only the guest and host in this conversation can see it.')
const isParticipant = (t: Thread, userId: unknown) => t.guest_id === userId || t.host_id === userId
const userExists = (id: unknown) => db.guests.some((g) => g.guest_id === id) || db.hosts.some((h) => h.host_id === id)

// The thread as one user sees it: last message + their unread count.
function summarize(t: Thread, userId: string): ThreadSummary {
  const inThread = db.messages.filter((m) => m.thread_id === t.thread_id)
  const last = inThread.reduce<Message | null>((latest, m) => (!latest || m.timestamp > latest.timestamp ? m : latest), null)
  return {
    ...t,
    last_message: last ? { text: last.message_text, timestamp: last.timestamp, sender_id: last.sender_id } : null,
    unread_count: inThread.filter((m) => m.receiver_id === userId && m.delivery_status !== 'read').length,
  }
}

const lastActivity = (s: ThreadSummary) => s.last_message?.timestamp ?? s.created_datetime

export const messagingHandlers = [
  http.post('*/threads/open', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['guest_id', 'host_id', 'property_id', 'actor_id'])
    if (missing) return missing
    const guest = db.guests.find((g) => g.guest_id === body.guest_id)
    if (!guest) return errorResponse('NOT_FOUND', `No guest found with id ${String(body.guest_id)}.`)
    const host = db.hosts.find((h) => h.host_id === body.host_id)
    if (!host) return errorResponse('NOT_FOUND', `No host found with id ${String(body.host_id)}.`)
    const property = db.properties.find((p) => p.property_id === body.property_id)
    if (!property) return errorResponse('NOT_FOUND', `No property found with id ${String(body.property_id)}.`)
    if (property.host_id !== host.host_id) return errorResponse('VALIDATION_ERROR', 'That host doesn’t host this listing.')
    if (body.actor_id !== guest.guest_id && body.actor_id !== host.host_id) {
      return errorResponse('UNAUTHORIZED', 'Only the guest or the host can open this conversation.')
    }
    // C5a: hosts can't cold-message guests.
    const hasBooked = db.reservations.some((r) => r.guest_id === guest.guest_id && r.property_id === property.property_id)
    if (body.actor_id === host.host_id && !hasBooked) {
      return errorResponse('UNAUTHORIZED', 'You can only message guests who have a reservation at this listing.')
    }
    let reservationId: string | null = null
    if (body.reservation_id !== undefined) {
      const reservation = db.reservations.find((r) => r.reservation_id === body.reservation_id)
      if (!reservation || reservation.guest_id !== guest.guest_id || reservation.property_id !== property.property_id) {
        return errorResponse('VALIDATION_ERROR', 'That reservation doesn’t belong to this guest and listing.')
      }
      reservationId = reservation.reservation_id
    }

    const existing = db.threads.find(
      (t) => t.guest_id === guest.guest_id && t.host_id === host.host_id && t.property_id === property.property_id,
    )
    if (existing) {
      if (reservationId) existing.reservation_id = reservationId // remember the latest reservation
      return HttpResponse.json(summarize(existing, String(body.actor_id)))
    }
    const thread: Thread = {
      thread_id: nextId('t', db.threads.map((t) => t.thread_id)),
      guest_id: guest.guest_id,
      host_id: host.host_id,
      property_id: property.property_id,
      reservation_id: reservationId,
      created_datetime: nowDatetime(),
      guest_name: `${guest.first_name} ${guest.last_name}`,
      host_name: host.name,
      property_title: property.title,
    }
    db.threads.push(thread)
    return HttpResponse.json(summarize(thread, String(body.actor_id)), { status: 201 })
  }),

  http.post('*/threads/get', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['thread_id', 'user_id'])
    if (missing) return missing
    const thread = db.threads.find((t) => t.thread_id === body.thread_id)
    if (!thread) return threadNotFound(body.thread_id)
    if (!isParticipant(thread, body.user_id)) return notParticipant()
    return HttpResponse.json(summarize(thread, String(body.user_id)))
  }),

  http.post('*/threads/byUser', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['user_id'])
    if (missing) return missing
    if (!userExists(body.user_id)) return errorResponse('NOT_FOUND', `No guest or host found with id ${String(body.user_id)}.`)
    // C3a: messages that now appear in the receiver's list are "delivered".
    for (const m of db.messages) {
      if (m.receiver_id === body.user_id && m.delivery_status === 'sent') m.delivery_status = 'delivered'
    }
    const items = db.threads
      .filter((t) => isParticipant(t, body.user_id))
      .map((t) => summarize(t, String(body.user_id)))
      .sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)))
    return HttpResponse.json({ items })
  }),

  http.post('*/messages/list', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['thread_id', 'user_id'])
    if (missing) return missing
    const thread = db.threads.find((t) => t.thread_id === body.thread_id)
    if (!thread) return threadNotFound(body.thread_id)
    if (!isParticipant(thread, body.user_id)) return notParticipant()
    const items = db.messages.filter((m) => m.thread_id === thread.thread_id)
    // C3a: the receiver opened the conversation, so their incoming messages are "read".
    for (const m of items) if (m.receiver_id === body.user_id) m.delivery_status = 'read'
    items.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    return HttpResponse.json({ items })
  }),

  http.post('*/messages/send', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['thread_id', 'sender_id', 'message_text', 'idempotency_key'])
    if (missing) return missing
    // A retry of a send we already handled: return the same message.
    const previousId = db.messageKeys.get(String(body.idempotency_key))
    const previous = db.messages.find((m) => m.message_id === previousId)
    if (previous) return HttpResponse.json(previous)

    const text = String(body.message_text).trim()
    if (text.length === 0) return errorResponse('VALIDATION_ERROR', 'Type a message first.')
    if (text.length > MESSAGE_TEXT_MAX) {
      return errorResponse('VALIDATION_ERROR', `Messages can be at most ${MESSAGE_TEXT_MAX} characters.`)
    }
    const thread = db.threads.find((t) => t.thread_id === body.thread_id)
    if (!thread) return threadNotFound(body.thread_id)
    if (!isParticipant(thread, body.sender_id)) return notParticipant()

    const message: Message = {
      message_id: nextId('m', db.messages.map((m) => m.message_id)),
      thread_id: thread.thread_id,
      sender_id: String(body.sender_id),
      receiver_id: thread.guest_id === body.sender_id ? thread.host_id : thread.guest_id,
      timestamp: new Date().toISOString(),
      message_text: text,
      delivery_status: 'sent',
    }
    db.messages.push(message)
    db.messageKeys.set(String(body.idempotency_key), message.message_id)
    return HttpResponse.json(message, { status: 201 })
  }),
]
