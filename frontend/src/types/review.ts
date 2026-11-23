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
