// The login token of THIS browser tab (team decision A10a).
//
// sessionStorage is separate for each tab and survives a reload of that tab, so two tabs
// can be logged in as two different users (needed for the real-time demo). A new tab
// starts logged out.
//
// The frontend never checks the token's signature (only the services can). It only reads
// the claims inside, to know who is logged in and when the token expires.
import type { AuthUser, TokenClaims } from '../types/auth'

const TOKEN_KEY = 'cedar-rye.token'

// The middle part of "header.payload.signature" is base64url-encoded JSON.
function readClaims(token: string): TokenClaims | null {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = new TextDecoder().decode(Uint8Array.from(atob(payload), (c) => c.charCodeAt(0)))
    const claims = JSON.parse(json) as TokenClaims
    return typeof claims.sub === 'string' && typeof claims.exp === 'number' ? claims : null
  } catch {
    return null
  }
}

// The stored token, or null if there is none or it has expired (A14a: an expired token = logged out).
export function currentToken(): string | null {
  const token = sessionStorage.getItem(TOKEN_KEY)
  if (!token) return null
  const claims = readClaims(token)
  if (!claims || claims.exp * 1000 <= Date.now()) {
    sessionStorage.removeItem(TOKEN_KEY)
    return null
  }
  return token
}

// Who is logged in, from the token.
export function currentUser(): AuthUser | null {
  const token = currentToken()
  const claims = token ? readClaims(token) : null
  return claims ? { id: claims.sub, role: claims.role, name: claims.name } : null
}

export function saveToken(token: string) {
  sessionStorage.setItem(TOKEN_KEY, token)
}

export function clearToken() {
  sessionStorage.removeItem(TOKEN_KEY)
}

// A service answered 401 (or a WebSocket closed with 4401): the token is missing, invalid
// or expired. The AuthProvider listens for this event and sends the user to the login page.
export const SESSION_ENDED_EVENT = 'cedar-rye:session-ended'

export function endSession() {
  clearToken()
  window.dispatchEvent(new Event(SESSION_ENDED_EVENT))
}
