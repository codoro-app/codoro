/**
 * Shared streak-pause trigger logic for Practice and Trace (Phase 5b Item 7,
 * decision 8) — the only two modes it applies to; Rush is timed and
 * interrupting a run is self-defeating, and Daily is a single puzzle so an
 * in-session streak is undefined there. Pulled into its own pure module
 * rather than duplicated in usePracticeSession.ts/useTraceSession.ts since
 * both hooks need the identical rule and there's no other shared home for
 * session-hook logic in this codebase (src/engine/, src/storage/,
 * src/content/ are all domain-specific barrels, not general utility
 * modules — see PuzzleCardShell.tsx's assertNever doc comment on the same
 * point).
 */

/** Trigger every 5th correct answer in a row (5, 10, 15, ...), not just once at exactly 5 — a player who keeps choosing "keep going" keeps earning the moment. */
export const STREAK_PAUSE_INTERVAL = 5

export interface StreakPauseState {
  readonly streak: number
  readonly isNewBest: boolean
}

/**
 * Whether `streak` (the just-updated in-session correct-answer streak)
 * should trigger the pause, and whether it's a new all-time best against
 * `bestRunStreak` (Phase 5b Item 8's payoff framing). Returns `null` when
 * the pause shouldn't fire this answer.
 */
export function resolveStreakPause(streak: number, bestRunStreak: number): StreakPauseState | null {
  if (streak <= 0 || streak % STREAK_PAUSE_INTERVAL !== 0) return null
  return { streak, isNewBest: streak > bestRunStreak }
}
