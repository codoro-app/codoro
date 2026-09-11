/**
 * T5: the one place components read Clerk's session state from. Only ever
 * mounted from inside `<AuthProvider>` (src/auth/AuthProvider.tsx) — every
 * caller is therefore one of the account-touching surfaces (Settings'
 * account section, the sign-in sheet, a signup-prompt host), never a play
 * route, so importing `@clerk/react` here costs nothing on `/practice`
 * signed out (I3/F8: this file's own chunk is only ever requested by a
 * chunk that's already conditional on a Clerk key existing).
 *
 * I10: `getToken()`'s return value is handed to the caller and nowhere
 * else — this hook does not cache it in any React state, let alone
 * `localStorage`/`sessionStorage`/IndexedDB. Every `/api/*` call
 * (src/auth/api.ts) fetches a fresh token immediately before the request
 * that needs it (F4's discipline).
 */
import { useAuth, useUser } from '@clerk/react'

export interface AuthState {
  isLoaded: boolean
  isSignedIn: boolean
  /** Primary email, or null while loading / signed out. Display only. */
  email: string | null
  getToken: () => Promise<string | null>
}

export function useAuthToken(): AuthState {
  const { isLoaded, isSignedIn, getToken } = useAuth()
  const { user } = useUser()

  return {
    isLoaded,
    isSignedIn: isLoaded ? isSignedIn : false,
    email: user?.primaryEmailAddress?.emailAddress ?? null,
    getToken: () => getToken(),
  }
}
