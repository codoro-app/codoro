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
