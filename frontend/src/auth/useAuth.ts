// Who is logged in in this tab (React context), the hook pages use to read it,
// and each role's home page. Kept apart from the provider component because the React
// fast-refresh lint rule wants component files to export only components.
import { createContext, useContext } from 'react'
import type { AuthUser, LoginRequest, Role, SignupRequest } from '../types/auth'

export type Auth = {
  user: AuthUser | null // null = logged out
  logIn: (body: LoginRequest) => Promise<AuthUser>
  signUp: (body: SignupRequest) => Promise<AuthUser>
  logOut: (notice?: string) => void // notice: shown on the search page afterwards
}

export const AuthContext = createContext<Auth | null>(null)

// Usage in any page or component: const { user } = useAuth()
export function useAuth(): Auth {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>.')
  return value
}

// Where each role starts, and where a wrong-role page sends you.
export const HOME: Record<Role, string> = {
  guest: '/',
  host: '/host/listings',
  admin: '/dashboards/platform',
}

// "guests" / "hosts" / "the admin", for short notes.
export const ROLE_PLURAL: Record<Role, string> = { guest: 'guests', host: 'hosts', admin: 'the admin' }

// The "?next=" page to return to after logging in. Only a path inside this app is accepted
// ("/guest/trips"), never another site ("https://…" or "//evil.example"), so a link can't
// use our login page to send someone elsewhere.
export function safeNext(value: string | null): string | null {
  return value && value.startsWith('/') && !value.startsWith('//') ? value : null
}
