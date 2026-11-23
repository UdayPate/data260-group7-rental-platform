import type { AvailabilityBlock } from '../../types/availability'
import { daysAgoDatetime, daysFromToday } from '../dates'

// Dates the HOST blocked (owner use, maintenance). Dates held by reservations
// are not listed here: db.ts adds a "booked" block for every pending or approved reservation.
export const seedHostBlocks: AvailabilityBlock[] = [
  { availability_id: 'a_001', property_id: 'p_001', start_date: daysFromToday(40), end_date: daysFromToday(45),
    status: 'blocked', source: 'host', updated_datetime: daysAgoDatetime(30) },
  { availability_id: 'a_002', property_id: 'p_005', start_date: daysFromToday(25), end_date: daysFromToday(27),
    status: 'blocked', source: 'host', updated_datetime: daysAgoDatetime(12) },
  { availability_id: 'a_003', property_id: 'p_014', start_date: daysFromToday(3), end_date: daysFromToday(6),
    status: 'blocked', source: 'host', updated_datetime: daysAgoDatetime(4) },
  { availability_id: 'a_004', property_id: 'p_023', start_date: daysFromToday(7), end_date: daysFromToday(9),
    status: 'blocked', source: 'host', updated_datetime: daysAgoDatetime(7) },
  { availability_id: 'a_005', property_id: 'p_010', start_date: daysFromToday(2), end_date: daysFromToday(3),
    status: 'blocked', source: 'host', updated_datetime: daysAgoDatetime(2) },
]
