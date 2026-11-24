// Holds the demo guest and demo host we're acting as (there's no real login).
// Both are kept per browser tab (see tabStorage.ts), so two tabs can act as two different
// guests and a reload keeps each tab's choice.
import { useState, type ReactNode } from 'react'
import { readTabValue, writeTabValue } from '../tabStorage'
import { CurrentUserContext } from './useCurrentUser'

const GUEST_KEY = 'cedar-rye.guestId'
const HOST_KEY = 'cedar-rye.hostId'

// Used the first time, before anything is saved: Alex Chen and Maya Ortiz from the seed data.
const DEFAULT_GUEST_ID = 'g_001'
const DEFAULT_HOST_ID = 'h_001'

export function CurrentUserProvider({ children }: { children: ReactNode }) {
  // The function form of useState runs once, on the first render only.
  const [guestId, setGuestIdState] = useState(() => readTabValue(GUEST_KEY) ?? DEFAULT_GUEST_ID)
  const [hostId, setHostIdState] = useState(() => readTabValue(HOST_KEY) ?? DEFAULT_HOST_ID)

  function setGuestId(id: string) {
    writeTabValue(GUEST_KEY, id)
    setGuestIdState(id)
  }

  function setHostId(id: string) {
    writeTabValue(HOST_KEY, id)
    setHostIdState(id)
  }

  // Bumped after a guest is created or deleted; the header picker reloads its list when it changes.
  const [usersVersion, setUsersVersion] = useState(0)
  const refreshUsers = () => setUsersVersion((n) => n + 1)

  return (
    <CurrentUserContext.Provider value={{ guestId, hostId, setGuestId, setHostId, usersVersion, refreshUsers }}>
      {children}
    </CurrentUserContext.Provider>
  )
}
