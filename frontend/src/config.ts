// The one place that reads environment variables (import.meta.env).
// Vite only exposes variables that start with VITE_. Values come from .env.local
// (copy .env.example) or the shell; anything not set uses the default below.
const env = import.meta.env

// Mocks are ON unless VITE_USE_MOCKS is exactly "false", so a fresh clone works with no .env file.
export const mocksEnabled = env.VITE_USE_MOCKS !== 'false'

// Base URL of each backend service. An empty string means "same server as the
// frontend", which is what MSW (Mock Service Worker) intercepts during development.
export const apiBaseUrls = {
  users: env.VITE_USER_API_BASE_URL ?? '',
  properties: env.VITE_PROPERTY_API_BASE_URL ?? '',
  bookings: env.VITE_BOOKING_API_BASE_URL ?? '',
  messaging: env.VITE_MESSAGING_API_BASE_URL ?? '',
  reviews: env.VITE_REVIEW_API_BASE_URL ?? '',
  analytics: env.VITE_ANALYTICS_API_BASE_URL ?? '',
  ai: env.VITE_AI_API_BASE_URL ?? '',
}
