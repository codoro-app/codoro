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
 * `timed={false}` (Phase 7): `/trace` is untimed by direct user preference,
 * reversing 5b's decision that real Trace mode runs the per-checkpoint
 * clock. `TRACE_CHECKPOINT_TIME_LIMIT_MS` and the timed path stay in
 * `TraceRunner.tsx`, live and tested, for future timed consumers (6b's
 * boss run, 6c's speed round) — see docs/v2-build-plan.md's Phase 7
 * amendment for the full decision record.
 */
import { TraceRunner } from './TraceRunner'
import './tracePage.css'

export function TracePage() {
  return (
    <div className="trace-page app-shell__main">
      <TraceRunner timed={false} />
    </div>
  )
}
