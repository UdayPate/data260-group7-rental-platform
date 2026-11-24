// Mock Review Service: /reviews/*
// Rules (team decisions C1a-C3a, see docs/api/data-contract.md):
//  - a review needs a completed stay, written by that stay's guest, once per reservation
//  - a new review updates the listing's rating and review_count
//  - only the listing's host replies, once; reviews can't be edited or deleted
import { delay, http, HttpResponse } from 'msw'
import {
  RESPONSE_TEXT_MAX,
  RESPONSE_TEXT_MIN,
  REVIEW_TEXT_MAX,
  REVIEW_TEXT_MIN,
  type Review,
} from '../../types/review'
import { nowDatetime } from '../dates'
import { db, nextId } from '../db'
import { checkPaging, errorResponse, invalidJsonResponse, MOCK_DELAY_MS, paginate, readBody, requireFields } from '../responses'

const reviewNotFound = (id: unknown) => errorResponse('NOT_FOUND', `No review found with id ${String(id)}.`)
const textLength = (value: unknown) => (typeof value === 'string' ? value.trim().length : 0)
const newestFirst = (a: Review, b: Review) => b.created_datetime.localeCompare(a.created_datetime)

export const reviewHandlers = [
  http.post('*/reviews/create', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['reservation_id', 'guest_id', 'rating', 'review_text'])
    if (missing) return missing
    if (!Number.isInteger(body.rating) || (body.rating as number) < 1 || (body.rating as number) > 5) {
      return errorResponse('VALIDATION_ERROR', 'Pick a rating from 1 to 5 stars.')
    }
    const length = textLength(body.review_text)
    if (length < REVIEW_TEXT_MIN || length > REVIEW_TEXT_MAX) {
      return errorResponse('VALIDATION_ERROR', `Please write between ${REVIEW_TEXT_MIN} and ${REVIEW_TEXT_MAX} characters.`)
    }

    const reservation = db.reservations.find((r) => r.reservation_id === body.reservation_id)
    if (!reservation) return errorResponse('NOT_FOUND', `No reservation found with id ${String(body.reservation_id)}.`)
    if (reservation.guest_id !== body.guest_id) return errorResponse('UNAUTHORIZED', 'You can only review your own stays.')
    if (reservation.status !== 'completed') {
      return errorResponse('INVALID_STATUS', 'You can review a stay once it’s completed.')
    }
    if (db.reviews.some((r) => r.reservation_id === reservation.reservation_id)) {
      return errorResponse('DUPLICATE_REVIEW', 'You already reviewed this stay.')
    }
    const property = db.properties.find((p) => p.property_id === reservation.property_id)
    if (!property) return errorResponse('NOT_FOUND', 'This listing no longer exists, so it can’t be reviewed.')

    const review: Review = {
      review_id: nextId('v', db.reviews.map((r) => r.review_id)),
      reservation_id: reservation.reservation_id,
      property_id: property.property_id,
      guest_id: reservation.guest_id,
      host_id: property.host_id,
      rating: body.rating as number,
      review_text: String(body.review_text).trim(),
      created_datetime: nowDatetime(),
      response_text: null,
    }
    db.reviews.push(review)

    // New average over the listing's whole history: (old average x old count + new) / (count + 1).
    const total = property.rating * property.review_count + review.rating
    property.review_count += 1
    property.rating = Math.round((total / property.review_count) * 100) / 100
    return HttpResponse.json(review, { status: 201 })
  }),

  http.post('*/reviews/get', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['review_id'])
    if (missing) return missing
    const review = db.reviews.find((r) => r.review_id === body.review_id)
    return review ? HttpResponse.json(review) : reviewNotFound(body.review_id)
  }),

  http.post('*/reviews/byProperty', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['property_id'])
    if (missing) return missing
    const badPaging = checkPaging(body.page, body.page_size)
    if (badPaging) return badPaging
    if (!db.properties.some((p) => p.property_id === body.property_id)) {
      return errorResponse('NOT_FOUND', `No property found with id ${String(body.property_id)}.`)
    }
    const items = db.reviews.filter((r) => r.property_id === body.property_id).sort(newestFirst)
    return HttpResponse.json(paginate(items, body.page as number, body.page_size as number))
  }),

  http.post('*/reviews/byGuest', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['guest_id'])
    if (missing) return missing
    if (!db.guests.some((g) => g.guest_id === body.guest_id)) {
      return errorResponse('NOT_FOUND', `No guest found with id ${String(body.guest_id)}.`)
    }
    return HttpResponse.json({ items: db.reviews.filter((r) => r.guest_id === body.guest_id).sort(newestFirst) })
  }),

  http.post('*/reviews/respond', async ({ request }) => {
    await delay(MOCK_DELAY_MS)
    const body = await readBody(request)
    if (!body) return invalidJsonResponse()
    const missing = requireFields(body, ['review_id', 'host_id', 'response_text'])
    if (missing) return missing
    const length = textLength(body.response_text)
    if (length < RESPONSE_TEXT_MIN || length > RESPONSE_TEXT_MAX) {
      return errorResponse('VALIDATION_ERROR', `Please write between ${RESPONSE_TEXT_MIN} and ${RESPONSE_TEXT_MAX} characters.`)
    }
    const review = db.reviews.find((r) => r.review_id === body.review_id)
    if (!review) return reviewNotFound(body.review_id)
    if (review.host_id !== body.host_id) return errorResponse('UNAUTHORIZED', 'Only the host of this listing can reply to its reviews.')
    if (review.response_text !== null) return errorResponse('DUPLICATE_REVIEW', 'You already replied to this review.')
    review.response_text = String(body.response_text).trim()
    return HttpResponse.json(review)
  }),
]
