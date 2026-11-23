// "as const" keeps the exact strings, so the lists below can drive the filter UI
// and the types are built from the same lists (one place to add e.g. pet_friendly).
export const PROPERTY_TYPES = ['house', 'apartment', 'condo', 'townhouse', 'private_room', 'guest_suite'] as const
export type PropertyType = (typeof PROPERTY_TYPES)[number]

export const AMENITIES = [
  'wifi',
  'kitchen',
  'parking',
  'washer',
  'dryer',
  'air_conditioning',
  'heating',
  'workspace',
  'pool',
  'hot_tub',
  'ev_charger',
] as const
export type Amenity = (typeof AMENITIES)[number]

export type PropertyStatus = 'active' | 'inactive'

// Spec section 4: Property listing.
export type Property = {
  property_id: string
  host_id: string
  title: string
  description: string
  property_type: PropertyType
  address: string
  city: string
  state: string
  zip_code: string
  latitude: number
  longitude: number
  capacity: number // max guests
  bedrooms: number
  bathrooms: number
  amenities: Amenity[]
  nightly_price: number
  cleaning_fee: number
  status: PropertyStatus
  rating: number // average review rating, 0-5 (0 = no reviews yet)
  review_count: number
  created_datetime: string
  photo_url: string // extension: the spec has no photo field
}
// Availability is not embedded here: it comes from /properties/availability (see availability.ts).

// A property plus whether the current guest saved it (extension), returned by
// /properties/search and /properties/get when a guest_id is sent.
export type PropertyWithSaved = Property & { is_saved: boolean }
export type PropertySearchResult = PropertyWithSaved

// --- Request bodies (Property Service, /properties/*) ---

// Server fills property_id, rating, review_count, created_datetime.
export type CreatePropertyRequest = Omit<Property, 'property_id' | 'rating' | 'review_count' | 'created_datetime'>

export type GetPropertyRequest = {
  property_id: string
  guest_id?: string // fills is_saved for this guest
}

// host_id = the host making the change (must own the listing, else 403). The owner can't be changed.
export type UpdatePropertyRequest = { property_id: string; host_id: string } & Partial<Omit<CreatePropertyRequest, 'host_id'>>

export type DeletePropertyRequest = { property_id: string; host_id: string }
export type DeletePropertyResponse = { property_id: string; deleted: true }

// Every filter is optional; only page and page_size are required.
export type SearchPropertiesRequest = {
  location?: string // case-insensitive contains-match on city or address
  check_in?: string
  check_out?: string
  guest_count?: number
  min_price?: number // nightly price
  max_price?: number
  property_types?: PropertyType[] // match any
  amenities?: Amenity[] // must have all
  min_rating?: number
  available_only?: boolean // needs check_in and check_out
  guest_id?: string // fills is_saved for this guest
  host_id?: string // only this host's listings (host "my listings" page)
  status?: PropertyStatus // only listings with this status (mainly for host_id searches)
  page: number
  page_size: number
}

export type SavePropertyRequest = {
  guest_id: string
  property_id: string
  saved: boolean // false = unsave
}

export type SavePropertyResponse = {
  property_id: string
  saved: boolean
  saved_properties_count: number // guest's new total
}
