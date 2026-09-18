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
 *   boot-specific branch needed). Also stamps `codoro:has-account`
 *   (accountHint.ts) -- see App.tsx's own comment for what that gates --
 *   and calls `identifyUser(userId)` (`src/telemetry`), identifying this
 *   session to PostHog by Clerk's userId only (never email -- I4). See
 *   `client.ts`'s doc comment for why identifying signed-in accounts is
 *   safe when identifying by `anonId` never was.
 * - `isLoaded && !isSignedIn` -> `engine.handleSignedOut()` and clears the
 *   has-account hint -- an ordinary sign-out returns this device to
 *   zero-Clerk-cost boots, matching guest-first (I1/I2) -- and calls
 *   `resetIdentity()` (`src/telemetry`), dropping back to a fresh anonymous
 *   PostHog `distinct_id`. Account deletion (`DeleteAccountDialog`) calls
 *   `signOut()` on success, so it clears the hint and resets identity via
 *   this same path -- no separate call needed.
 * - `window`'s `online` event -> `engine.handleOnline()`.
 * - `document`'s `visibilitychange` -> hidden -> `engine.flush()`.
 *
 * Review finding (blocker): `handleSignedIn` resolving
 * `{ accountSwitchDetected: true }` means this device's local IndexedDB
 * belonged to a different account a moment ago -- correct now, but every
 * already-mounted session hook (usePracticeSession and its siblings) still
 * holds the PRIOR account's `UserProfile` object in its own React state,
 * and the next ordinary `saveProfile()` call from any of them would
 * silently overwrite the just-adopted account with stale data. A full
 * reload is the one thing guaranteed to drop every such stale in-memory
 * reference at once, rather than this component trying to reach into every
 * current and future session hook's state to invalidate it individually.
 * `engine.ts`'s own two-boot design (see `handleSignedIn`'s doc comment)
 * makes this reload fire *before* any network round-trip, closing the
 * window where a stale save could land during the switch itself.
 *
 * Review finding (blocker, round 2) -- singleton guard: this component is
 * mounted from up to three places at once in the real app (`App.tsx`'s
 * root host, gated on the has-account hint; `AccountSection.tsx` and
 * `SignupPromptSheet.tsx`'s own local hosts, gated on `!hasAccountHint` at
 * their own mount time so a device's very first sign-in still gets live
 * wiring). Both gates are computed from the *same* mutable localStorage
 * flag at *different* times, so there is a real, production-reachable
 * sequence (sign out from Settings -- the root host's own effect clears
 * the hint but the root host itself, already mounted, never unmounts --
 * then a signup-prompt trigger fires elsewhere on the page) where a local
 * host mounts *alongside* the still-mounted root host: two independent
 * `SyncEngine` instances, each with its own mutex, each subscribed to
 * `onProfileSaved`, racing pushes and — worse — both potentially running
 * `handleSignedIn`'s own account-switch reset concurrently, the exact
 * cross-instance version of the single-instance StrictMode race that
 * function's lock was built to close. Mutable-flag gates alone cannot
 * guarantee exclusivity no matter how carefully each is computed, so
 * exclusivity is enforced structurally instead: a module-level singleton
 * slot (`activeInstanceClaimed` below), claimed by whichever instance's
 * mount effect runs first and released on unmount. Every instance
 * still renders (calls `useAuthToken()`, constructs an engine object --
 * both side-effect-free), but only the one holding the slot ever wires up
 * a listener, calls a lifecycle hook, or touches the network.
 *
 * Guest-first (I2): none of this ever blocks rendering (this component
 * itself renders `null`, and every engine call it makes is fire-and-forget,
 * `void`d) and every engine failure path already degrades silently by
 * construction (`engine.ts`'s own I2 discipline) -- there is nothing here
 * for a signed-in-but-offline player to notice.
 */
import { useEffect, useRef, useState } from 'react'
import { clearHasAccountHint, writeHasAccountHint } from '../auth/accountHint'
import { useAuthToken } from '../auth/useAuthToken'
import { onProfileSaved } from '../storage'
import { identifyUser, resetIdentity } from '../telemetry'
import { createSyncEngine } from './engine'
import type { SyncEngine } from './engine'

/**
 * Module-level, not component state: this is what makes the singleton
 * guarantee hold *across* the up-to-three separate mount sites (root,
 * Settings, signup-prompt), which share nothing else -- see this file's
 * own top comment. `true` while some instance holds the slot.
 */
let activeInstanceClaimed = false

export function SyncEngineHost(): null {
  const { isLoaded, isSignedIn, userId, getToken } = useAuthToken()

  const [engine] = useState<SyncEngine>(() => createSyncEngine({ getToken }))
  // A ref, not state: no re-render is needed to propagate the claim to the
  // effects below. React runs one component's own effects in declaration
  // order, all within the same post-commit pass -- by the time effect #2
  // (and every one after it) reads this ref, the claiming effect (#1,
  // declared first) has already run and set it, even on the very first
  // commit. Using state here (and setting it inside the claiming effect)
  // would work too, but trips this codebase's lint rule against calling
  // setState synchronously inside an effect body (cascading-render risk) --
  // a ref sidesteps that without needing an extra render at all.
  const isActiveInstanceRef = useRef(false)

  // Claims the singleton slot on mount if free, releases it on unmount. A
  // losing instance's ref stays `false` for its whole lifetime, so none of
  // its other effects below ever run their real body -- it stays a fully
  // inert `null`-renderer.
  useEffect(() => {
    if (activeInstanceClaimed) {
      isActiveInstanceRef.current = false
      return undefined
    }
    activeInstanceClaimed = true
    isActiveInstanceRef.current = true
    return () => {
      activeInstanceClaimed = false
      isActiveInstanceRef.current = false
    }
  }, [])

  useEffect(() => {
    if (!isActiveInstanceRef.current) return undefined
    return onProfileSaved(() => {
      engine.notifyMutation()
    })
  }, [engine])

  useEffect(() => {
    if (!isActiveInstanceRef.current) return
    if (!isLoaded) return
    if (isSignedIn && userId) {
      writeHasAccountHint()
      identifyUser(userId)
      void engine
        .handleSignedIn(userId)
        .then(({ accountSwitchDetected }) => {
          if (accountSwitchDetected) window.location.reload()
        })
        .catch(() => {
          // Review finding (round 2): handleSignedIn can reject (e.g.
          // loadProfile() failing on a blocked/unavailable IndexedDB) --
          // never let that surface as an unhandled rejection. Same I2
          // degrade-silently posture as every other engine failure path;
          // worst case this sign-in's sync simply doesn't happen until the
          // next natural trigger.
        })
    } else {
      clearHasAccountHint()
      resetIdentity()
      engine.handleSignedOut()
    }
  }, [engine, isLoaded, isSignedIn, userId])

  useEffect(() => {
    if (!isActiveInstanceRef.current) return undefined
    function handleOnline(): void {
      void engine.handleOnline()
    }
    window.addEventListener('online', handleOnline)
    return () => {
      window.removeEventListener('online', handleOnline)
    }
  }, [engine])

  useEffect(() => {
    if (!isActiveInstanceRef.current) return undefined
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
