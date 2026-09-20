/**
 * Zod schema + TS types for wrong-answer explanations
 * (src/content/explanations/<puzzle-id>.json) — the v6 Phase 6.0 coach
 * layer's content model. See docs/superpowers/plans/2026-09-19-wrong-answer-
 * explanations-spec.md §3.2.
 *
 * Deliberately a separate file from schema.ts's PuzzleSchema, not a field on
 * it: an explanation set targets a specific wrong answer to a puzzle that
 * already exists, and is authored/regenerated on its own cadence (F37 — see
 * the spec's footgun register for why folding it into the puzzle JSON would
 * put paid content on the free play path).
 *
 * Two kinds of check live here vs. in validateExplanations.ts, mirroring
 * schema.ts/validatePuzzles.ts's own split: anything checkable from a single
 * file's own content (duplicate target, ordinal-position language, the
 * swipe-binary single-entry/target-0 shape) is a superRefine here, same as
 * PuzzleSchema's drag-order permutation checks. Anything that needs the real
 * puzzle pool (does this puzzle_id exist, is target in range for its actual
 * choices/snippet, does an entry target the correct answer, is coverage
 * complete) can't be expressed by this schema alone and lives in
 * validateExplanations.ts instead, mirroring validatePuzzles.ts's
 * validateDailyCalendar/validateBossRun cross-file checks.
 */
import { z } from 'zod'
import { IdSchema } from './schema'

/**
 * Crude on purpose (spec §8, item 6): "option A/B/C", "first/second/third
 * option", "the one above/below". mcq choices are shuffled per serving
 * (F35 — Mcq.tsx's `shuffledIndices`/`originalIndex`), so any positional
 * reference in `why_wrong` is wrong roughly three-quarters of the time. A
 * false positive here is worth eating; a false negative ships a broken
 * explanation.
 */
const ORDINAL_REFERENCE_RE =
  /\b(option|choice)\s+[a-eA-E]\b|\b(first|second|third|fourth|fifth)\s+(option|choice)\b|\bthe\s+one\s+(above|below)\b/i

export const ExplanationEntrySchema = z.object({
  /**
   * For mcq: the CANONICAL index into puzzle.choices (F35 — never the
   * on-screen shuffled position). For tap-line: the zero-based line index
   * into the snippet. For swipe-binary: always 0 (the wrong direction) —
   * enforced below, since a set has exactly one entry either way.
   */
  target: z.number().int().nonnegative(),

  // 2-3 sentences, addressed to someone who just picked this. Second
  // person. Explains why THIS choice is wrong, not what the right answer
  // is. See the spec's §3.3 "what the copy should and should not do."
  why_wrong: z
    .string()
    .min(40)
    .max(600)
    .refine(
      (text) => !ORDINAL_REFERENCE_RE.test(text),
      'why_wrong must not reference ordinal/positional choice language (e.g. "option B", "the second choice") — mcq choices are shuffled per serving',
    ),

  // Short kebab-case label for the underlying misconception, reused across
  // puzzles wherever the same confusion appears — the taxonomy the 6.3
  // diagnostic is built on.
  misconception: z.string().regex(/^[a-z0-9-]{3,48}$/),
})

export const ExplanationSetSchema = z
  .object({
    puzzle_id: IdSchema,
    interaction: z.enum(['mcq', 'tap-line', 'swipe-binary']),
    // ISO date, for staleness auditing.
    generated_at: z.iso.datetime({ offset: true }),
    // Bump when the prompt changes materially.
    generator_version: z.number().int().nonnegative(),
    entries: z.array(ExplanationEntrySchema).min(1),
  })
  .superRefine((set, ctx) => {
    const seen = new Set<number>()
    set.entries.forEach((entry, index) => {
      if (seen.has(entry.target)) {
        ctx.addIssue({
          code: 'custom',
          message: `duplicate target (${String(entry.target)}) at entries[${String(index)}] — every entry in a set must target a distinct wrong answer`,
          path: ['entries', index, 'target'],
        })
      }
      seen.add(entry.target)
    })

    if (set.interaction === 'swipe-binary') {
      if (set.entries.length !== 1) {
        ctx.addIssue({
          code: 'custom',
          message: `swipe-binary has exactly one wrong answer, so entries must have length 1 (got ${String(set.entries.length)})`,
          path: ['entries'],
        })
      }
      const first = set.entries[0]
      if (first !== undefined && first.target !== 0) {
        ctx.addIssue({
          code: 'custom',
          message: `swipe-binary's single entry must target 0 (the wrong direction), got ${String(first.target)}`,
          path: ['entries', 0, 'target'],
        })
      }
    }
  })

export type ExplanationEntry = z.infer<typeof ExplanationEntrySchema>
export type ExplanationSet = z.infer<typeof ExplanationSetSchema>
