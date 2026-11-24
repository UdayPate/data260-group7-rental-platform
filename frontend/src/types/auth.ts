// Authentication contract (User Service, /auth/*). See docs/api/data-contract.md,
// section "Authentication and roles".

export type Role = 'guest' | 'host' | 'admin'

// What the token says about who is logged in.
export type AuthUser = {
  id: string // guest_id, host_id or admin id (e.g. "g_001", "h_001", "adm_001")
  role: Role
  name: string
}

// Inside the JWT (team decision A4a). Times are seconds since 1970, as JWTs use.
export type TokenClaims = {
  sub: string // the user's id
  role: Role
  name: string
  iat: number // issued at
  exp: number // expires at (iat + 8 hours)
}

// --- Request bodies ---

export type LoginRequest = { email: string; password: string }

// Sign-up creates the Guest or Host and its login together (team decision A6a).
// There is no admin sign-up.
export type GuestSignupRequest = {
  role: 'guest'
  email: string
  password: string // at least 8 characters
  first_name: string
  last_name: string
  phone: string
  location: string
}
export type HostSignupRequest = {
  role: 'host'
  email: string
  password: string
  name: string
  phone: string
}
export type SignupRequest = GuestSignupRequest | HostSignupRequest

// Response of both /auth/signup (201) and /auth/login (200).
export type AuthResponse = { token: string; user: AuthUser }
