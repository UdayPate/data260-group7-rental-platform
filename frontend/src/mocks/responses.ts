// Small helpers shared by all mock handlers.
import { HttpResponse } from 'msw'
import type { ApiErrorCode } from '../types/api'

// Every mock response waits this long, so loading states are visible.
export const MOCK_DELAY_MS = 400

// Status code for each error code (matches docs/api/data-contract.md).
const STATUS_FOR_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHORIZED: 403,
  NOT_FOUND: 404,
  DATE_CONFLICT: 409,
  DUPLICATE_BOOKING: 409,
  INVALID_STATUS: 409,
  SERVICE_UNAVAILABLE: 503,
}

// An error response in the contract's shape: { error: { code, message, details? } }.
export function errorResponse(code: ApiErrorCode, message: string, details?: Record<string, unknown>) {
  return HttpResponse.json({ error: { code, message, details } }, { status: STATUS_FOR_CODE[code] })
}

// Reads the JSON body as a plain object, or null if it isn't valid JSON / isn't an object.
export async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json()
    return typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null
  } catch {
    return null
  }
}

// Returns a 400 response if any listed field is missing or empty, otherwise null.
export function requireFields(body: Record<string, unknown>, fields: string[]) {
  const missing = fields.filter((f) => body[f] === undefined || body[f] === null || body[f] === '')
  if (missing.length === 0) return null
  return errorResponse('VALIDATION_ERROR', `Missing required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}.`, {
    missing_fields: missing,
  })
}

export const invalidJsonResponse = () => errorResponse('VALIDATION_ERROR', 'The request body must be a JSON object.')

// Cuts one page out of a list. Pages start at 1.
export function paginate<T>(items: T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize
  return { items: items.slice(start, start + pageSize), total: items.length, page, page_size: pageSize }
}

// Validates page/page_size. Returns a 400 response, or null if they're fine.
export function checkPaging(page: unknown, pageSize: unknown) {
  if (!Number.isInteger(page) || (page as number) < 1) {
    return errorResponse('VALIDATION_ERROR', 'page must be a whole number of 1 or more.')
  }
  if (!Number.isInteger(pageSize) || (pageSize as number) < 1 || (pageSize as number) > 100) {
    return errorResponse('VALIDATION_ERROR', 'page_size must be a whole number from 1 to 100.')
  }
  return null
}
