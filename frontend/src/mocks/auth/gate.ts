// The mock's version of the shared token check every real service runs (contract section
// "Authentication and roles"). It sits in front of every mocked endpoint:
//
//   1. no token / invalid / expired token          -> 401 UNAUTHENTICATED
//   2. the token's role may not call this endpoint  -> 403 UNAUTHORIZED
//   3. a guest_id / host_id / ... in the request is not the token's own id -> 403
//   4. a few endpoints need a database lookup (e.g. "is this your reservation?") -> 403
//
// Anything allowed continues to the endpoint's own handler, which still does its usual
// checks (e.g. "only the host of this listing can approve").
import { http, type HttpResponse } from 'msw'
import type { Role, TokenClaims } from '../../types/auth'
import { getTaskEntry } from '../ai/bus'
import { db } from '../db'
import { errorResponse, readBody } from '../responses'
import { verifyToken } from './jwt'

type Request = { body: Record<string, unknown>; query: URLSearchParams; path: string }

type Rule = {
  method: 'GET' | 'POST'
  path: RegExp // matched against the end of the URL path
  // Who may call it. "public" = no token needed; "any" = any logged-in user.
  // A function decides from the request (used where one endpoint has several actions).
  roles: Role[] | 'public' | 'any' | ((req: Request) => Role[] | 'public')
  // Fields that, when present, must be the logged-in user's own id.
  own?: string[]
  // Extra check with a database lookup. Returns a reason to refuse, or null if allowed.
  check?: (claims: TokenClaims, req: Request) => string | null
}

const ANYONE_LOGGED_IN = 'any' as const
const PUBLIC = 'public' as const

// Does this host have (or had) a reservation from this guest at one of their listings?
function hostHasGuest(hostId: string, guestId: unknown) {
  return db.reservations.some(
    (r) => r.guest_id === guestId && db.properties.some((p) => p.property_id === r.property_id && p.host_id === hostId),
  )
}
const hostOfProperty = (propertyId: unknown) => db.properties.find((p) => p.property_id === propertyId)?.host_id
const taskIdFrom = (path: string) => decodeURIComponent(path.split('/').at(-1) ?? '')

// One line per mocked endpoint. Keep this list complete: the mock tests call every
// endpoint without a token and expect 401 unless it is public here.
const RULES: Rule[] = [
  // ----- User Service -----
  { method: 'POST', path: /\/auth\/(login|signup)$/, roles: PUBLIC },
  // Sign-up creates guests and hosts (it calls these internally); outside callers can't.
  { method: 'POST', path: /\/(guests|hosts)\/create$/, roles: ANYONE_LOGGED_IN, check: () => 'Accounts are created with /auth/signup.' },
  {
    method: 'POST', path: /\/guests\/get$/, roles: ['guest', 'host'],
    check: (c, req) =>
      (c.role === 'guest' && c.sub === req.body.guest_id) || (c.role === 'host' && hostHasGuest(c.sub, req.body.guest_id))
        ? null
        : 'You can only see your own profile, or guests who booked one of your listings.',
  },
  { method: 'POST', path: /\/guests\/(update|delete)$/, roles: ['guest'], own: ['guest_id'] },
  { method: 'POST', path: /\/guests\/search$/, roles: ['admin'] },
  { method: 'POST', path: /\/hosts\/get$/, roles: PUBLIC },
  { method: 'POST', path: /\/hosts\/update$/, roles: ['host'], own: ['host_id'] },

  // ----- Property Service -----
  // Public browsing; a guest_id (for "saved" hearts) or host_id (own listings) must be your own.
  { method: 'POST', path: /\/properties\/(get|search)$/, roles: PUBLIC, own: ['guest_id', 'host_id'] },
  { method: 'POST', path: /\/properties\/(create|update|delete)$/, roles: ['host'], own: ['host_id'] },
  { method: 'POST', path: /\/properties\/save$/, roles: ['guest'], own: ['guest_id'] },
  {
    method: 'POST', path: /\/properties\/availability$/,
    roles: (req) => (req.body.action === 'block' || req.body.action === 'unblock' ? ['host'] : PUBLIC),
    own: ['host_id'],
  },

  // ----- Booking Service -----
  { method: 'POST', path: /\/bookings\/request$/, roles: ['guest'], own: ['guest_id'] },
  {
    method: 'POST', path: /\/bookings\/get$/, roles: ['guest', 'host'],
    check: (c, req) => {
      const r = db.reservations.find((x) => x.reservation_id === req.body.reservation_id)
      if (!r) return null // the handler answers 404
      const mine = c.role === 'guest' ? r.guest_id === c.sub : hostOfProperty(r.property_id) === c.sub
      // Same message the page already shows for someone else's reservation.
      return mine ? null : 'This reservation belongs to another guest.'
    },
  },
  {
    method: 'POST', path: /\/bookings\/byProperty$/, roles: ['host'],
    check: (c, req) => (hostOfProperty(req.body.property_id) ?? c.sub) === c.sub ? null : 'You can only see reservations for your own listings.',
  },
  { method: 'POST', path: /\/bookings\/byGuest$/, roles: ['guest'], own: ['guest_id'] },
  { method: 'POST', path: /\/bookings\/(approve|decline)$/, roles: ['host'], own: ['host_id'] },
  { method: 'POST', path: /\/bookings\/cancel$/, roles: ['guest', 'host'], own: ['guest_id', 'host_id'] },

  // ----- Messaging Service -----
  { method: 'POST', path: /\/threads\/open$/, roles: ['guest', 'host'], own: ['actor_id'] },
  { method: 'POST', path: /\/(threads\/get|threads\/byUser|messages\/list)$/, roles: ['guest', 'host'], own: ['user_id'] },
  { method: 'POST', path: /\/messages\/send$/, roles: ['guest', 'host'], own: ['sender_id'] },

  // ----- Review Service -----
  { method: 'POST', path: /\/reviews\/(get|byProperty)$/, roles: PUBLIC },
  { method: 'POST', path: /\/reviews\/(create|byGuest)$/, roles: ['guest'], own: ['guest_id'] },
  { method: 'POST', path: /\/reviews\/respond$/, roles: ['host'], own: ['host_id'] },

  // ----- AI Agent Service -----
  { method: 'POST', path: /\/ai\/requests$/, roles: ['guest'], own: ['guest_id'] },
  {
    method: 'GET', path: /\/ai\/(tasks|results)\/[^/]+$/, roles: ['guest'],
    check: (c, req) => {
      const entry = getTaskEntry(taskIdFrom(req.path))
      return !entry || entry.task.guest_id === c.sub ? null : 'This AI request belongs to another guest.'
    },
  },
  { method: 'POST', path: /\/ai\/tasks\/[^/]+\/(approve|reject)$/, roles: ['guest'], own: ['guest_id'] },

  // ----- Analytics & Logging Service -----
  { method: 'POST', path: /\/events\/ingest$/, roles: ANYONE_LOGGED_IN },
  { method: 'GET', path: /\/analytics\/guest\/dashboard$/, roles: ['guest'], own: ['guest_id'] },
  { method: 'GET', path: /\/analytics\/host\/dashboard$/, roles: ['host'], own: ['host_id'] },
  { method: 'GET', path: /\/analytics\/(platform\/dashboard|ai\/dashboard|traces|traces\/[^/]+|properties\/top|geo)$/, roles: ['admin'] },
  // The funnel: a host for their own listings, or the admin for all of them.
  { method: 'GET', path: /\/analytics\/funnel$/, roles: ['host', 'admin'], own: ['host_id'] },
]

