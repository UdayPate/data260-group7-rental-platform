import type { Review } from '../../types/review'
import { daysAgoDatetime } from '../dates'

// Reviews for the completed seed stays (ids match reservations.ts). Team decision C4a:
// these are the only full review records; each listing's rating/review_count in
// properties.ts is its historical total, which these reviews are part of.
// r_012 (Alex Chen at the Downtown High-Rise) is left unreviewed on purpose, so the
// demo guest has a "To review" prompt. v_003 and v_006 have no host reply yet.
export const seedReviews: Review[] = [
  { review_id: 'v_001', reservation_id: 'r_001', property_id: 'p_001', guest_id: 'g_003', host_id: 'h_001', rating: 5,
    review_text: 'Lovely quiet cottage, spotless kitchen and the driveway made parking easy. Maya answered every question within minutes.',
    created_datetime: daysAgoDatetime(35),
    response_text: 'Thank you, Emily! It was a pleasure hosting you. Come back anytime.' },
  { review_id: 'v_002', reservation_id: 'r_006', property_id: 'p_002', guest_id: 'g_007', host_id: 'h_003', rating: 3,
    review_text: 'The studio itself was fine and close to campus, but the host took most of a day to answer about check-in and the kitchenette was missing basics.',
    created_datetime: daysAgoDatetime(55),
    response_text: null },
  { review_id: 'v_003', reservation_id: 'r_009', property_id: 'p_005', guest_id: 'g_009', host_id: 'h_001', rating: 5,
    review_text: 'Bright, modern condo right by Santana Row. The pool and the EV charger were a big plus. Would stay again.',
    created_datetime: daysAgoDatetime(26),
    response_text: null },
  { review_id: 'v_004', reservation_id: 'r_018', property_id: 'p_022', guest_id: 'g_005', host_id: 'h_002', rating: 4,
    review_text: 'Great location above Castro Street with lots of restaurants. A bit of street noise at night, otherwise excellent.',
    created_datetime: daysAgoDatetime(10),
    response_text: 'Thanks Hannah! We have added earplugs and a white-noise machine for future guests.' },
  { review_id: 'v_005', reservation_id: 'r_021', property_id: 'p_025', guest_id: 'g_008', host_id: 'h_006', rating: 5,
    review_text: 'Peaceful garden suite, very clean, and the Cuesta Park trails are right there. Grace left a helpful local guide.',
    created_datetime: daysAgoDatetime(41),
    response_text: 'So glad you enjoyed the trails, Diego. Thanks for being a wonderful guest!' },
  { review_id: 'v_006', reservation_id: 'r_024', property_id: 'p_016', guest_id: 'g_011', host_id: 'h_008', rating: 4,
    review_text: 'Comfortable apartment for a work trip, fast wifi and a good desk. Check-in instructions could be clearer.',
    created_datetime: daysAgoDatetime(1),
    response_text: null },
]
