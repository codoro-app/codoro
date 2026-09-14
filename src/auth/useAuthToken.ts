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
  /**
   * Clerk's own user id, or null while loading / signed out. T8b: the sync
   * engine's `handleSignedIn(userId)` lifecycle hook needs this -- nothing
   * before T8b did, so this field didn't exist until now.
   */
  userId: string | null
  getToken: () => Promise<string | null>
}

export function useAuthToken(): AuthState {
  // T8b review fix: userId comes from useAuth() itself, not useUser() --
  // both hooks resolve from the same underlying Clerk state, but reading
  // isSignedIn from one hook and userId from another left a narrow window
  // where isSignedIn was already true while `user` (useUser()'s own state)
  // hadn't updated yet, so a consumer keyed on `isSignedIn && userId`
  // (SyncEngineHost) could momentarily read userId as null on an otherwise
  // real, signed-in tick. useAuth()'s own userId is undefined while
  // loading, null while signed out, and a string exactly when isSignedIn
  // is true -- the same discriminant, one hook, no window.
  const { isLoaded, isSignedIn, userId, getToken } = useAuth()
  const { user } = useUser()

  return {
    isLoaded,
    isSignedIn: isLoaded ? isSignedIn : false,
    email: user?.primaryEmailAddress?.emailAddress ?? null,
    userId: userId ?? null,
    getToken: () => getToken(),
  }
}
