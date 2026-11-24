// Spec section 4: Review.
export type Review = {
  review_id: string
  reservation_id: string
  property_id: string
  guest_id: string
  host_id: string
  rating: number // whole number 1-5
  review_text: string
  created_datetime: string
  response_text: string | null // host's reply
}

// --- Request bodies (Review Service, /reviews/*) ---

// Lengths the server checks (and the UI shows as hints).
export const REVIEW_TEXT_MIN = 20
export const REVIEW_TEXT_MAX = 1000
export const RESPONSE_TEXT_MIN = 10
export const RESPONSE_TEXT_MAX = 1000

// Only for a completed stay, only by its guest, once per reservation.
// The server fills property_id and host_id from the reservation.
export type CreateReviewRequest = {
  reservation_id: string
  guest_id: string
  rating: number // 1-5
  review_text: string
}

export type GetReviewRequest = { review_id: string }

// Newest first.
export type ReviewsByPropertyRequest = { property_id: string; page: number; page_size: number }

// Extension (not in the spec): a guest's own reviews, to know which stays still need one.
export type ReviewsByGuestRequest = { guest_id: string }

// Only the listing's host, once per review.
export type RespondToReviewRequest = { review_id: string; host_id: string; response_text: string }
