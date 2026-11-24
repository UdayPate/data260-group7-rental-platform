// Human-readable names for the values in the data contract, and small formatting helpers.
import type { AvailabilityChangeReason } from './types/availability'
import type { Amenity, PropertyType } from './types/property'

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  house: 'House',
  apartment: 'Apartment',
  condo: 'Condo',
  townhouse: 'Townhouse',
  private_room: 'Private room',
  guest_suite: 'Guest suite',
}

export const AMENITY_LABELS: Record<Amenity, string> = {
  wifi: 'Wifi',
  kitchen: 'Kitchen',
  parking: 'Parking',
  washer: 'Washer',
  dryer: 'Dryer',
  air_conditioning: 'Air conditioning',
  heating: 'Heating',
  workspace: 'Workspace',
  pool: 'Pool',
  hot_tub: 'Hot tub',
  ev_charger: 'EV charger',
}

// 189 -> "$189", 1250 -> "$1,250"
export const formatPrice = (dollars: number) => `$${dollars.toLocaleString('en-US')}`

// plural(1, 'guest') -> "1 guest", plural(4, 'guest') -> "4 guests"
export const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

// Who changed the nights, in words a guest understands.
export const AVAILABILITY_REASON_TEXT: Record<AvailabilityChangeReason, string> = {
  booking_requested: 'Another guest just requested',
  booking_declined: 'A declined request freed',
  booking_cancelled: 'A cancellation freed',
  host_blocked: 'The host just blocked',
  host_unblocked: 'The host just reopened',
}
