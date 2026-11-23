// The one fetch wrapper every API module uses. It sends JSON, and turns any
// failure into an ApiError with a readable message the UI can show as-is.
import type { ApiErrorBody, ApiErrorCode } from '../types/api'

// Extra codes for failures that never reach a service's error body.
type ClientErrorCode = 'NETWORK_ERROR' | 'UNKNOWN_ERROR'

export class ApiError extends Error {
  status: number // HTTP status, or 0 if the server couldn't be reached
  code: ApiErrorCode | ClientErrorCode
  details?: Record<string, unknown>

  constructor(status: number, code: ApiErrorCode | ClientErrorCode, message: string, details?: Record<string, unknown>) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
  }
}

// Checks that a response body really has our { error: { code, message } } shape.
function isApiErrorBody(data: unknown): data is ApiErrorBody {
  if (typeof data !== 'object' || data === null || !('error' in data)) return false
  const error = (data as { error: unknown }).error
  return typeof error === 'object' && error !== null && 'message' in error && 'code' in error
}

async function request<T>(method: 'GET' | 'POST', url: string, body?: unknown): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    // fetch only throws when no response came back at all (server down, no network, CORS).
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the server. Check that the service is running.')
  }

  // Some error responses have no JSON body; treat those as null.
  const data: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    if (isApiErrorBody(data)) {
      throw new ApiError(response.status, data.error.code, data.error.message, data.error.details)
    }
    throw new ApiError(response.status, 'UNKNOWN_ERROR', `The request failed (HTTP ${response.status}). Please try again.`)
  }

  return data as T
}

// Most spec endpoints are POST with a JSON body, even for reads.
export function post<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
  return request<T>('POST', baseUrl + path, body)
}

// Used by the few GET endpoints (analytics and AI).
export function get<T>(baseUrl: string, path: string): Promise<T> {
  return request<T>('GET', baseUrl + path)
}

// The message to show for any caught error (an ApiError's message is already readable).
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}
