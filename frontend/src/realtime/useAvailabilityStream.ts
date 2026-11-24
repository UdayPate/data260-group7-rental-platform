// Keeps a property page's calendar live (spec 13.4) and measures how fast each update showed.
//
// The page owns the calendar blocks; this hook calls:
//   onEvent(event) - for every availability.blocked / availability.released, to update the blocks
//   onOpen()       - every time the socket opens, so the page re-reads the calendar (R7a)
//
// Latency (team decision R6a), three moments per update:
//   1. event.timestamp - the service changed the block (server clock)
//   2. receivedAt      - the WebSocket message arrived in this tab
//   3. shownAt         - React had put the change on the page
// Notification latency = shownAt - timestamp. Logged to the console and sent to analytics
// as availability.notified, in the booking's own trace_id.
import { useEffect, useRef, useState } from 'react'
import { trackEvent } from '../api/analytics'
import type { AvailabilityEvent } from '../types/availability'
import { openAvailabilityStream, type LiveStatus } from './availabilityStream'

export type LiveUpdate = {
  event: AvailabilityEvent
  receivedAt: number // ms since 1970, browser clock
  shownAt: number | null // null until the page has shown it
}

type Options = {
  propertyId: string
  viewerId: string // the guest looking at the page (for the analytics event)
  enabled: boolean // false until the page has loaded
  onEvent: (event: AvailabilityEvent) => void
  onOpen: () => void
}

export function notificationLatencyMs(update: LiveUpdate): number | null {
  return update.shownAt === null ? null : update.shownAt - Date.parse(update.event.timestamp)
}

function report(update: LiveUpdate, shownAt: number, viewerId: string) {
  const { event, receivedAt } = update
  const sentAt = Date.parse(event.timestamp)
  const latency = shownAt - sentAt
  console.log(
    `[availability] ${event.event_type} ${event.payload.block.start_date}→${event.payload.block.end_date} trace ${event.trace_id}: ` +
      `sent ${event.timestamp}, received ${new Date(receivedAt).toISOString()}, shown ${new Date(shownAt).toISOString()}, ` +
      `latency ${latency} ms (delivery ${receivedAt - sentAt} ms + page ${shownAt - receivedAt} ms)`,
  )
  trackEvent(
    'availability.notified',
    viewerId,
    event.entity,
    {
      event_type: event.event_type,
      availability_id: event.payload.block.availability_id,
      latency_ms: latency,
      delivery_ms: receivedAt - sentAt,
      render_ms: shownAt - receivedAt,
    },
    event.trace_id, // joins the booking's journey
  )
}

export function useAvailabilityStream({ propertyId, viewerId, enabled, onEvent, onOpen }: Options) {
  const [status, setStatus] = useState<LiveStatus>('connecting')
  const [updates, setUpdates] = useState<LiveUpdate[]>([]) // newest first

  // The latest callbacks, kept in a ref so a re-render of the page doesn't reopen the socket.
  const callbacks = useRef({ onEvent, onOpen })
  useEffect(() => {
    callbacks.current = { onEvent, onOpen }
  })

  useEffect(() => {
    if (!enabled) return
    const close = openAvailabilityStream({
      propertyId,
      onStatus: setStatus,
      onOpen: () => callbacks.current.onOpen(),
      onEvent: (event, receivedAt) => {
        // Both changes land in the same render: the page's calendar and this list.
        callbacks.current.onEvent(event)
        setUpdates((list) => [{ event, receivedAt, shownAt: null }, ...list])
      },
    })
    return close // closes the socket when the page goes away
  }, [propertyId, enabled])

  // useEffect runs after React has updated the page, so "now" is when the guest can see the change.
  useEffect(() => {
    const waiting = updates.filter((u) => u.shownAt === null)
    if (waiting.length === 0) return
    const shownAt = Date.now()
    for (const update of waiting) report(update, shownAt, viewerId)
    // One extra render on purpose, to display the measured time. It can't loop: after it,
    // no update is waiting any more, so this effect returns early.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setUpdates((list) => list.map((u) => (u.shownAt === null ? { ...u, shownAt } : u)))
  }, [updates, viewerId])

  return { status, updates }
}
