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

// --- Request body (Property Service, /properties/availability, read-only for now) ---

export type GetAvailabilityRequest = {
  property_id: string
  start_date: string
  end_date: string
}
