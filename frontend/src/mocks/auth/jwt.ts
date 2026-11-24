// Real JSON Web Tokens (JWT) for the mock User Service, signed with HS256 (HMAC-SHA-256)
// using the browser's built-in Web Crypto (team decision A2a). Any JWT library can
// verify them with the secret below.
//
// !! DEVELOPMENT ONLY !! This secret is in frontend code, so anyone can read it.
// The real services must NEVER use it: their JWT_SECRET lives only in each service's
// .env file, which is never committed (see docs/api/data-contract.md).
import type { Role, TokenClaims } from '../../types/auth'

export const DEV_ONLY_JWT_SECRET = 'cedar-rye-mock-secret-DO-NOT-USE-IN-REAL-SERVICES'

export const TOKEN_LIFETIME_SECONDS = 8 * 60 * 60 // one fixed expiry: 8 hours

// base64url = base64 with URL-safe characters and no "=" padding (the JWT format).
function base64url(bytes: Uint8Array): string {
  let text = ''
  for (const b of bytes) text += String.fromCharCode(b)
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/')
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
}
const utf8 = new TextEncoder()

async function hmacKey() {
  return crypto.subtle.importKey('raw', utf8.encode(DEV_ONLY_JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify'])
}

// header.payload.signature
export async function signToken(user: { id: string; role: Role; name: string }): Promise<string> {
  const now = Math.floor(Date.now() / 1000)
  const claims: TokenClaims = { sub: user.id, role: user.role, name: user.name, iat: now, exp: now + TOKEN_LIFETIME_SECONDS }
  const header = base64url(utf8.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })))
  const payload = base64url(utf8.encode(JSON.stringify(claims)))
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(), utf8.encode(`${header}.${payload}`))
  return `${header}.${payload}.${base64url(new Uint8Array(signature))}`
}

export type VerifyResult = { ok: true; claims: TokenClaims } | { ok: false; reason: 'invalid' | 'expired' }

// Checks the signature first, then the expiry. Anything malformed is "invalid".
export async function verifyToken(token: string): Promise<VerifyResult> {
  const parts = token.split('.')
  if (parts.length !== 3) return { ok: false, reason: 'invalid' }
  const [header, payload, signature] = parts
  try {
    const valid = await crypto.subtle.verify('HMAC', await hmacKey(), fromBase64url(signature), utf8.encode(`${header}.${payload}`))
    if (!valid) return { ok: false, reason: 'invalid' }
    const claims = JSON.parse(new TextDecoder().decode(fromBase64url(payload))) as TokenClaims
    if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) return { ok: false, reason: 'expired' }
    return { ok: true, claims }
  } catch {
    return { ok: false, reason: 'invalid' }
  }
}
