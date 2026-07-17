/**
 * Zod schema + TS types for puzzle content (src/content/puzzles/**\/*.json).
 *
 * Every puzzle file must satisfy PuzzleSchema before it can ship: checked
 * once per-file by `validate:content` (CI-enforced, see tools/), and again
 * at build/dev time when the app aggregates the pool (see index.ts) — so
 * invalid content can never reach a real user even if the CI gate were
 * bypassed.
 *
 * A discriminated union on `interaction`, per CALIBRATION.md /
 * codoro_build_plan.md's Phase 3 spec: `mcq` (2-5 choices), `swipe-binary`
 * (left/right + correct direction), `tap-line` (correct_line indexes into
 * `snippet`). The two cross-field checks the per-variant schemas can't
 * express alone — `correct_choice` in range, `correct_line` in range — are
 * chained on as a `superRefine` after the union, since they need the
 * discriminant already narrowed.
 */
import { z } from 'zod'
import { PATTERN_SLUGS } from './patterns'

export const MIN_DIFFICULTY = 800
export const MAX_DIFFICULTY = 2400

const IdSchema = z
  .string()
  .min(1)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'id must be lowercase kebab-case (e.g. "tp-014")')

/** Fields every puzzle has, regardless of interaction type. */
const BaseSchema = z.object({
  id: IdSchema,
  pattern: z.enum(PATTERN_SLUGS),
  difficulty_rating: z.number().int().min(MIN_DIFFICULTY).max(MAX_DIFFICULTY),
  explanation: z.string().min(1),
  prompt: z.string().min(1),
  language: z.string().min(1),
  snippet: z.string().min(1),
})

const McqSchema = BaseSchema.extend({
  interaction: z.literal('mcq'),
  choices: z.array(z.string().min(1)).min(2).max(5),
  correct_choice: z.number().int().nonnegative(),
})

const SwipeBinarySchema = BaseSchema.extend({
  interaction: z.literal('swipe-binary'),
  left_label: z.string().min(1),
  right_label: z.string().min(1),
  correct_direction: z.enum(['left', 'right']),
})

const TapLineSchema = BaseSchema.extend({
  interaction: z.literal('tap-line'),
  correct_line: z.number().int().nonnegative(),
})

export const PuzzleSchema = z
  .discriminatedUnion('interaction', [McqSchema, SwipeBinarySchema, TapLineSchema])
  .superRefine((puzzle, ctx) => {
    if (puzzle.interaction === 'mcq' && puzzle.correct_choice >= puzzle.choices.length) {
      ctx.addIssue({
        code: 'custom',
        message: `correct_choice (${String(puzzle.correct_choice)}) is out of range for ${String(puzzle.choices.length)} choices`,
        path: ['correct_choice'],
      })
    }

    if (puzzle.interaction === 'tap-line') {
      const lineCount = puzzle.snippet.split('\n').length
      if (puzzle.correct_line >= lineCount) {
        ctx.addIssue({
          code: 'custom',
          message: `correct_line (${String(puzzle.correct_line)}) is out of range for a ${String(lineCount)}-line snippet`,
          path: ['correct_line'],
        })
      }
    }
  })

export type Puzzle = z.infer<typeof PuzzleSchema>
export type McqPuzzle = z.infer<typeof McqSchema>
export type SwipeBinaryPuzzle = z.infer<typeof SwipeBinarySchema>
export type TapLinePuzzle = z.infer<typeof TapLineSchema>
