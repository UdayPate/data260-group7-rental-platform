// Mock User Service: /guests/* and /hosts/*
// The "*/" prefix matches any server, so these work whatever VITE_USER_API_BASE_URL is.
import { delay, http, HttpResponse } from 'msw'
import type { Guest } from '../../types/guest'
import type { Host } from '../../types/host'
import { daysFromToday, nowDatetime } from '../dates'
import { db, nextId } from '../db'
import { checkPaging, errorResponse, invalidJsonResponse, MOCK_DELAY_MS, paginate, readBody, requireFields } from '../responses'

const isEmail = (value: unknown) => typeof value === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)

const guestNotFound = (id: unknown) => errorResponse('NOT_FOUND', `No guest found with id ${String(id)}.`)
const hostNotFound = (id: unknown) => errorResponse('NOT_FOUND', `No host found with id ${String(id)}.`)

// Contains-match ignoring upper/lower case.
const contains = (text: string, search: string) => text.toLowerCase().includes(search.toLowerCase())

export const userHandlers = [
  // ---------- Guests ----------
  http.post('*/guests/create', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['first_name', 'last_name', 'email'])
    if (missing) return missing
    if (!isEmail(body.email)) return errorResponse('VALIDATION_ERROR', 'Please enter a valid email address.')
    if (db.guests.some((g) => g.email === body.email)) {
      return errorResponse('VALIDATION_ERROR', 'A guest with this email already exists.')
    }

    const guest: Guest = {
      guest_id: nextId('g', db.guests.map((g) => g.guest_id)),
      first_name: String(body.first_name),
      last_name: String(body.last_name),
      email: String(body.email),
      phone: String(body.phone ?? ''),
      location: String(body.location ?? ''),
      profile_photo_url: String(body.profile_photo_url ?? ''),
      preferences: (body.preferences as Guest['preferences']) ?? {
        preferred_locations: [],
        max_nightly_price: null,
        property_types: [],
        amenities: [],
      },
      saved_properties_count: 0,
      booking_count: 0,
      profile_created_datetime: nowDatetime(),
    }
    db.guests.push(guest)
    return HttpResponse.json(guest, { status: 201 })
  }),

  http.post('*/guests/get', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['guest_id'])
    if (missing) return missing
    const guest = db.guests.find((g) => g.guest_id === body.guest_id)
    return guest ? HttpResponse.json(guest) : guestNotFound(body.guest_id)
  }),

  http.post('*/guests/update', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['guest_id'])
    if (missing) return missing
    const guest = db.guests.find((g) => g.guest_id === body.guest_id)
    if (!guest) return guestNotFound(body.guest_id)
    if (body.email !== undefined && !isEmail(body.email)) {
      return errorResponse('VALIDATION_ERROR', 'Please enter a valid email address.')
    }

    // Only these fields can be changed; ids, counters and created time stay as they are.
    const editable = ['first_name', 'last_name', 'email', 'phone', 'location', 'profile_photo_url', 'preferences'] as const
    for (const field of editable) {
      if (body[field] !== undefined) Object.assign(guest, { [field]: body[field] })
    }
    return HttpResponse.json(guest)
  }),

  http.post('*/guests/delete', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['guest_id'])
    if (missing) return missing
    const index = db.guests.findIndex((g) => g.guest_id === body.guest_id)
    if (index === -1) return guestNotFound(body.guest_id)

    db.guests.splice(index, 1)
    // Also forget the guest's saved properties.
    for (let i = db.saved.length - 1; i >= 0; i--) {
      if (db.saved[i].guest_id === body.guest_id) db.saved.splice(i, 1)
    }
    return HttpResponse.json({ guest_id: body.guest_id, deleted: true })
  }),

  http.post('*/guests/search', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const badPaging = checkPaging(body.page, body.page_size)
    if (badPaging) return badPaging

    let results = db.guests
    if (typeof body.query === 'string' && body.query !== '') {
      const query = body.query
      results = results.filter((g) => contains(`${g.first_name} ${g.last_name}`, query) || contains(g.email, query))
    }
    if (typeof body.location === 'string' && body.location !== '') {
      const location = body.location
      results = results.filter((g) => contains(g.location, location))
    }
    return HttpResponse.json(paginate(results, body.page as number, body.page_size as number))
  }),

  // ---------- Hosts ----------
  http.post('*/hosts/create', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['name', 'email'])
    if (missing) return missing
    if (!isEmail(body.email)) return errorResponse('VALIDATION_ERROR', 'Please enter a valid email address.')
    if (db.hosts.some((h) => h.email === body.email)) {
      return errorResponse('VALIDATION_ERROR', 'A host with this email already exists.')
    }

    const host: Host = {
      host_id: nextId('h', db.hosts.map((h) => h.host_id)),
      name: String(body.name),
      email: String(body.email),
      phone: String(body.phone ?? ''),
      profile_photo_url: String(body.profile_photo_url ?? ''),
      verification_status: 'unverified',
      response_rate: 0,
      response_time: 0,
      host_since: daysFromToday(0),
      access_level: 'standard',
    }
    db.hosts.push(host)
    return HttpResponse.json(host, { status: 201 })
  }),

  http.post('*/hosts/get', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['host_id'])
    if (missing) return missing
    const host = db.hosts.find((h) => h.host_id === body.host_id)
    return host ? HttpResponse.json(host) : hostNotFound(body.host_id)
  }),

  http.post('*/hosts/update', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['host_id'])
    if (missing) return missing
    const host = db.hosts.find((h) => h.host_id === body.host_id)
    if (!host) return hostNotFound(body.host_id)
    if (body.email !== undefined && !isEmail(body.email)) {
      return errorResponse('VALIDATION_ERROR', 'Please enter a valid email address.')
    }

    const editable = ['name', 'email', 'phone', 'profile_photo_url'] as const
    for (const field of editable) {
      if (body[field] !== undefined) Object.assign(host, { [field]: body[field] })
    }
    return HttpResponse.json(host)
  }),
]
