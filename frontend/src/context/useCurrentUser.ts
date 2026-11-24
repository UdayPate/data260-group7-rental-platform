// The "who am I" shared state (React context) and the hook pages use to read it.
// Kept apart from the provider component because the React fast-refresh lint rule
// wants component files to export only components.
import { createContext, useContext } from 'react'

export type CurrentUser = {
  guestId: string // the guest we're acting as in guest mode
  hostId: string // the host we're acting as in host mode
  setGuestId: (id: string) => void
  setHostId: (id: string) => void
  usersVersion: number // goes up whenever a guest is created or deleted
  refreshUsers: () => void // call after creating/deleting a guest so the "Viewing as" list reloads
}

export const CurrentUserContext = createContext<CurrentUser | null>(null)

// Usage in any page or component: const { guestId } = useCurrentUser()
export function useCurrentUser(): CurrentUser {
  const value = useContext(CurrentUserContext)
  if (!value) throw new Error('useCurrentUser must be used inside <CurrentUserProvider>.')
  return value
}
