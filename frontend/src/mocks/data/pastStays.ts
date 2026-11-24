// Older completed stays with reviews, so San Jose listings show real reviews in the demo
// (team decision S1a). One row = one completed reservation + the guest's review.
// Alex (g_001) has none here, so his demo story is unchanged. Stays start 120+ days ago
// and are spaced so no two overlap on the same listing. The listing's rating/review_count
// in properties.ts is still its whole history ("Showing N of M" on the property page).
import type { Review } from '../../types/review'
import { daysAgoDatetime, daysFromToday } from '../dates'
import { seedProperties } from './properties'
import type { SeedReservation } from './reservations'

type PastStay = {
  reservationId: string
  reviewId: string
  propertyId: string
  guestId: string
  startedDaysAgo: number // check-in this many days ago
  nights: number
  guests: number
  rating: number
  text: string
  reply?: string // the host's reply, if any
}

const STAYS: PastStay[] = [
  // p_001 Willow Glen Craftsman Cottage (4.86)
  { reservationId: 'r_025', reviewId: 'v_007', propertyId: 'p_001', guestId: 'g_004', startedDaysAgo: 120, nights: 3, guests: 2, rating: 5,
    text: 'Charming cottage on a quiet street. Spotless, and the kitchen had everything we needed.', reply: 'Thanks Marcus, hope to see you again!' },
  { reservationId: 'r_026', reviewId: 'v_008', propertyId: 'p_001', guestId: 'g_008', startedDaysAgo: 155, nights: 2, guests: 2, rating: 5,
    text: 'Perfect weekend base for exploring Willow Glen.' },
  { reservationId: 'r_027', reviewId: 'v_009', propertyId: 'p_001', guestId: 'g_011', startedDaysAgo: 190, nights: 4, guests: 4, rating: 4,
    text: 'Lovely house and great host communication. The second bedroom is a little small for two adults, but the location on Lincoln Avenue made up for it, and parking in the driveway was easy.',
    reply: 'Thank you, Zoe! Noted on the second bedroom; we have added a better mattress.' },
  { reservationId: 'r_028', reviewId: 'v_010', propertyId: 'p_001', guestId: 'g_006', startedDaysAgo: 225, nights: 2, guests: 2, rating: 5,
    text: 'Would stay again in a heartbeat.' },

  // p_002 Budget Studio near SJSU (4.6) - slow host, evidence for the Risk agent
  { reservationId: 'r_029', reviewId: 'v_011', propertyId: 'p_002', guestId: 'g_003', startedDaysAgo: 125, nights: 2, guests: 1, rating: 5,
    text: 'Great value for a short stay near campus.' },
  { reservationId: 'r_030', reviewId: 'v_012', propertyId: 'p_002', guestId: 'g_010', startedDaysAgo: 160, nights: 3, guests: 2, rating: 3,
    text: 'The studio was fine, but it took the host almost a day to send check-in details, and we waited outside for 40 minutes.' },
  { reservationId: 'r_031', reviewId: 'v_013', propertyId: 'p_002', guestId: 'g_009', startedDaysAgo: 195, nights: 2, guests: 2, rating: 4,
    text: 'Good location and cheap. The host is slow to reply, so plan ahead.' },

  // p_003 Rose Garden Bungalow (4.72)
  { reservationId: 'r_032', reviewId: 'v_014', propertyId: 'p_003', guestId: 'g_002', startedDaysAgo: 130, nights: 3, guests: 2, rating: 5,
    text: 'Beautiful bungalow near the Rose Garden. The desk made it easy to work for a couple of days.', reply: 'Thanks Sam, glad the workspace helped!' },
  { reservationId: 'r_033', reviewId: 'v_015', propertyId: 'p_003', guestId: 'g_012', startedDaysAgo: 165, nights: 2, guests: 3, rating: 4,
    text: 'Comfortable and clean, with some street noise in the morning.' },
  { reservationId: 'r_034', reviewId: 'v_016', propertyId: 'p_003', guestId: 'g_007', startedDaysAgo: 200, nights: 4, guests: 2, rating: 5,
    text: 'Daniel’s tips for nearby cafes were spot on. Quiet nights and a well-stocked kitchen.', reply: 'Thanks Olivia!' },

  // p_004 Japantown Loft (4.42)
  { reservationId: 'r_035', reviewId: 'v_017', propertyId: 'p_004', guestId: 'g_005', startedDaysAgo: 135, nights: 2, guests: 2, rating: 4,
    text: 'Nice loft in Japantown, close to the farmers market.', reply: 'Thank you, Hannah!' },
  { reservationId: 'r_036', reviewId: 'v_018', propertyId: 'p_004', guestId: 'g_008', startedDaysAgo: 170, nights: 3, guests: 1, rating: 3,
    text: 'Stylish, but the AC struggled on a hot afternoon and the courtyard was noisier than expected. Priya fixed what she could quickly.',
    reply: 'Sorry about the AC, Diego. It has been serviced since.' },
  { reservationId: 'r_037', reviewId: 'v_019', propertyId: 'p_004', guestId: 'g_011', startedDaysAgo: 205, nights: 2, guests: 2, rating: 5,
    text: 'Loved the neighborhood and the light in the loft.' },
  { reservationId: 'r_038', reviewId: 'v_020', propertyId: 'p_004', guestId: 'g_003', startedDaysAgo: 240, nights: 2, guests: 2, rating: 4,
    text: 'Good stay overall, easy check-in.' },

  // p_005 Santana Row Modern Condo (4.92)
  { reservationId: 'r_039', reviewId: 'v_021', propertyId: 'p_005', guestId: 'g_006', startedDaysAgo: 140, nights: 2, guests: 2, rating: 5,
    text: 'Modern, bright and right by the shops. The pool was a highlight.', reply: 'Thanks Kenji!' },
  { reservationId: 'r_040', reviewId: 'v_022', propertyId: 'p_005', guestId: 'g_012', startedDaysAgo: 175, nights: 3, guests: 3, rating: 5,
    text: 'Everything worked perfectly, including the EV charger in the garage.' },
  { reservationId: 'r_041', reviewId: 'v_023', propertyId: 'p_005', guestId: 'g_004', startedDaysAgo: 210, nights: 2, guests: 2, rating: 5,
    text: 'Exceptional host and a spotless condo.' },

  // p_006 Almaden Valley Family Home (4.95)
  { reservationId: 'r_042', reviewId: 'v_024', propertyId: 'p_006', guestId: 'g_011', startedDaysAgo: 145, nights: 4, guests: 6, rating: 5,
    text: 'Ideal for our family reunion. The pool and hot tub kept the kids busy all week, and the kitchen fit all eight of us comfortably.',
    reply: 'Thank you, Zoe! Come back next summer.' },
  { reservationId: 'r_043', reviewId: 'v_025', propertyId: 'p_006', guestId: 'g_006', startedDaysAgo: 180, nights: 3, guests: 5, rating: 5,
    text: 'Stunning views of the hills.' },
  { reservationId: 'r_044', reviewId: 'v_026', propertyId: 'p_006', guestId: 'g_002', startedDaysAgo: 215, nights: 2, guests: 4, rating: 4,
    text: 'Great house, a bit far from restaurants.', reply: 'Thanks Sam. We have added a list of delivery options.' },

  // p_007 Downtown High-Rise Apartment (4.78)
  { reservationId: 'r_045', reviewId: 'v_027', propertyId: 'p_007', guestId: 'g_009', startedDaysAgo: 150, nights: 2, guests: 1, rating: 5,
    text: 'Amazing skyline views and a short walk to the convention center.' },
  { reservationId: 'r_046', reviewId: 'v_028', propertyId: 'p_007', guestId: 'g_010', startedDaysAgo: 185, nights: 3, guests: 2, rating: 4,
    text: 'Great location, but there is no parking, so the garage nearby added $25 a day.', reply: 'Thanks Liam, we now list nearby garages and their prices.' },
  { reservationId: 'r_047', reviewId: 'v_029', propertyId: 'p_007', guestId: 'g_005', startedDaysAgo: 220, nights: 2, guests: 2, rating: 5,
    text: 'Clean, modern, and surprisingly quiet for downtown.' },

  // p_008 Naglee Park Guest Suite (4.55)
  { reservationId: 'r_048', reviewId: 'v_030', propertyId: 'p_008', guestId: 'g_007', startedDaysAgo: 155, nights: 2, guests: 2, rating: 5,
    text: 'Cozy suite with its own entrance.', reply: 'Thanks Olivia!' },
  { reservationId: 'r_049', reviewId: 'v_031', propertyId: 'p_008', guestId: 'g_003', startedDaysAgo: 190, nights: 3, guests: 1, rating: 4,
    text: 'Comfortable, but the kitchenette is basic.' },
  { reservationId: 'r_050', reviewId: 'v_032', propertyId: 'p_008', guestId: 'g_009', startedDaysAgo: 225, nights: 2, guests: 2, rating: 4,
    text: 'Pretty garden; some street noise at night.' },

  // p_009 North San Jose Tech Corridor Townhouse (4.68)
  { reservationId: 'r_051', reviewId: 'v_033', propertyId: 'p_009', guestId: 'g_004', startedDaysAgo: 160, nights: 4, guests: 4, rating: 5,
    text: 'Great for our team offsite: fast wifi, three bedrooms and an EV charger in the garage.', reply: 'Thanks Marcus, good luck with the launch!' },
  { reservationId: 'r_052', reviewId: 'v_034', propertyId: 'p_009', guestId: 'g_008', startedDaysAgo: 195, nights: 2, guests: 3, rating: 4,
    text: 'Spacious townhouse close to light rail.' },
  { reservationId: 'r_053', reviewId: 'v_035', propertyId: 'p_009', guestId: 'g_010', startedDaysAgo: 230, nights: 3, guests: 5, rating: 5,
    text: 'Clean, quiet, and well equipped.' },
  { reservationId: 'r_054', reviewId: 'v_036', propertyId: 'p_009', guestId: 'g_012', startedDaysAgo: 265, nights: 2, guests: 2, rating: 4,
    text: 'A solid choice in North San Jose.' },

  // p_010 Evergreen Hillside Private Room (4.81)
  { reservationId: 'r_055', reviewId: 'v_037', propertyId: 'p_010', guestId: 'g_003', startedDaysAgo: 165, nights: 2, guests: 1, rating: 5,
    text: 'Peaceful room with amazing valley views.' },
  { reservationId: 'r_056', reviewId: 'v_038', propertyId: 'p_010', guestId: 'g_006', startedDaysAgo: 200, nights: 3, guests: 2, rating: 5,
    text: 'Tom was welcoming and the room was spotless. Note there is no kitchen access, but there are good takeout options nearby.', reply: 'Thanks Kenji!' },
  { reservationId: 'r_057', reviewId: 'v_039', propertyId: 'p_010', guestId: 'g_011', startedDaysAgo: 235, nights: 2, guests: 2, rating: 4,
    text: 'Great value.' },

  // p_011 Berryessa BART-side Condo (4.5)
  { reservationId: 'r_058', reviewId: 'v_040', propertyId: 'p_011', guestId: 'g_005', startedDaysAgo: 170, nights: 3, guests: 2, rating: 4,
    text: 'Very convenient for BART. In-unit laundry was a bonus.' },
  { reservationId: 'r_059', reviewId: 'v_041', propertyId: 'p_011', guestId: 'g_002', startedDaysAgo: 205, nights: 2, guests: 4, rating: 5,
    text: 'Roomy and clean.', reply: 'Thanks Sam!' },
  { reservationId: 'r_060', reviewId: 'v_042', propertyId: 'p_011', guestId: 'g_007', startedDaysAgo: 240, nights: 2, guests: 2, rating: 4,
    text: 'Good condo, if a little dated.' },

  // p_012 Cambrian Park Ranch House (4.38, now inactive)
  { reservationId: 'r_061', reviewId: 'v_043', propertyId: 'p_012', guestId: 'g_010', startedDaysAgo: 175, nights: 3, guests: 4, rating: 4,
    text: 'Nice ranch house, and the hot tub was great after long days.' },
  { reservationId: 'r_062', reviewId: 'v_044', propertyId: 'p_012', guestId: 'g_009', startedDaysAgo: 210, nights: 2, guests: 3, rating: 3,
    text: 'The house was okay, but the host was hard to reach and the check-in instructions came late.' },
  { reservationId: 'r_063', reviewId: 'v_045', propertyId: 'p_012', guestId: 'g_004', startedDaysAgo: 245, nights: 4, guests: 6, rating: 5,
    text: 'Plenty of room for our group.' },
  { reservationId: 'r_064', reviewId: 'v_046', propertyId: 'p_012', guestId: 'g_012', startedDaysAgo: 280, nights: 2, guests: 2, rating: 4,
    text: 'Quiet neighborhood.' },
]

const hostOf = (propertyId: string) => seedProperties.find((p) => p.property_id === propertyId)!.host_id

export const pastStayReservations: SeedReservation[] = STAYS.map((s) => ({
  reservation_id: s.reservationId,
  property_id: s.propertyId,
  guest_id: s.guestId,
  guest_count: s.guests,
  check_in: daysFromToday(-s.startedDaysAgo),
  check_out: daysFromToday(-s.startedDaysAgo + s.nights),
  booking_datetime: daysAgoDatetime(s.startedDaysAgo + 20), // booked about 3 weeks ahead
  status: 'completed',
  cancellation_reason: null,
  guest_message: null,
}))

export const pastStayReviews: Review[] = STAYS.map((s) => ({
  review_id: s.reviewId,
  reservation_id: s.reservationId,
  property_id: s.propertyId,
  guest_id: s.guestId,
  host_id: hostOf(s.propertyId),
  rating: s.rating,
  review_text: s.text,
  created_datetime: daysAgoDatetime(s.startedDaysAgo - s.nights - 2), // two days after check-out
  response_text: s.reply ?? null,
}))
