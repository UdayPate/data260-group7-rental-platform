// Mock Property Service: /properties/*
import { delay, http, HttpResponse } from 'msw'
import { AMENITIES, PROPERTY_TYPES, type Amenity, type Property, type PropertyType } from '../../types/property'
import { isValidDate, nowDatetime, rangesOverlap, today } from '../dates'
import { publishAvailability } from '../availability/bus'
import { db, hasDateConflict, holdsDates, nextId } from '../db'
import { checkPaging, errorResponse, invalidJsonResponse, MOCK_DELAY_MS, paginate, readBody, requireFields } from '../responses'

const propertyNotFound = (id: unknown) => errorResponse('NOT_FOUND', `No property found with id ${String(id)}.`)
const notOwner = (action: string) =>
  errorResponse('UNAUTHORIZED', `Only the host of this listing can ${action} it.`)

const isPositiveNumber = (value: unknown) => typeof value === 'number' && value > 0
const isWholeNumber = (value: unknown) => Number.isInteger(value) && (value as number) >= 0

// Checks the listing fields that are present in the body (used by create and update).
// Returns a 400 response for the first problem found, or null if everything is fine.
function checkPropertyFields(body: Record<string, unknown>) {
  if (body.property_type !== undefined && !PROPERTY_TYPES.includes(body.property_type as PropertyType)) {
    return errorResponse('VALIDATION_ERROR', `property_type must be one of: ${PROPERTY_TYPES.join(', ')}.`)
  }
  if (body.amenities !== undefined) {
    const amenities = body.amenities
    if (!Array.isArray(amenities) || amenities.some((a) => !AMENITIES.includes(a as Amenity))) {
      return errorResponse('VALIDATION_ERROR', `amenities may only contain: ${AMENITIES.join(', ')}.`)
    }
  }
  if (body.capacity !== undefined && (!Number.isInteger(body.capacity) || (body.capacity as number) < 1)) {
    return errorResponse('VALIDATION_ERROR', 'capacity must be a whole number of at least 1.')
  }
  if (body.bedrooms !== undefined && !isWholeNumber(body.bedrooms)) {
    return errorResponse('VALIDATION_ERROR', 'bedrooms must be a whole number (0 or more).')
  }
  if (body.bathrooms !== undefined && !(typeof body.bathrooms === 'number' && body.bathrooms >= 0)) {
    return errorResponse('VALIDATION_ERROR', 'bathrooms must be 0 or more (halves allowed, e.g. 1.5).')
  }
  if (body.nightly_price !== undefined && !isPositiveNumber(body.nightly_price)) {
    return errorResponse('VALIDATION_ERROR', 'nightly_price must be more than 0.')
  }
  if (body.cleaning_fee !== undefined && !(typeof body.cleaning_fee === 'number' && body.cleaning_fee >= 0)) {
    return errorResponse('VALIDATION_ERROR', 'cleaning_fee must be 0 or more.')
  }
  if (body.status !== undefined && body.status !== 'active' && body.status !== 'inactive') {
    return errorResponse('VALIDATION_ERROR', 'status must be "active" or "inactive".')
  }
  return null
}

