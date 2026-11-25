// Mock of the availability push (spec 13.4), shared across browser tabs.
//
// Each tab runs its OWN mock server with its own in-memory database. To demo two guests in
// two tabs, the tabs talk over a BroadcastChannel (a browser feature that sends messages
// between tabs of the same site):
//
//   tab B: guest B requests dates -> publishAvailability(event)
//          -> sent to tab B's own open sockets
//          -> posted on the channel
//   tab A: the channel delivers it -> the block is copied into tab A's database (team
//          decision R3a, so tab A's server really answers 409) -> sent to tab A's sockets
//
// The real Property Service does this with Kafka and one database; nothing here is copied there.
import type { AvailabilityBlock, AvailabilityChangeReason, AvailabilityEvent, AvailabilityEventType } from '../../types/availability'
import { db } from '../db'

type Listener = (event: AvailabilityEvent) => void

// property_id -> the sockets open in THIS tab for that property
const listeners = new Map<string, Set<Listener>>()

export function subscribeAvailability(propertyId: string, listener: Listener): () => void {
  if (!listeners.has(propertyId)) listeners.set(propertyId, new Set())
  listeners.get(propertyId)!.add(listener)
  return () => listeners.get(propertyId)?.delete(listener)
}

function deliver(event: AvailabilityEvent) {
  for (const listener of listeners.get(event.entity.entity_id) ?? []) listener(event)
}

// Only in a browser (the mock tests run in Node, with a single "tab").
const channel = typeof window === 'undefined' ? null : new BroadcastChannel('xenia-mock-availability')

// Called by the mock services right after they add or remove a block.
export function publishAvailability(
  eventType: AvailabilityEventType,
  block: AvailabilityBlock,
  reason: AvailabilityChangeReason,
  traceId: string,
) {
  const event: AvailabilityEvent = {
    event_type: eventType,
    trace_id: traceId,
    timestamp: new Date().toISOString(),
    actor_id: reason.startsWith('booking') ? 'booking-service' : 'property-service',
    entity: { entity_type: 'property', entity_id: block.property_id },
    payload: { block, reason },
    idempotency_key: `${traceId}:${block.availability_id}:${eventType}`, // unique per change, even if an id is reused
  }
  deliver(event)
  channel?.postMessage(event)
}

// An event from another tab: apply it to this tab's database, then pass it on.
if (channel) {
  channel.onmessage = (message: MessageEvent<AvailabilityEvent>) => {
    const event = message.data
    const block = event.payload.block
    const index = db.availability.findIndex((a) => a.availability_id === block.availability_id)
    if (event.event_type === 'availability.blocked' && index === -1) db.availability.push(block)
    if (event.event_type === 'availability.released' && index !== -1) db.availability.splice(index, 1)
    deliver(event)
  }
}