// "Bearer <token>" -> the token, or null.
function bearerToken(request: globalThis.Request): string | null {
  const header = request.headers.get('authorization') ?? ''
  return header.startsWith('Bearer ') ? header.slice(7).trim() : null
}

// 401 messages the UI shows (and then it sends the user to the login page).
export function notLoggedIn(reason: 'missing' | 'invalid' | 'expired'): ReturnType<typeof HttpResponse.json> {
  const message = {
    missing: 'Please log in to continue.',
    invalid: 'Your login is not valid any more. Please log in again.',
    expired: 'Your session has expired. Please log in again.',
  }[reason]
  return errorResponse('UNAUTHENTICATED', message)
}

const ROLE_WORD: Record<Role, string> = { guest: 'guest', host: 'host', admin: 'admin' }

// A page load (the browser asking for HTML, e.g. reloading /ai/tasks/task_001) goes to the app, not the API.
const isPageLoad = (request: globalThis.Request) =>
  request.mode === 'navigate' || (request.headers.get('accept') ?? '').includes('text/html')

export const authGate = http.all('*', async ({ request }) => {
  if (isPageLoad(request)) return
  const url = new URL(request.url)
  const rule = RULES.find((r) => r.method === request.method && r.path.test(url.pathname))
  if (!rule) return // not an API endpoint we mock: let the other handlers decide

  // readBody remembers the result, so the endpoint's handler can read the same body after us.
  const parsed = request.method === 'POST' ? await readBody(request) : {}
  const bodyReadable = parsed !== null
  const body = parsed ?? {}
  const req: Request = { body, query: url.searchParams, path: url.pathname }
  const roles = typeof rule.roles === 'function' ? rule.roles(req) : rule.roles
  // Owner fields can be in the JSON body (POST) or the query string (GET).
  const ownValues = (rule.own ?? []).map((field) => body[field] ?? url.searchParams.get(field)).filter((v) => v !== undefined && v !== null && v !== '')

  // Public, and nothing in the request needs a login: no token required.
  const token = bearerToken(request)
  if (roles === PUBLIC && ownValues.length === 0 && !token) return

  // 1. Who is calling?
  if (!token) return notLoggedIn('missing')
  const verified = await verifyToken(token)
  if (!verified.ok) return notLoggedIn(verified.reason)
  const claims = verified.claims

  // 2. Right role?
  if (Array.isArray(roles) && !roles.includes(claims.role)) {
    const allowed = roles.map((r) => ROLE_WORD[r]).join(' or ')
    return errorResponse('UNAUTHORIZED', `This is only for ${allowed} accounts. You’re logged in as ${ROLE_WORD[claims.role] === 'admin' ? 'an' : 'a'} ${ROLE_WORD[claims.role]}.`)
  }
  // Not a JSON object: the endpoint's own handler answers 400 (after the login check above).
  if (!bodyReadable) return
  // 3. Your own id?
  if (ownValues.some((v) => v !== claims.sub)) {
    return errorResponse('UNAUTHORIZED', 'You can only do this for your own account.')
  }
  // 4. Endpoint-specific check.
  const refused = rule.check?.(claims, req)
  if (refused) return errorResponse('UNAUTHORIZED', refused)
  // Allowed: returning nothing lets the endpoint's handler answer.
})

// Same check for WebSockets, where the token comes in "?token=" (browsers can't set
// headers on a WebSocket). Returns the claims, or null if the socket must be closed with 4401.
export async function socketClaims(url: URL): Promise<TokenClaims | null> {
  const token = url.searchParams.get('token')
  if (!token) return null
  const verified = await verifyToken(token)
  return verified.ok ? verified.claims : null
}
