import type { Amenity, PropertyType } from './property'

export type GuestPreferences = {
  preferred_locations: string[]
  max_nightly_price: number | null
  property_types: PropertyType[]
  amenities: Amenity[]
}

// Spec section 4: Guest.
export type Guest = {
  guest_id: string
  first_name: string
  last_name: string
  email: string
  phone: string
  location: string
  profile_photo_url: string
  preferences: GuestPreferences
  saved_properties_count: number
  booking_count: number
  profile_created_datetime: string
}

// --- Request bodies (User Service, /guests/*) ---

// Server fills guest_id, counters and profile_created_datetime.
export type CreateGuestRequest = Omit<
  Guest,
  'guest_id' | 'saved_properties_count' | 'booking_count' | 'profile_created_datetime'
>

export type GetGuestRequest = { guest_id: string }

// Only the fields being changed are sent.
export type UpdateGuestRequest = { guest_id: string } & Partial<CreateGuestRequest>

export type DeleteGuestRequest = { guest_id: string }
export type DeleteGuestResponse = { guest_id: string; deleted: true }

export type SearchGuestsRequest = {
  query?: string // contains-match on name or email
  location?: string
  page: number
  page_size: number
}
