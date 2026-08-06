/**
 * Scoring for the execution-scrubber interaction. Pure TS — no content/
 * schema.ts import, mirroring selection.ts's own minimal-knowledge stance:
 * this module knows nothing about ScrubberSchema's checkpoint shape,
 * only "was this checkpoint's answer correct."
 */

/**
 * One checkpoint's outcome within a single scrubber attempt. Mirrors
 * CommitPayload's { correct, choiceIndex } shape (src/app/practice/
 * interactionTypes.ts) — the interaction body already knows how to
 * compare a picked choice against a checkpoint's `correct` index, so
 * that comparison happens there, not here; this module only aggregates
 * already-scored results. Also the shape src/storage/schema.ts's
 * CheckpointResultSchema mirrors for the attempt log.
 *
 * `choiceIndex` is nullable: a checkpoint that times out (Phase 5b Item 6,
 * decision 7) must produce this same shape, not a third state — `null`
 * ("no choice was made") is unambiguous against every real answer, which is
 * always a nonnegative index into that checkpoint's `choices`.
 */
export interface CheckpointResult {
  readonly correct: boolean
  readonly choiceIndex: number | null
}

/**
 * Locked rule: all checkpoints correct on first try = solve; any miss =
 * fail — one binary rated outcome per puzzle, same Elo semantics as v1.
 *
 * "First try" here means: each checkpoint accepts exactly one answer (no
 * retry — the same single-commit plumbing every other interaction type
 * already uses) and a miss does not end the attempt early. The player
 * answers every checkpoint and sees the full trace/explanation
 * regardless of any miss along the way (Phase 3's "reveal shows correct
 * value + state diff; scrubbing continues" applies the same way whether
 * the answer was right or wrong). Chosen over "stop at the first miss"
 * for two reasons: it matches how every other v1 interaction already
 * works (one commit, no retry, nothing stops early), and it's the only
 * choice that produces a COMPLETE per-checkpoint result set on every
 * attempt — "stop on miss" would leave later checkpoints unanswered,
 * which is a weaker signal for Phase 6's future partial-credit tuning
 * than this function deliberately ignores for scoring today. This is a
 * UI/product call as much as an engine one — Phase 3 may find "stop on
 * first miss" reads better once it's actually on a phone; if so, this
 * function doesn't change, it would just score a shorter array.
 *
 * An empty result set is never a solve (defensive — ScrubberSchema
 * requires 2-4 checkpoints, so this shouldn't happen from real content,
 * but a vacuous `every()` on an empty array would otherwise say "solved"
 * for zero answered checkpoints).
 */
export function scoreScrubberAttempt(results: readonly CheckpointResult[]): boolean {
  return results.length > 0 && results.every((result) => result.correct)
}

/**
 * Per-checkpoint fractional credit for the Elo update (rating.ts's
 * `updateRating` accepts this directly as its `correct` argument) —
 * deliberately separate from `scoreScrubberAttempt` above, which stays
 * all-or-nothing and keeps driving "solved" status, the streak counter, and
 * requeue-on-miss unchanged. A 3-of-4 attempt still doesn't feel like a
 * clean solve and still gets requeued for review, but it no longer rates
 * identically to a 0-of-4 attempt — the two outcomes are clearly different
 * skill signals and deserve different rating deltas.
 *
 * `choiceCounts[i]` is the number of choices `results[i]`'s checkpoint
 * offered (`ScrubberCheckpointSchema.choices.length`, always 2-4) — the raw
 * correct-fraction is guess-floor-corrected against it before being handed
 * to Elo, the same reasoning CALIBRATION.md's swipe-binary modifier applies
 * to a single 50/50 interaction (guessing inflates the empirical pass rate,
 * which Elo reads as skill), generalized to a per-checkpoint choice count
 * that varies puzzle to puzzle instead of a flat content-rating bump. Each
 * checkpoint's chance-alone expectation is `1/choiceCounts[i]`; the mean of
 * those is `floor`, and the score is rescaled so "exactly at the guess
 * floor" reads as 0 (no skill signal, matching a plain miss) and "perfect"
 * still reads as 1: `(raw - floor) / (1 - floor)`, clamped to `[0, 1]` (an
 * unlucky sub-floor raw score must not go negative). Without this, a
 * 70%-per-checkpoint player nets roughly +350 Elo versus the same skill
 * under plain all-or-nothing scoring — measured against `scrubberPool` —
 * because a chance-level raw score was being read as meaningful positive
 * signal instead of noise.
 *
 * 0 for an empty result set, matching `scoreScrubberAttempt`'s own
 * defensive floor (shouldn't happen from real content — ScrubberSchema
 * requires 2-4 checkpoints — but a `0/0` division would otherwise produce
 * `NaN` and silently corrupt the caller's rating math). `choiceCounts`
 * entries are defensively floored at 2 (this module deliberately doesn't
 * import ScrubberCheckpointSchema to enforce that bound itself) so a
 * malformed 0/1 count can't produce a `floor >= 1`, which would divide by
 * zero.
 */
export function scrubberActualScore(
  results: readonly CheckpointResult[],
  choiceCounts: readonly number[],
): number {
  if (results.length === 0) return 0
  const correctCount = results.filter((result) => result.correct).length
  const raw = correctCount / results.length
  const floorSum = results.reduce((sum: number, _result, i) => {
    const count = Math.max(2, choiceCounts[i] ?? 2)
    return sum + 1 / count
  }, 0)
  const floor = floorSum / results.length
  const rescaled = (raw - floor) / (1 - floor)
  return Math.min(1, Math.max(0, rescaled))
}

/**
 * How much more a trace attempt swings the rating than a single-commit quiz
 * answer, on top of the standard attempt-count K tiers (rating.ts's
 * `getK`) — passed as `updateRating`'s `kMultiplier`. A trace attempt
 * demonstrates correctness across 2-4 sequential checkpoints rather than
 * one tap, so it carries more signal per attempt; this is a named, tunable
 * constant (not inlined) for the same reason rush.ts's RUSH_DIFFICULTY_STEP
 * is — expect it to move after real play-test data comes in.
 */
export const TRACE_K_MULTIPLIER = 1.5
