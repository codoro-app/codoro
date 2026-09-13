/**
 * T8b (v5 Phase 5.2): the app-level wiring T8a deliberately left out (see
 * that task's own amendment, "Not built this session"). Renders nothing --
 * a pure side-effect host, mounted once from `App.tsx` for the app's whole
 * lifetime, entirely inside `<AuthProvider>` (only ever reachable when
 * `hasClerkKey` is true -- see `App.tsx`'s own comment on why this must stay
 * gated exactly like `AccountSection.tsx` already is).
 *
 * One `SyncEngine` instance is constructed once, via `useState`'s lazy
 * initializer (never a ref -- this codebase's lint config flags any
 * read/write of a ref's `.current` during render, including the classic
 * "lazy-init a ref" idiom), and lives for as long as this component is
 * mounted, i.e. the whole app session. The `getToken` closure captured at
 * that first render is held onto for the engine's whole lifetime, same
 * convention `AccountSection.tsx` already uses when it hands `getToken`
 * straight to `DeleteAccountDialog` with no refresh mechanism -- Clerk's
 * own `getToken` always resolves the live session at call time regardless
 * of which render's closure invokes it, so there is nothing to go stale.
 *
 * Lifecycle wiring, each its own effect so one listener's failure/cleanup
 * can't tangle with another's:
 * - `onProfileSaved` (src/storage/profile.ts) -> `engine.notifyMutation()`.
 * - `isLoaded && isSignedIn && userId` -> `engine.handleSignedIn(userId)`,
 *   covering both a real sign-in event and "already signed in at boot"
 *   (Clerk resolves `isSignedIn` the same way in both cases -- no separate
 *   boot-specific branch needed).
 * - `isLoaded && !isSignedIn` -> `engine.handleSignedOut()`.
 * - `window`'s `online` event -> `engine.handleOnline()`.
 * - `document`'s `visibilitychange` -> hidden -> `engine.flush()`.
 *
 * Guest-first (I2): none of this ever blocks rendering (this component
 * itself renders `null`, and every engine call it makes is fire-and-forget,
 * `void`d) and every engine failure path already degrades silently by
 * construction (`engine.ts`'s own I2 discipline) -- there is nothing here
 * for a signed-in-but-offline player to notice.
 */
import { useEffect, useState } from 'react'
import { useAuthToken } from '../auth/useAuthToken'
import { onProfileSaved } from '../storage'
import { createSyncEngine } from './engine'
import type { SyncEngine } from './engine'

export function SyncEngineHost(): null {
  const { isLoaded, isSignedIn, userId, getToken } = useAuthToken()

  const [engine] = useState<SyncEngine>(() => createSyncEngine({ getToken }))

  useEffect(
    () =>
      onProfileSaved(() => {
        engine.notifyMutation()
      }),
    [engine],
  )

  useEffect(() => {
    if (!isLoaded) return
    if (isSignedIn && userId) {
      void engine.handleSignedIn(userId)
    } else {
      engine.handleSignedOut()
    }
  }, [engine, isLoaded, isSignedIn, userId])

  useEffect(() => {
    function handleOnline(): void {
      void engine.handleOnline()
    }
    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('online', handleOnline)
    }
  }, [engine])

  useEffect(() => {
    function handleVisibilityChange(): void {
      if (document.visibilityState === 'hidden') void engine.flush()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [engine])

  return null
}
