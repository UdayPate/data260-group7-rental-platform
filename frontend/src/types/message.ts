export type DeliveryStatus = 'sent' | 'delivered' | 'read'

// Spec section 4 "conversation": one thread per guest + host + listing (team decision C1a).
// guest_name / host_name / property_title are copied in when the thread is opened, so the
// thread list needs one call (team decision C2a).
export type Thread = {
  thread_id: string
  guest_id: string
  host_id: string
  property_id: string
  reservation_id: string | null // the latest reservation the thread was opened from
  created_datetime: string
  guest_name: string
  host_name: string
  property_title: string
}

// Spec section 4: Message. receiver_id is the other participant of the thread.
export type Message = {
  message_id: string
  thread_id: string
  sender_id: string
  receiver_id: string
  timestamp: string
  message_text: string
  delivery_status: DeliveryStatus
}

// What the thread list shows, for the user who asked.
export type ThreadSummary = Thread & {
  last_message: { text: string; timestamp: string; sender_id: string } | null
  unread_count: number // messages to this user that aren't "read" yet
}

// --- Request bodies (Messaging Service) ---

export const MESSAGE_TEXT_MAX = 2000

// actor_id = who is opening it (the guest or the host). A host may only open a thread
// with a guest who has a reservation at that listing (team decision C5a).
export type OpenThreadRequest = {
  guest_id: string
  host_id: string
  property_id: string
  reservation_id?: string
  actor_id: string
}

export type GetThreadRequest = { thread_id: string; user_id: string }
export type ThreadsByUserRequest = { user_id: string } // a guest_id or a host_id

// Oldest first. Calling this as the receiver marks their incoming messages "read" (C3a).
export type ListMessagesRequest = { thread_id: string; user_id: string }

export type SendMessageRequest = {
  thread_id: string
  sender_id: string
  message_text: string // 1-2000 characters after trimming
  idempotency_key: string // resending the same key returns the first message
}
