// The ids pages use to call the API, taken from the logged-in account (see src/auth/).
// Kept as its own hook (team decision A13a) so pages keep writing
// `const { guestId } = useCurrentUser()`. Pages are guarded by role (RequireRole), so a
// guest page always gets a real guestId. On public pages it is '' when not a guest.
import { useAuth } from '../auth/useAuth'

export function useCurrentUser() {
  const { user } = useAuth()
  return {
    guestId: user?.role === 'guest' ? user.id : '',
    hostId: user?.role === 'host' ? user.id : '',
  }
}
