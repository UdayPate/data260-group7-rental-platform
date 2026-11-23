import type { Host } from '../../types/host'
import { daysFromToday } from '../dates'

// 8 hosts. h_003 is the "risky" host: slow to reply and has host-side cancellations.
// Emails use example.com and phones use 555-01xx, which are reserved for fake data.
export const seedHosts: Host[] = [
  { host_id: 'h_001', name: 'Maya Ortiz', email: 'maya.ortiz@example.com', phone: '(408) 555-0101', profile_photo_url: '',
    verification_status: 'verified', response_rate: 98, response_time: 22, host_since: daysFromToday(-1460), access_level: 'superhost' },
  { host_id: 'h_002', name: 'Daniel Kim', email: 'daniel.kim@example.com', phone: '(408) 555-0102', profile_photo_url: '',
    verification_status: 'verified', response_rate: 95, response_time: 45, host_since: daysFromToday(-1100), access_level: 'standard' },
  { host_id: 'h_003', name: 'Rob Feeney', email: 'rob.feeney@example.com', phone: '(408) 555-0103', profile_photo_url: '',
    verification_status: 'pending', response_rate: 62, response_time: 540, host_since: daysFromToday(-300), access_level: 'standard' },
  { host_id: 'h_004', name: 'Priya Raman', email: 'priya.raman@example.com', phone: '(408) 555-0104', profile_photo_url: '',
    verification_status: 'verified', response_rate: 97, response_time: 30, host_since: daysFromToday(-1825), access_level: 'superhost' },
  { host_id: 'h_005', name: 'Luis Herrera', email: 'luis.herrera@example.com', phone: '(669) 555-0105', profile_photo_url: '',
    verification_status: 'verified', response_rate: 90, response_time: 75, host_since: daysFromToday(-900), access_level: 'standard' },
  { host_id: 'h_006', name: 'Grace Liu', email: 'grace.liu@example.com', phone: '(650) 555-0106', profile_photo_url: '',
    verification_status: 'verified', response_rate: 99, response_time: 15, host_since: daysFromToday(-2200), access_level: 'superhost' },
  { host_id: 'h_007', name: 'Tom Becker', email: 'tom.becker@example.com', phone: '(650) 555-0107', profile_photo_url: '',
    verification_status: 'pending', response_rate: 85, response_time: 120, host_since: daysFromToday(-420), access_level: 'standard' },
  { host_id: 'h_008', name: 'Aisha Bello', email: 'aisha.bello@example.com', phone: '(408) 555-0108', profile_photo_url: '',
    verification_status: 'verified', response_rate: 93, response_time: 60, host_since: daysFromToday(-760), access_level: 'standard' },
]
