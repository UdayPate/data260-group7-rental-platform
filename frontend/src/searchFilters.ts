// The guest search filters live in the page URL (e.g. /?location=San+Jose&guests=2),
// so reload, the Back button and shared links all keep them. This file converts
// between the URL, a filters object the UI works with, and the API request body.
import {
  AMENITIES,
  PROPERTY_TYPES,
  type Amenity,
  type PropertyStatus,
  type PropertyType,
  type SearchPropertiesRequest,
} from './types/property'

export type SearchFilters = {
  location: string // '' = any
  check_in: string // 'YYYY-MM-DD' or ''
  check_out: string
  guests: number | null // null = any
  min_price: number | null
  max_price: number | null
  types: PropertyType[]
  amenities: Amenity[]
  min_rating: number | null
  available_only: boolean
}

// The "★ 4.5+" chip in the filter strip.
export const RATING_CHIP_VALUE = 4.5

// Adds the value if it's missing, removes it if it's there (for chip/checkbox lists).
export function toggleIn<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value]
}

// Number from a URL value, or null if it's missing or not a number.
function toNumber(value: string | null): number | null {
  if (value === null || value.trim() === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

// "parking,kitchen" -> ['parking', 'kitchen'], dropping anything not in the allowed list.
function toList<T extends string>(value: string | null, allowed: readonly T[]): T[] {
  if (!value) return []
  return value.split(',').filter((v): v is T => (allowed as readonly string[]).includes(v))
}

export function readFilters(params: URLSearchParams): SearchFilters {
  return {
    location: params.get('location') ?? '',
    check_in: params.get('check_in') ?? '',
    check_out: params.get('check_out') ?? '',
    guests: toNumber(params.get('guests')),
    min_price: toNumber(params.get('min_price')),
    max_price: toNumber(params.get('max_price')),
    types: toList(params.get('types'), PROPERTY_TYPES),
    amenities: toList(params.get('amenities'), AMENITIES),
    min_rating: toNumber(params.get('min_rating')),
    available_only: params.get('available') === '1',
  }
}

// The opposite of readFilters: only filters that are set go into the URL.
export function writeFilters(filters: SearchFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.location) params.set('location', filters.location)
  if (filters.check_in) params.set('check_in', filters.check_in)
  if (filters.check_out) params.set('check_out', filters.check_out)
  if (filters.guests !== null) params.set('guests', String(filters.guests))
  if (filters.min_price !== null) params.set('min_price', String(filters.min_price))
  if (filters.max_price !== null) params.set('max_price', String(filters.max_price))
  if (filters.types.length > 0) params.set('types', filters.types.join(','))
  if (filters.amenities.length > 0) params.set('amenities', filters.amenities.join(','))
  if (filters.min_rating !== null) params.set('min_rating', String(filters.min_rating))
  if (filters.available_only) params.set('available', '1')
  return params
}

// The body for POST /properties/search. Unset filters are left out (undefined),
// so the server doesn't filter on them.
export function toSearchRequest(
  filters: SearchFilters,
  guestId: string,
  page: number,
  pageSize: number,
): SearchPropertiesRequest {
  return {
    location: filters.location || undefined,
    check_in: filters.check_in || undefined,
    check_out: filters.check_out || undefined,
    guest_count: filters.guests ?? undefined,
    min_price: filters.min_price ?? undefined,
    max_price: filters.max_price ?? undefined,
    property_types: filters.types.length > 0 ? filters.types : undefined,
    amenities: filters.amenities.length > 0 ? filters.amenities : undefined,
    min_rating: filters.min_rating ?? undefined,
    available_only: filters.available_only || undefined,
    guest_id: guestId,
    page,
    page_size: pageSize,
  }
}

// ---------- Host "My listings" filters (URL: /host/listings?location=...&types=...&status=active) ----------

export type HostListingFilters = {
  location: string // '' = any
  types: PropertyType[]
  status: PropertyStatus | null // null = active and inactive
}

export function readHostFilters(params: URLSearchParams): HostListingFilters {
  const status = params.get('status')
  return {
    location: params.get('location') ?? '',
    types: toList(params.get('types'), PROPERTY_TYPES),
    status: status === 'active' || status === 'inactive' ? status : null,
  }
}

export function writeHostFilters(filters: HostListingFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.location) params.set('location', filters.location)
  if (filters.types.length > 0) params.set('types', filters.types.join(','))
  if (filters.status) params.set('status', filters.status)
  return params
}
