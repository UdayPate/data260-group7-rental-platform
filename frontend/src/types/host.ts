export type HostVerificationStatus = 'verified' | 'pending' | 'unverified'
export type HostAccessLevel = 'standard' | 'superhost'

// Spec section 4: Host.
export type Host = {
  host_id: string
  name: string
  email: string
  phone: string
  profile_photo_url: string
  verification_status: HostVerificationStatus
  response_rate: number // percent, 0-100
  response_time: number // average minutes to reply
  host_since: string // date
  access_level: HostAccessLevel
}

// --- Request bodies (User Service, /hosts/*) ---

// Server fills host_id, host_since, the response stats and verification_status.
export type CreateHostRequest = Pick<Host, 'name' | 'email' | 'phone' | 'profile_photo_url'>

export type GetHostRequest = { host_id: string }

export type UpdateHostRequest = { host_id: string } & Partial<CreateHostRequest>
