// Mock User Service: /guests/* and /hosts/*
// The "*/" prefix matches any server, so these work whatever VITE_USER_API_BASE_URL is.
import { delay, http, HttpResponse } from 'msw'
import type { Guest } from '../../types/guest'
import type { Host } from '../../types/host'
import { daysFromToday, nowDatetime, today } from '../dates'
import { db, holdsDates, nextId } from '../db'
import { checkPaging, errorResponse, invalidJsonResponse, MOCK_DELAY_MS, paginate, readBody, requireFields } from '../responses'

const isEmail = (value: unknown) => typeof value === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)

const guestNotFound = (id: unknown) => errorResponse('NOT_FOUND', `No guest found with id ${String(id)}.`)
const hostNotFound = (id: unknown) => errorResponse('NOT_FOUND', `No host found with id ${String(id)}.`)

// Is this email used by any login account (guest, host or admin)? Emails are unique across all of them.
export const emailTaken = (email: string, exceptUserId?: string) =>
  db.accounts.some((a) => a.email.toLowerCase() === email.toLowerCase() && a.user_id !== exceptUserId)

// New guest / host records. Used by POST /auth/signup (and the create endpoints below).
export function createGuestRecord(body: Record<string, unknown>): Guest {
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
  return guest
}

export function createHostRecord(body: Record<string, unknown>): Host {
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
  return host
}

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
    if (emailTaken(String(body.email))) return errorResponse('EMAIL_TAKEN', 'An account with this email already exists.')
    return HttpResponse.json(createGuestRecord(body), { status: 201 })
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
    if (body.email !== undefined && emailTaken(String(body.email), guest.guest_id)) {
      return errorResponse('EMAIL_TAKEN', 'Another account already uses this email.')
    }
    // The login email follows the profile email.
    const account = db.accounts.find((a) => a.user_id === guest.guest_id)
    if (account && body.email !== undefined) account.email = String(body.email)

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

    // Team rule C5a: not while the guest has upcoming pending/approved stays (same rule as deleting a listing).
    const upcoming = db.reservations.filter((r) => r.guest_id === body.guest_id && holdsDates(r) && r.check_out > today())
    if (upcoming.length > 0) {
      return errorResponse(
        'INVALID_STATUS',
        `You have ${upcoming.length} upcoming trip(s). Cancel them before deleting your profile.`,
        { reservation_ids: upcoming.map((r) => r.reservation_id) },
      )
    }

    db.guests.splice(index, 1)
    // The login goes too: the account can't log in any more.
    db.accounts = db.accounts.filter((a) => a.user_id !== body.guest_id)
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
    if (emailTaken(String(body.email))) return errorResponse('EMAIL_TAKEN', 'An account with this email already exists.')
    return HttpResponse.json(createHostRecord(body), { status: 201 })
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
    if (body.email !== undefined && emailTaken(String(body.email), host.host_id)) {
      return errorResponse('EMAIL_TAKEN', 'Another account already uses this email.')
    }
    const account = db.accounts.find((a) => a.user_id === host.host_id)
    if (account && body.email !== undefined) account.email = String(body.email)

    const editable = ['name', 'email', 'phone', 'profile_photo_url'] as const
    for (const field of editable) {
      if (body[field] !== undefined) Object.assign(host, { [field]: body[field] })
    }
    return HttpResponse.json(host)
  }),
]
