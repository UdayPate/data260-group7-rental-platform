import type { Message, Thread } from '../../types/message'
import { daysAgoDatetime } from '../dates'

// Seed conversations (team decision S2a). guest_name / host_name / property_title are
// filled in by db.ts from the guest, host and property records, so they always match.
export type SeedThread = Omit<Thread, 'guest_name' | 'host_name' | 'property_title'>

export const seedThreads: SeedThread[] = [
  { thread_id: 't_001', guest_id: 'g_001', host_id: 'h_001', property_id: 'p_005', reservation_id: 'r_008', created_datetime: daysAgoDatetime(6) },
  { thread_id: 't_002', guest_id: 'g_002', host_id: 'h_001', property_id: 'p_001', reservation_id: 'r_003', created_datetime: daysAgoDatetime(1) },
  { thread_id: 't_003', guest_id: 'g_007', host_id: 'h_001', property_id: 'p_024', reservation_id: 'r_020', created_datetime: daysAgoDatetime(3) },
  { thread_id: 't_004', guest_id: 'g_005', host_id: 'h_003', property_id: 'p_002', reservation_id: 'r_004', created_datetime: daysAgoDatetime(19) },
  { thread_id: 't_005', guest_id: 'g_012', host_id: 'h_006', property_id: 'p_008', reservation_id: 'r_013', created_datetime: daysAgoDatetime(14) },
]

// Delivery states (C3a): "read" = the receiver opened the thread; "delivered" = it reached
// their thread list; "sent" = stored but not seen by the receiver yet.
// Unread at start: Alex has 1 (m_004), Maya has 1 (m_005), Olivia has 1 (m_007), Rob has 1 (m_010).
export const seedMessages: Message[] = [
  // Alex <-> Maya about Santana Row (r_008)
  { message_id: 'm_001', thread_id: 't_001', sender_id: 'g_001', receiver_id: 'h_001', timestamp: daysAgoDatetime(6),
    message_text: 'Hi Maya! Looking forward to the stay. Is the garage EV charger free to use?', delivery_status: 'read' },
  { message_id: 'm_002', thread_id: 't_001', sender_id: 'h_001', receiver_id: 'g_001', timestamp: daysAgoDatetime(5.98),
    message_text: 'Hi Alex! Yes, the charger is included. The garage code arrives the day before check-in.', delivery_status: 'read' },
  { message_id: 'm_003', thread_id: 't_001', sender_id: 'g_001', receiver_id: 'h_001', timestamp: daysAgoDatetime(2),
    message_text: 'Perfect, thanks! We might arrive after 9 pm. Is a late check-in okay?', delivery_status: 'read' },
  { message_id: 'm_004', thread_id: 't_001', sender_id: 'h_001', receiver_id: 'g_001', timestamp: daysAgoDatetime(1.9),
    message_text: 'Late check-in is fine. It’s self check-in with a keypad, so arrive whenever suits you.', delivery_status: 'delivered' },

  // Sam -> Maya about Willow Glen (r_003, still pending)
  { message_id: 'm_005', thread_id: 't_002', sender_id: 'g_002', receiver_id: 'h_001', timestamp: daysAgoDatetime(1),
    message_text: 'Hi! Is early check-in possible, around noon?', delivery_status: 'delivered' },

  // Olivia <-> Maya about Shoreline (r_020)
  { message_id: 'm_006', thread_id: 't_003', sender_id: 'g_007', receiver_id: 'h_001', timestamp: daysAgoDatetime(3),
    message_text: 'I need a quiet place to work for two days. How fast is the wifi?', delivery_status: 'read' },
  { message_id: 'm_007', thread_id: 't_003', sender_id: 'h_001', receiver_id: 'g_007', timestamp: daysAgoDatetime(2.9),
    message_text: 'About 500 Mbps, and there are two desks with monitors.', delivery_status: 'sent' },

  // Hannah <-> Rob about the cancelled studio (r_004)
  { message_id: 'm_008', thread_id: 't_004', sender_id: 'g_005', receiver_id: 'h_003', timestamp: daysAgoDatetime(19),
    message_text: 'Hi Rob, I just got a cancellation notice. Is the studio really unavailable?', delivery_status: 'read' },
  { message_id: 'm_009', thread_id: 't_004', sender_id: 'h_003', receiver_id: 'g_005', timestamp: daysAgoDatetime(18.5),
    message_text: 'Sorry, it was double-booked on another site.', delivery_status: 'read' },
  { message_id: 'm_010', thread_id: 't_004', sender_id: 'g_005', receiver_id: 'h_003', timestamp: daysAgoDatetime(18.4),
    message_text: 'That’s frustrating. I’ll look elsewhere.', delivery_status: 'delivered' },

  // Ravi <-> Grace about Naglee Park (r_013)
  { message_id: 'm_011', thread_id: 't_005', sender_id: 'g_012', receiver_id: 'h_006', timestamp: daysAgoDatetime(14),
    message_text: 'Where should I park when I arrive?', delivery_status: 'read' },
  { message_id: 'm_012', thread_id: 't_005', sender_id: 'h_006', receiver_id: 'g_012', timestamp: daysAgoDatetime(13.9),
    message_text: 'The driveway spot on the left is yours. The gate code is in your check-in email.', delivery_status: 'read' },
]
