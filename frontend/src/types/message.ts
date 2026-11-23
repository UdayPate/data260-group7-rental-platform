export type DeliveryStatus = 'sent' | 'delivered' | 'read'

// Spec section 4 "conversation": one thread between a guest and a host about a property.
export type Thread = {
  thread_id: string
  guest_id: string
  host_id: string
  property_id: string
  reservation_id: string | null
  created_datetime: string
}

// Spec section 4: Message.
export type Message = {
  message_id: string
  thread_id: string
  sender_id: string
  receiver_id: string
  timestamp: string
  message_text: string
  delivery_status: DeliveryStatus
}
