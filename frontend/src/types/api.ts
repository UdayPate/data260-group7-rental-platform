// Shapes shared by every service (see docs/api/data-contract.md).
//
// Formats used in all types:
//   IDs        string, e.g. "p_014" (never numbers)
//   dates      "YYYY-MM-DD" string, e.g. "2026-12-04"
//   datetimes  ISO 8601 UTC string, e.g. "2026-11-23T18:05:09Z"
//   money      number of US dollars, e.g. 212.5

// Error codes a service may return, with their HTTP status.
export type ApiErrorCode =
  | 'VALIDATION_ERROR' // 400
  | 'UNAUTHENTICATED' // 401: no token, or it is invalid or expired (log in again); also a wrong email/password
  | 'UNAUTHORIZED' // 403: logged in, but not allowed (wrong role, or someone else's data)
  | 'NOT_FOUND' // 404
  | 'DATE_CONFLICT' // 409
  | 'DUPLICATE_BOOKING' // 409
  | 'INVALID_STATUS' // 409: action not allowed in the reservation's current status
  | 'DUPLICATE_REVIEW' // 409: this stay already has a review, or the review already has a reply
  | 'EMAIL_TAKEN' // 409: another account already uses this email
  | 'SERVICE_UNAVAILABLE' // 503

// Body of every error response.
export type ApiErrorBody = {
  error: {
    code: ApiErrorCode
    message: string // readable sentence the UI shows as-is
    details?: Record<string, unknown>
  }
}

// Response of the paged search endpoints.
export type PagedResponse<T> = {
  items: T[]
  total: number // matches across all pages
  page: number // starts at 1
  page_size: number
}

// Response of the non-paged list endpoints (byProperty, byGuest, availability).
export type ListResponse<T> = {
  items: T[]
}
