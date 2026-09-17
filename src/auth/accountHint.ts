/**
 * T8b review fix (I3/F8): the root-level hint that decides whether the app
 * pays Clerk's boot cost eagerly, on every cold start, for every visitor.
 *
 * Background: `App.tsx` mounts `<SyncEngineHost>` (via `<AuthProvider>`) at
 * the app root so background sync keeps running while a signed-in player
 * navigates between play routes, not just while Settings happens to be
 * open. Gating that mount on `hasClerkKey` alone regresses F8/I3
 * ("no v5 dependency lands on the play path's critical chunks... clerk-js
 * loads on every cold start for every guest") — `hasClerkKey` is a build
 * config, true for every visitor once Clerk is configured in production,
 * signed in or not. `docs/superpowers/plans/2026-08-27-v5-accounts-
 * implementation-plan.md`'s own F8 footgun row already names the fix: "a
 * root-level *dynamic* import gated on a `codoro:has-account` localStorage
 * hint, so only known-account devices pay the boot cost." This module is
 * that hint.
 *
 * Written the moment `SyncEngineHost` observes a real signed-in session
 * (from wherever it's mounted -- the root host, or a Settings/signup-prompt
 * surface's own local host for a device's very first sign-in, before the
 * hint exists to gate the root mount at all). Cleared on an ordinary
 * sign-out, once `SyncEngineHost`'s effect observes `isLoaded &&
 * !isSignedIn` -- once truly signed out, a device goes back to paying zero
 * Clerk cost on its next boot, matching guest-first's "signed-out behavior
 * unchanged" (I1/I2) rather than assuming "ever had an account" should cost
 * forever.
 *
 * 2026-09 QA #3 amendment: account deletion no longer relies solely on that
 * isLoaded-gated path. `DeleteAccountDialog` calls this directly right after
 * `signOut()` succeeds -- a `<ClerkProvider>` remount's `isLoaded` resolving
 * post-delete in the SAME tab that just hard-deleted its own Clerk user
 * turned out not to be guaranteed (a live QA report found Settings'
 * Account card stuck on its loading placeholder indefinitely after exactly
 * this sequence), so this device's own "no known account" bookkeeping is
 * now settled deterministically at the moment the delete itself succeeds,
 * not dependent on Clerk's state resolving afterward.
 *
 * Named limitation: this hint is read once per app boot (`App.tsx`'s own
 * `useState` initializer), not reactively. A device's very first sign-in
 * session (hint false at boot) does not retroactively mount the root host
 * mid-session -- background sync for that one session runs only while a
 * Settings/signup-prompt surface's own local host stays mounted, and stops
 * the moment the player navigates away, resuming on the next full boot
 * (hint now true). Not silently assumed away: recorded in the T8b amendment.
 */

const HAS_ACCOUNT_HINT_STORAGE_KEY = 'codoro:has-account'

/** Never throws: any storage failure reads as "no known account," the safer (zero-Clerk-cost) default. */
export function readHasAccountHint(): boolean {
  try {
    return localStorage.getItem(HAS_ACCOUNT_HINT_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function writeHasAccountHint(): void {
  try {
    localStorage.setItem(HAS_ACCOUNT_HINT_STORAGE_KEY, '1')
  } catch {
    // Degrade silently, same posture as every other localStorage write in
    // this app's sync-adjacent modules -- worst case this device keeps
    // paying (or keeps skipping) the boot cost it already was.
  }
}

export function clearHasAccountHint(): void {
  try {
    localStorage.removeItem(HAS_ACCOUNT_HINT_STORAGE_KEY)
  } catch {
    // Same degrade-silently posture as writeHasAccountHint above.
  }
}
