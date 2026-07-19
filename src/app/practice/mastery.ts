/**
 * Per-pattern mastery calculation.
 *
 * Neither src/engine/ nor src/storage/ define a rolling-accuracy/mastery
 * function today (grep-confirmed) — this is new, not a reuse of existing
 * business logic. It lives in src/app/ rather than src/engine/ because it
 * needs `Attempt` (storage) and pattern info (content), and engine/ must
 * never depend on storage/ (storage already depends on engine one-way; the
 * reverse would be circular, enforced by eslint.config.js's
 * no-restricted-imports rule scoped to src/engine/**).
 *
 * Window size: the "last 20 attempts" per pattern reuses the window size
 * already established by src/engine/selection.ts's no-repeat-within-20
 * convention, for consistency — not a separately-invented number.
 *
 * Minimum-data threshold: a pattern needs at least MIN_ATTEMPTS_FOR_MASTERY
 * (5) attempts in its window before an accuracy percentage is shown at all
 * (`accuracy: null` otherwise, meaning "not enough data" — the caller's
 * concern to render). Below 5 samples a percentage swings by 20+ points per
 * attempt and reads as more precise/meaningful than it is; 5 is a small
 * enough bar to clear within a couple of practice sessions while still
 * damping the earliest noise.
 */
import type { Attempt } from '../../storage'
import type { Puzzle, PatternSlug } from '../../content'
import { PATTERN_SLUGS } from '../../content'

export const MASTERY_WINDOW = 20
export const MIN_ATTEMPTS_FOR_MASTERY = 5

export interface PatternMastery {
  pattern: PatternSlug
  /** Attempts actually considered (min(attempts for this pattern, MASTERY_WINDOW)). */
  attemptCount: number
  /** Fraction correct in [0, 1] over the windowed attempts, or null below MIN_ATTEMPTS_FOR_MASTERY. */
  accuracy: number | null
}

/**
 * Computes accuracy over each pattern's last MASTERY_WINDOW attempts.
 *
 * `attempts` is assumed to already be in chronological (oldest-first) order,
 * matching `listAttempts()`'s own contract — this function does not re-sort,
 * it just takes the last MASTERY_WINDOW entries per pattern as they appear.
 * An attempt whose puzzleId no longer resolves to a pool entry (e.g. content
 * was removed/renamed since the attempt was recorded) is skipped rather than
 * thrown on, since stale history shouldn't crash the mastery view.
 *
 * Always returns one entry per PATTERN_SLUGS, in that fixed order, even for
 * patterns with zero attempts (attemptCount 0, accuracy null) — so the
 * caller can render a stable, complete list without special-casing gaps.
 */
export function computeMastery(
  attempts: readonly Attempt[],
  pool: readonly Puzzle[],
): PatternMastery[] {
  const patternByPuzzleId = new Map<string, PatternSlug>(
    pool.map((puzzle) => [puzzle.id, puzzle.pattern]),
  )

  const byPattern = new Map<PatternSlug, Attempt[]>()
  for (const attempt of attempts) {
    const pattern = patternByPuzzleId.get(attempt.puzzleId)
    if (pattern === undefined) continue
    const list = byPattern.get(pattern)
    if (list) {
      list.push(attempt)
    } else {
      byPattern.set(pattern, [attempt])
    }
  }

  return PATTERN_SLUGS.map((pattern) => {
    const list = byPattern.get(pattern) ?? []
    const windowed = list.slice(-MASTERY_WINDOW)
    const attemptCount = windowed.length
    const accuracy =
      attemptCount >= MIN_ATTEMPTS_FOR_MASTERY
        ? windowed.filter((attempt) => attempt.correct).length / attemptCount
        : null
    return { pattern, attemptCount, accuracy }
  })
}
