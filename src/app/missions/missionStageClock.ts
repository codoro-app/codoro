/**
 * Pure stage-clock-expiry check for Missions' uniform 60-second stage timer
 * — see docs/design/click-meaningfulness.md §3 for the design decision.
 * Deliberately a plain function, not a React hook or class: a single
 * comparison, unit-testable with no fake timers.
 *
 * Two callers, both reading the same deadline:
 * - useMissionSession's own ticking display clock (feeds `remainingMs`,
 *   mirroring useRushSession's visibilitychange-safe deadline-math pattern).
 * - Each stage component's (Task 4) own `onContinue` interception — the
 *   authoritative, PULL-based check the soft-cutoff rule requires: the
 *   clock is checked BETWEEN puzzles, at the moment a stage's own Continue
 *   tap fires, never mid-puzzle. This function never itself ends a stage —
 *   it only answers "has the deadline passed", the same question from
 *   either caller.
 */
export const MISSION_STAGE_DURATION_MS = 60_000

export function hasStageClockExpired(deadlineMs: number, now: number): boolean {
  return now >= deadlineMs
}
