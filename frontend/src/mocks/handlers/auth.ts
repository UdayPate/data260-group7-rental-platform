// Mock User Service: POST /auth/signup and POST /auth/login.
// Passwords are hashed with bcrypt (bcryptjs, cost 10); only the hash is stored.
import bcrypt from 'bcryptjs'
import { delay, http, HttpResponse } from 'msw'
import type { AuthUser } from '../../types/auth'
import { ADMIN, type Account } from '../data/accounts'
import { signToken } from '../auth/jwt'
import { db } from '../db'
import { errorResponse, invalidJsonResponse, MOCK_DELAY_MS, readBody, requireFields } from '../responses'
import { createGuestRecord, createHostRecord, emailTaken } from './users'

const isEmail = (value: unknown) => typeof value === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)
const MIN_PASSWORD_LENGTH = 8

// The name shown in the header (and put in the token).
function userFor(account: Account): AuthUser | null {
  if (account.role === 'admin') return { id: account.user_id, role: 'admin', name: ADMIN.name }
  if (account.role === 'guest') {
    const g = db.guests.find((x) => x.guest_id === account.user_id)
    return g ? { id: g.guest_id, role: 'guest', name: `${g.first_name} ${g.last_name}` } : null
  }
  const h = db.hosts.find((x) => x.host_id === account.user_id)
  return h ? { id: h.host_id, role: 'host', name: h.name } : null
}

export const authHandlers = [
  http.post('*/auth/signup', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    if (body.role !== 'guest' && body.role !== 'host') {
      return errorResponse('VALIDATION_ERROR', 'Choose whether this is a guest or a host account.')
    }
    const fields = body.role === 'guest' ? ['email', 'password', 'first_name', 'last_name', 'phone', 'location'] : ['email', 'password', 'name', 'phone']
    const missing = requireFields(body, fields)
    if (missing) return missing
    if (!isEmail(body.email)) return errorResponse('VALIDATION_ERROR', 'Please enter a valid email address.')
    if (String(body.password).length < MIN_PASSWORD_LENGTH) {
      return errorResponse('VALIDATION_ERROR', `The password must be at least ${MIN_PASSWORD_LENGTH} characters.`)
    }
    if (emailTaken(String(body.email))) return errorResponse('EMAIL_TAKEN', 'An account with this email already exists. Log in instead.')

    // Create the guest or host, then its login with the bcrypt hash (never the password itself).
    const record = body.role === 'guest' ? createGuestRecord(body) : createHostRecord(body)
    const account: Account = {
      email: String(body.email),
      password_hash: await bcrypt.hash(String(body.password), 10),
      role: body.role,
      user_id: 'guest_id' in record ? record.guest_id : record.host_id,
    }
    db.accounts.push(account)
    const user = userFor(account)!
    return HttpResponse.json({ token: await signToken(user), user }, { status: 201 })
  }),

  http.post('*/auth/login', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['email', 'password'])
    if (missing) return missing
    const account = db.accounts.find((a) => a.email.toLowerCase() === String(body.email).toLowerCase())
    // Same answer for an unknown email and a wrong password, so nobody can probe which emails exist.
    const ok = account !== undefined && (await bcrypt.compare(String(body.password), account.password_hash))
    const user = ok ? userFor(account) : null
    if (!user) return errorResponse('UNAUTHENTICATED', 'Wrong email or password.')
    return HttpResponse.json({ token: await signToken(user), user })
  }),
]