export const propertyHandlers = [
  http.post('*/properties/create', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, [
      'host_id', 'title', 'property_type', 'address', 'city', 'state', 'zip_code',
      'capacity', 'bedrooms', 'bathrooms', 'nightly_price', 'cleaning_fee',
    ])
    if (missing) return missing
    const badField = checkPropertyFields(body)
    if (badField) return badField
    if (!db.hosts.some((h) => h.host_id === body.host_id)) {
      return errorResponse('NOT_FOUND', `No host found with id ${String(body.host_id)}.`)
    }

    const property: Property = {
      property_id: nextId('p', db.properties.map((p) => p.property_id)),
      host_id: String(body.host_id),
      title: String(body.title),
      description: String(body.description ?? ''),
      property_type: body.property_type as PropertyType,
      address: String(body.address),
      city: String(body.city),
      state: String(body.state),
      zip_code: String(body.zip_code),
      latitude: typeof body.latitude === 'number' ? body.latitude : 0,
      longitude: typeof body.longitude === 'number' ? body.longitude : 0,
      capacity: body.capacity as number,
      bedrooms: body.bedrooms as number,
      bathrooms: body.bathrooms as number,
      amenities: (body.amenities as Amenity[] | undefined) ?? [],
      nightly_price: body.nightly_price as number,
      cleaning_fee: body.cleaning_fee as number,
      status: (body.status as Property['status'] | undefined) ?? 'active',
      rating: 0,
      review_count: 0,
      created_datetime: nowDatetime(),
      photo_url: String(body.photo_url ?? ''),
    }
    db.properties.push(property)
    return HttpResponse.json(property, { status: 201 })
  }),

  http.post('*/properties/get', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['property_id'])
    if (missing) return missing
    const property = db.properties.find((p) => p.property_id === body.property_id)
    if (!property) return propertyNotFound(body.property_id)
    // is_saved says whether guest_id (if sent) saved this property; false without a guest_id.
    const isSaved = db.saved.some((s) => s.guest_id === body.guest_id && s.property_id === property.property_id)
    return HttpResponse.json({ ...property, is_saved: isSaved })
  }),

  http.post('*/properties/update', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['property_id', 'host_id'])
    if (missing) return missing
    const property = db.properties.find((p) => p.property_id === body.property_id)
    if (!property) return propertyNotFound(body.property_id)
    if (property.host_id !== body.host_id) return notOwner('edit')
    const badField = checkPropertyFields(body)
    if (badField) return badField

    // Everything except ids, owner, rating, review_count and created time can change.
    const editable = [
      'title', 'description', 'property_type', 'address', 'city', 'state', 'zip_code', 'latitude', 'longitude',
      'capacity', 'bedrooms', 'bathrooms', 'amenities', 'nightly_price', 'cleaning_fee', 'status', 'photo_url',
    ] as const
    for (const field of editable) {
      if (body[field] !== undefined) Object.assign(property, { [field]: body[field] })
    }
    return HttpResponse.json(property)
  }),

  http.post('*/properties/delete', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['property_id', 'host_id'])
    if (missing) return missing
    const index = db.properties.findIndex((p) => p.property_id === body.property_id)
    if (index === -1) return propertyNotFound(body.property_id)
    if (db.properties[index].host_id !== body.host_id) return notOwner('delete')

    // Can't delete a listing that still has upcoming pending/approved stays.
    const upcoming = db.reservations.filter(
      (r) => r.property_id === body.property_id && holdsDates(r) && r.check_out > today(),
    )
    if (upcoming.length > 0) {
      return errorResponse(
        'INVALID_STATUS',
        `This listing has ${upcoming.length} upcoming reservation(s). Decline or cancel them before deleting it.`,
        { reservation_ids: upcoming.map((r) => r.reservation_id) },
      )
    }

    db.properties.splice(index, 1)
    // Remove its availability blocks and saves too (past reservations are kept as history).
    for (let i = db.availability.length - 1; i >= 0; i--) {
      if (db.availability[i].property_id === body.property_id) db.availability.splice(i, 1)
    }
    for (let i = db.saved.length - 1; i >= 0; i--) {
      if (db.saved[i].property_id === body.property_id) db.saved.splice(i, 1)
    }
    return HttpResponse.json({ property_id: body.property_id, deleted: true })
  }),

  http.post('*/properties/search', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const badPaging = checkPaging(body.page, body.page_size)
    if (badPaging) return badPaging

    // --- Validate the filters ---
    const { check_in, check_out } = body
    if ((check_in === undefined) !== (check_out === undefined)) {
      return errorResponse('VALIDATION_ERROR', 'Pick both a check-in and a check-out date.')
    }
    if (check_in !== undefined) {
      if (!isValidDate(check_in) || !isValidDate(check_out)) {
        return errorResponse('VALIDATION_ERROR', 'Dates must be real dates in YYYY-MM-DD format.')
      }
      if (check_out <= check_in) return errorResponse('VALIDATION_ERROR', 'Check-out must be after check-in.')
    }
    if (body.available_only === true && check_in === undefined) {
      return errorResponse('VALIDATION_ERROR', 'Pick dates to see only available stays.')
    }
    if (body.guest_count !== undefined && (!Number.isInteger(body.guest_count) || (body.guest_count as number) < 1)) {
      return errorResponse('VALIDATION_ERROR', 'Number of guests must be a whole number of at least 1.')
    }
    if (
      typeof body.min_price === 'number' &&
      typeof body.max_price === 'number' &&
      body.min_price > body.max_price
    ) {
      return errorResponse('VALIDATION_ERROR', 'The minimum price can’t be higher than the maximum price.')
    }
    if (body.status !== undefined && body.status !== 'active' && body.status !== 'inactive') {
      return errorResponse('VALIDATION_ERROR', 'status must be "active" or "inactive".')
    }

    // --- Apply the filters one at a time ---
    // A host looking at their own listings also sees inactive ones; guests only see active.
    let results = db.properties.filter((p) => (body.host_id ? p.host_id === body.host_id : p.status === 'active'))

    if (body.status !== undefined) {
      results = results.filter((p) => p.status === body.status)
    }
    if (typeof body.location === 'string' && body.location.trim() !== '') {
      const location = body.location.trim().toLowerCase()
      results = results.filter(
        (p) => p.city.toLowerCase().includes(location) || p.address.toLowerCase().includes(location),
      )
    }
    if (typeof body.guest_count === 'number') {
      const guestCount = body.guest_count
      results = results.filter((p) => p.capacity >= guestCount)
    }
    if (typeof body.min_price === 'number') {
      const minPrice = body.min_price
      results = results.filter((p) => p.nightly_price >= minPrice)
    }
    if (typeof body.max_price === 'number') {
      const maxPrice = body.max_price
      results = results.filter((p) => p.nightly_price <= maxPrice)
    }
    if (Array.isArray(body.property_types) && body.property_types.length > 0) {
      const types = body.property_types as PropertyType[]
      results = results.filter((p) => types.includes(p.property_type)) // any of the types
    }
    if (Array.isArray(body.amenities) && body.amenities.length > 0) {
      const wanted = body.amenities as Amenity[]
      results = results.filter((p) => wanted.every((a) => p.amenities.includes(a))) // all of the amenities
    }
    if (typeof body.min_rating === 'number') {
      const minRating = body.min_rating
      results = results.filter((p) => p.rating >= minRating)
    }
    if (body.available_only === true) {
      results = results.filter((p) => !hasDateConflict(p.property_id, check_in as string, check_out as string))
    }

    // Mark which results the current guest has saved.
    const withSaved = results.map((p) => ({
      ...p,
      is_saved: db.saved.some((s) => s.guest_id === body.guest_id && s.property_id === p.property_id),
    }))
    return HttpResponse.json(paginate(withSaved, body.page as number, body.page_size as number))
  }),

  http.post('*/properties/save', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['guest_id', 'property_id', 'saved'])
    if (missing) return missing
    if (typeof body.saved !== 'boolean') return errorResponse('VALIDATION_ERROR', 'saved must be true or false.')
    const guest = db.guests.find((g) => g.guest_id === body.guest_id)
    if (!guest) return errorResponse('NOT_FOUND', `No guest found with id ${String(body.guest_id)}.`)
    if (!db.properties.some((p) => p.property_id === body.property_id)) return propertyNotFound(body.property_id)

    // Saving twice or unsaving something not saved is fine: the result is the same.
    const index = db.saved.findIndex((s) => s.guest_id === body.guest_id && s.property_id === body.property_id)
    if (body.saved && index === -1) db.saved.push({ guest_id: guest.guest_id, property_id: String(body.property_id), saved_datetime: nowDatetime() })
    if (!body.saved && index !== -1) db.saved.splice(index, 1)

    guest.saved_properties_count = db.saved.filter((s) => s.guest_id === guest.guest_id).length
    return HttpResponse.json({
      property_id: body.property_id,
      saved: body.saved,
      saved_properties_count: guest.saved_properties_count,
    })
  }),

  // One endpoint, three actions (team decision C1a): "get" (default), "block", "unblock".
  // Blocking rule (C2a): a new block may not overlap any blocked or booked night;
  // only the host's own blocks can be unblocked.
  http.post('*/properties/availability', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const action = body.action ?? 'get'

    // --- unblock: remove one host block ---
    if (action === 'unblock') {
      const missing = requireFields(body, ['availability_id', 'host_id'])
      if (missing) return missing
      const index = db.availability.findIndex((a) => a.availability_id === body.availability_id)
      if (index === -1) return errorResponse('NOT_FOUND', `No availability block found with id ${String(body.availability_id)}.`)
      const block = db.availability[index]
      const property = db.properties.find((p) => p.property_id === block.property_id)
      if (property?.host_id !== body.host_id) return notOwner('change the calendar of')
      if (block.source !== 'host') {
        return errorResponse(
          'INVALID_STATUS',
          'These nights are held by a reservation. Decline or cancel that reservation to free them.',
        )
      }
      db.availability.splice(index, 1)
      publishAvailability('availability.released', block, 'host_unblocked', crypto.randomUUID()) // spec 13.4
      return HttpResponse.json({ availability_id: block.availability_id, unblocked: true })
    }

    if (action !== 'get' && action !== 'block') {
      return errorResponse('VALIDATION_ERROR', 'action must be "get", "block" or "unblock".')
    }

    // --- get and block both take a property and a date range ---
    const missing = requireFields(body, action === 'block' ? ['property_id', 'host_id', 'start_date', 'end_date'] : ['property_id', 'start_date', 'end_date'])
    if (missing) return missing
    const { start_date, end_date } = body
    if (!isValidDate(start_date) || !isValidDate(end_date)) {
      return errorResponse('VALIDATION_ERROR', 'Dates must be real dates in YYYY-MM-DD format.')
    }
    if (end_date <= start_date) return errorResponse('VALIDATION_ERROR', 'The end date must be after the start date.')
    const property = db.properties.find((p) => p.property_id === body.property_id)
    if (!property) return propertyNotFound(body.property_id)

    if (action === 'get') {
      const items = db.availability.filter(
        (block) =>
          block.property_id === body.property_id && rangesOverlap(block.start_date, block.end_date, start_date, end_date),
      )
      return HttpResponse.json({ items })
    }

    // --- block ---
    if (property.host_id !== body.host_id) return notOwner('change the calendar of')
    if (start_date < today()) return errorResponse('VALIDATION_ERROR', 'You can’t block dates in the past.')
    const clash = db.availability.find(
      (b) =>
        b.property_id === property.property_id &&
        b.status !== 'available' &&
        rangesOverlap(b.start_date, b.end_date, start_date, end_date),
    )
    if (clash) {
      const what = clash.source === 'booking' ? 'a reservation' : 'one of your existing blocks'
      return errorResponse('DATE_CONFLICT', `Some of these nights are already taken by ${what}.`, {
        availability_id: clash.availability_id,
      })
    }
    const block = {
      availability_id: nextId('a', db.availability.map((a) => a.availability_id)),
      property_id: property.property_id,
      start_date,
      end_date,
      status: 'blocked' as const,
      source: 'host' as const,
      updated_datetime: nowDatetime(),
    }
    db.availability.push(block)
    publishAvailability('availability.blocked', block, 'host_blocked', crypto.randomUUID()) // spec 13.4
    return HttpResponse.json(block, { status: 201 })
  }),
]
