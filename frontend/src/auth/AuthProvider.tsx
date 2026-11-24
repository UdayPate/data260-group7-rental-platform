// Keeps "who is logged in" for the whole app, and handles a session that ends (a 401 from
// any service, or a WebSocket closed with 4401): back to the login page, then back here.
import { startTransition, useEffect, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import { login, signup } from '../api/auth'
import type { AuthUser, LoginRequest, SignupRequest } from '../types/auth'
import { clearToken, currentUser, saveToken, SESSION_ENDED_EVENT } from './session'
import { AuthContext } from './useAuth'

export function AuthProvider({ children }: { children: ReactNode }) {
  // Read once from this tab's sessionStorage, so a reload keeps you logged in.
  const [user, setUser] = useState<AuthUser | null>(() => currentUser())
  const navigate = useNavigate()

  useEffect(() => {
    function sessionEnded() {
      if (window.location.pathname === '/login') {
        // Already going to the login page (several 401s at once). Also inside a transition:
        // an urgent update here would let the old page's route guard redirect first, without the note.
        startTransition(() => setUser(null))
        return
      }
      const here = window.location.pathname + window.location.search
      // One transition, as in logOut below, so the login page keeps its note.
      startTransition(() => {
        setUser(null)
        navigate(`/login?next=${encodeURIComponent(here)}`, {
          state: { note: 'Your session has ended. Please log in again to continue.' },
        })
      })
    }
    window.addEventListener(SESSION_ENDED_EVENT, sessionEnded)
    return () => window.removeEventListener(SESSION_ENDED_EVENT, sessionEnded)
  }, [navigate])

  async function logIn(body: LoginRequest) {
    const response = await login(body)
    saveToken(response.token)
    setUser(response.user)
    return response.user
  }

  async function signUp(body: SignupRequest) {
    const response = await signup(body)
    saveToken(response.token)
    setUser(response.user)
    return response.user
  }

  function logOut(notice?: string) {
    clearToken()
    // Both in one transition, so React shows "logged out" and the search page together.
    // Otherwise the route guard of the page we're leaving sees "logged out" first and
    // redirects to the login page.
    startTransition(() => {
      setUser(null)
      navigate('/', { state: notice ? { notice } : null })
    })
  }

  return <AuthContext.Provider value={{ user, logIn, signUp, logOut }}>{children}</AuthContext.Provider>
}
