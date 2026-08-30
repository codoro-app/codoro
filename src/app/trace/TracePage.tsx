/**
 * Trace mode's page-level component — mounted at `/trace`.
 *
 * Unlike RushPage (which owns `useRushSession` itself and branches on
 * `status`/`phase` directly), this page does NOT call `useTraceSession`
 * again here: `TraceRunner` (Task 3) already owns a single
 * `useTraceSession` instance and fully branches on every state the hook
 * exposes — loading (`trace-runner__status` "Loading your trace
 * session…"), error with a "Try again" retry button wired to
 * `session.retryLoad`, empty (`status === 'empty'` — reachable in
 * production once the pool is genuinely exhausted, and also the state
 * dev-stub puzzle mode degrades to today per Task 1's report, since
 * `DEV_STUB_PUZZLES` has no scrubber-interaction entries), and the
 * playing/complete UI (`TraceRunnerPuzzle`, including the in-place
 * solve/explanation panel — Trace has no separate "ended" phase the way
 * Rush does, since a Trace attempt is exactly one puzzle's checkpoints).
 * Instantiating `useTraceSession` a second time here would start a second,
 * independent session (its own profile load + puzzle serve) racing the one
 * inside `TraceRunner` — so this page is intentionally a thin shell around
 * it rather than a duplicate of RushPage's own status-branching.
 *
 * `timed` (Phase 7, made a preference in v4 Phase 4.1): `/trace` was
 * untimed by direct user preference (reversing 5b's decision that real
 * Trace mode runs the per-checkpoint clock) and is now the "Timer on
 * Trace" toggle in Settings — off (`false`) is still the default for every
 * existing and new profile (DEFAULT_PREFERENCES.timerOnTrace), so nothing
 * changes for a player who never opens Settings. Read once on mount
 * (async, from the same IndexedDB profile Settings itself writes to) —
 * `false` while it's loading matches that shipped default, so there's no
 * visible flash to a timed state on a slow load.
 * `TRACE_CHECKPOINT_TIME_LIMIT_MS` and the timed path stay in
 * `TraceRunner.tsx`, live and tested, for future timed consumers (6b's
 * boss run, 6c's speed round) — see docs/v2-build-plan.md's Phase 7
 * amendment for the full decision record.
 */
import { useEffect, useState } from 'react'
import { DEFAULT_PREFERENCES, loadProfile } from '../../storage'
import { TraceRunner } from './TraceRunner'
import { useMediaQuery } from '../useMediaQuery'

// 2b.0: was `.trace-page` (tracePage.css, max-width breakpoint matches
// Tailwind's `lg` exactly). Not test-asserted (grep-verified).
const PAGE_SHELL_CLASS =
  'app-shell__main flex flex-col gap-4 w-full max-w-[var(--content-width-mobile)] lg:max-w-[var(--content-width-desktop)] mx-auto pt-[var(--space-4)] px-4 pb-4'

export function TracePage() {
  const [timerOnTrace, setTimerOnTrace] = useState(DEFAULT_PREFERENCES.timerOnTrace)
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  // v4 Phase 4.5 ("the right rail") — same ref-callback-in-state portal
  // target as PracticePage.tsx's identical `sidebarSlotEl`.
  const [sidebarSlotEl, setSidebarSlotEl] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    let cancelled = false
    loadProfile()
      .then((profile) => {
        if (!cancelled) setTimerOnTrace(profile.preferences.timerOnTrace)
      })
      .catch(() => {
        // Stays at DEFAULT_PREFERENCES.timerOnTrace (false) — same
        // cosmetic-no-op reasoning as AppShell's own preferences load.
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <>
      <div className={PAGE_SHELL_CLASS}>
        <TraceRunner timed={timerOnTrace} sidebarSlot={sidebarSlotEl} />
      </div>

      {isDesktop && (
        // New sidebar (v4 Phase 4.5) — Trace had none before. Checkpoint
        // progress + the solve/explanation block portal in here from
        // TraceRunnerPuzzle (see its `sidebarSlot` doc comment); `empty:hidden`
        // matches PracticePage.tsx's identical slot so it claims no space
        // (and no stray `gap-4` slot) before anything has portaled in.
        <aside className="app-shell__sidebar flex flex-col gap-4 py-6 px-4 border-l border-border self-start">
          <div ref={setSidebarSlotEl} className="empty:hidden flex flex-col gap-4" />
        </aside>
      )}
    </>
  )
}
