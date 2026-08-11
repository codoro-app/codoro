/**
 * Elo-style rating math for Codoro. Pure functions, no I/O.
 * Floats are the source of truth; rounding is display-only.
 */

export const INITIAL_RATING = 1200
export const RATING_FLOOR = 400

export type AttemptMode = 'practice' | 'daily' | 'rush' | 'boss'

export function expectedScore(userRating: number, puzzleRating: number): number {
  return 1 / (1 + 10 ** ((puzzleRating - userRating) / 400))
}

// priorRatedAttemptCount is 0-indexed: attempts 1-20 (counts 0-19) use K=32,
// attempt 21+ (count >= 20) uses K=24.
export function getK(priorRatedAttemptCount: number): number {
  return priorRatedAttemptCount < 20 ? 32 : 24
}

/**
 * `correct` accepts a plain boolean (every non-trace caller: Practice,
 * Daily, Rush's own convergence sim) or a fractional actual-score in [0, 1]
 * (Trace — see scrubber.ts's `scrubberActualScore`, used so a 3-of-4-
 * checkpoints attempt earns partial rating credit instead of being scored
 * identically to a full miss). Elo's own formula never required an integer
 * outcome — `actual` is just the observed score — so this is the standard
 * fractional-score variant, not a new mechanic bolted on top.
 *
 * `kMultiplier` (default 1, every existing caller omits it and is
 * unaffected) scales the rating swing per attempt independent of the
 * standard attempt-count K tiers — Trace passes `TRACE_K_MULTIPLIER` since
 * a multi-checkpoint trace attempt carries more signal than one single-
 * commit quiz answer.
 */
export function updateRating(
  userRating: number,
  puzzleRating: number,
  correct: boolean | number,
  priorRatedAttemptCount: number,
  kMultiplier = 1,
): number {
  // Fail loud, not silent: a NaN/Infinity slipping through here would
  // persist into the player's profile via saveProfile and permanently
  // corrupt every rating computation downstream (expectedScore, every
  // future updateRating call) — there's no recovery once that's written.
  // Nothing in the codebase currently produces one of these, but nothing
  // guarded against it either; this is the same "invariant violation
  // throws" convention schema.ts's requireStep uses.
  if (!Number.isFinite(userRating) || !Number.isFinite(puzzleRating)) {
    throw new Error(
      `updateRating: userRating (${String(userRating)}) and puzzleRating (${String(puzzleRating)}) must be finite numbers`,
    )
  }
  if (typeof correct === 'number' && (!Number.isFinite(correct) || correct < 0 || correct > 1)) {
    throw new Error(
      `updateRating: fractional correct must be a finite number in [0, 1], got ${String(correct)}`,
    )
  }
  const expected = expectedScore(userRating, puzzleRating)
  const actual = typeof correct === 'number' ? correct : correct ? 1 : 0
  const k = getK(priorRatedAttemptCount) * kMultiplier
  const next = userRating + k * (actual - expected)
  return Math.max(next, RATING_FLOOR)
}

export function roundForDisplay(rating: number): number {
  return Math.round(rating)
}

export function shouldRateAttempt(mode: AttemptMode, isFirstAttemptOfDay: boolean): boolean {
  switch (mode) {
    case 'practice':
      return true
    case 'daily':
      return isFirstAttemptOfDay
    case 'rush':
      return false
    case 'boss':
      return false
  }
}
