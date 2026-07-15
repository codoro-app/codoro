/**
 * Elo-style rating math for Codoro. Pure functions, no I/O.
 * Floats are the source of truth; rounding is display-only.
 */

export const INITIAL_RATING = 1200
export const RATING_FLOOR = 400

export type AttemptMode = 'practice' | 'daily' | 'rush'

export function expectedScore(userRating: number, puzzleRating: number): number {
  return 1 / (1 + 10 ** ((puzzleRating - userRating) / 400))
}

// priorRatedAttemptCount is 0-indexed: attempts 1-20 (counts 0-19) use K=32,
// attempt 21+ (count >= 20) uses K=24.
export function getK(priorRatedAttemptCount: number): number {
  return priorRatedAttemptCount < 20 ? 32 : 24
}

export function updateRating(
  userRating: number,
  puzzleRating: number,
  correct: boolean,
  priorRatedAttemptCount: number,
): number {
  const expected = expectedScore(userRating, puzzleRating)
  const actual = correct ? 1 : 0
  const k = getK(priorRatedAttemptCount)
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
  }
}
