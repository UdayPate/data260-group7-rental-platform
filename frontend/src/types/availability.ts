export type AvailabilityStatus = 'available' | 'blocked' | 'booked'
export type AvailabilitySource = 'host' | 'booking' | 'system'

// Spec section 4: Availability block. end_date is the day the block ends
// (exclusive, like check_out): a block 12-04 to 12-06 covers the nights of the 4th and 5th.
export type AvailabilityBlock = {
  availability_id: string
  property_id: string
  start_date: string
  end_date: string
  status: AvailabilityStatus
  source: AvailabilitySource
  updated_datetime: string
}

// --- Request bodies (Property Service, /properties/availability) ---
// One endpoint, three actions (team decision C1a). "get" is the default.

export type GetAvailabilityRequest = {
  action?: 'get'
  property_id: string
  start_date: string
  end_date: string
}

// Host closes a date range. Fails with 409 if any of those nights is already blocked or booked.
export type BlockDatesRequest = {
  action: 'block'
  property_id: string
  host_id: string // must own the listing
  start_date: string
  end_date: string // exclusive, like check-out
}

// Host reopens one of their own blocks (source "host"). Booking blocks can't be unblocked.
export type UnblockDatesRequest = {
  action: 'unblock'
  availability_id: string
  host_id: string
}
export type UnblockDatesResponse = { availability_id: string; unblocked: true }

// --- Live updates (spec 13.4): WebSocket /properties/{property_id}/availability/stream ---
// Pushed to everyone viewing the property whenever one of its blocks is added or removed.
// Shared envelope (spec 6.2). trace_id is the reservation's (or a new one for a host block),
// so the push shows up in that booking's journey.

export type AvailabilityEventType = 'availability.blocked' | 'availability.released'

// Why the block changed, so the page can say "another guest" or "the host".
export type AvailabilityChangeReason =
  | 'booking_requested'
  | 'booking_declined'
  | 'booking_cancelled'
  | 'host_blocked'
  | 'host_unblocked'

export type AvailabilityEvent = {
  event_type: AvailabilityEventType
  trace_id: string
  timestamp: string // UTC, set when the service changed the block; latency is measured from here
  actor_id: string // the service that changed it ("booking-service" / "property-service"), never a guest id
  entity: { entity_type: 'property'; entity_id: string } // entity_id = property_id
  payload: { block: AvailabilityBlock; reason: AvailabilityChangeReason }
  idempotency_key: string // "<trace_id>:<availability_id>:<event_type>", so a repeat is ignored
}
