/**
 * Native-share-first, clipboard-fallback logic (challenge redesign
 * extraction) — this used to live inline inside `ShareMenu.tsx`'s own
 * `activate` (fired per sheet-row click); pulled out to a bare
 * `text: string -> ActivateResult` util so `ChallengeButton.tsx` — which has
 * no `ShareAction`/sheet row to build (it's a single always-visible button,
 * not a list behind a "Share" trigger) — can drive the exact same
 * native-share/clipboard-fallback behavior without forking it.
 * `ShareMenu.tsx`'s own `activate` is now a thin wrapper: fire the row's
 * `onShared` telemetry hook, then hand off to this.
 *
 * Its own file, not exported alongside `ShareMenu`/`SheetRow` (both real
 * components): a plain function export living in the same module as a
 * component trips `react-refresh/only-export-components` (fast refresh only
 * works when a file exports components only) — this repo's existing
 * component files keep that boundary clean already (type-only exports like
 * `ShareAction`/`ShareMenuProps` don't count, since types erase at build
 * time; a real runtime function does).
 */

// 2b.15 (ShareMenu.tsx): 'cancelled' is its own outcome, not folded into
// 'shared' — the native OS share sheet (navigator.share) is layered ON TOP
// of whatever UI called this, not a replacement for it, so a caller that
// shows its own UI while sharing (ShareMenu's bottom sheet) needs to know
// "the user backed out of the OS sheet" apart from "a real share completed"
// to decide whether to stay open. See ShareMenu.tsx's own `SheetRow`
// handling for the caller-side half of this.
export type ActivateResult = 'shared' | 'copied' | 'cancelled'

export async function shareOrCopy(text: string): Promise<ActivateResult> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ text })
      return 'shared'
    } catch (err) {
      // User-cancelled sheets are a normal outcome, not a failure to
      // recover from — only a real error falls through to clipboard.
      if (err instanceof Error && err.name === 'AbortError') return 'cancelled'
    }
  }
  await navigator.clipboard.writeText(text)
  return 'copied'
}
