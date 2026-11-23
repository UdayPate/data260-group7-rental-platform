// Tells TypeScript which VITE_ environment variables exist (all optional strings).
interface ImportMetaEnv {
  readonly VITE_USE_MOCKS?: string
  readonly VITE_USER_API_BASE_URL?: string
  readonly VITE_PROPERTY_API_BASE_URL?: string
  readonly VITE_BOOKING_API_BASE_URL?: string
  readonly VITE_MESSAGING_API_BASE_URL?: string
  readonly VITE_REVIEW_API_BASE_URL?: string
  readonly VITE_ANALYTICS_API_BASE_URL?: string
  readonly VITE_AI_API_BASE_URL?: string
}
