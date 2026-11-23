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
