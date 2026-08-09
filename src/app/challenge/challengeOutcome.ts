/**
 * Pure win/lose/tie resolution for a challenge run (v2 Phase 5c) — pulled
 * into its own module rather than inlined in useChallengeSession.ts and
 * ChallengeComparison.tsx since both need the identical rule: the hook to
 * fire `challenge_link_complete` the moment a run ends, and the comparison
 * screen to render the verdict. Same "shared session-hook logic gets its own
 * pure module" convention as streakPauseLogic.ts.
 *
 * The duel is decided the same way the codec documents the payload: correct
 * count first, then total time as the tiebreaker — both sides solved the
 * same puzzles, so a comparison of the two runs is well-defined. A tie in
 * both correct count and time is a tie (and counts as *not* beating the
 * challenger for telemetry purposes — the plan's `beat_challenger` semantics).
 */

export type ChallengeOutcome = 'won' | 'lost' | 'tied'

export interface ChallengeSide {
  correct: number
  totalMs: number
}

export function resolveChallengeOutcome(
  yours: ChallengeSide,
  theirs: ChallengeSide,
): ChallengeOutcome {
  if (yours.correct !== theirs.correct) {
    return yours.correct > theirs.correct ? 'won' : 'lost'
  }
  if (yours.totalMs !== theirs.totalMs) {
    return yours.totalMs < theirs.totalMs ? 'won' : 'lost'
  }
  return 'tied'
}
