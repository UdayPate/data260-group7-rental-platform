// Login accounts for the seed data: one per demo guest and host, plus one admin.
// Every account uses the same password (team decision A12a) so the demo can switch quickly.
//
// Passwords are never stored as plain text: SEED_PASSWORD_HASH is the bcrypt hash of
// DEMO_PASSWORD (cost 10, made once with bcryptjs). The real User Service can put the
// same hash in its seed data, since bcrypt hashes work in any language.
import type { Role } from '../../types/auth'
import { seedGuests } from './guests'
import { seedHosts } from './hosts'

export const DEMO_PASSWORD = 'demo1234'
const SEED_PASSWORD_HASH = '$2b$10$94kmkeOHle3c5ei7/9TY9elQtClBvjpgO7QGQdvBBAhl9sRjzeava'

// The User Service's login table. user_id points at the guest, host or admin.
export type Account = {
  email: string // unique, compared ignoring upper/lower case
  password_hash: string
  role: Role
  user_id: string
}

export const ADMIN = { admin_id: 'adm_001', name: 'Platform Admin', email: 'admin@example.com' }

export const seedAccounts: Account[] = [
  ...seedGuests.map((g) => ({ email: g.email, password_hash: SEED_PASSWORD_HASH, role: 'guest' as const, user_id: g.guest_id })),
  ...seedHosts.map((h) => ({ email: h.email, password_hash: SEED_PASSWORD_HASH, role: 'host' as const, user_id: h.host_id })),
  { email: ADMIN.email, password_hash: SEED_PASSWORD_HASH, role: 'admin', user_id: ADMIN.admin_id },
]

// For the login page's "Demo accounts" list (team decision A11a), shown only when mocks are on.
export const demoAccounts = [
  { email: ADMIN.email, role: 'admin' as const, name: ADMIN.name },
  ...seedGuests.map((g) => ({ email: g.email, role: 'guest' as const, name: `${g.first_name} ${g.last_name}` })),
  ...seedHosts.map((h) => ({ email: h.email, role: 'host' as const, name: h.name })),
]
