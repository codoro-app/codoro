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

// Exported (in addition to PuzzleSchema) so generatePuzzles.ts can request
// structured output against a single flat variant — Claude's structured
// outputs don't support the $defs shape zodOutputFormat produces for
// PuzzleSchema's discriminated union. The union + superRefine remain the
// authoritative validation; these are the same schemas, not a fork of them.
export const McqSchema = BaseSchema.extend({
  interaction: z.literal('mcq'),
  choices: z.array(z.string().min(1)).min(2).max(5),
  correct_choice: z.number().int().nonnegative(),
})

export const SwipeBinarySchema = BaseSchema.extend({
  interaction: z.literal('swipe-binary'),
  left_label: z.string().min(1),
  right_label: z.string().min(1),
  correct_direction: z.enum(['left', 'right']),
})

export const TapLineSchema = BaseSchema.extend({
  interaction: z.literal('tap-line'),
  correct_line: z.number().int().nonnegative(),
})

/**
 * One executed line of a scrubber trace. `vars` is the full variable map as
 * display strings (not typed values) — post-line state, keyed by variable
 * name — deliberately, so the UI can render it and the validator below can
 * compare it without a JS/Python value type system needing to agree.
 * `output` is the text (if any) that line itself produced (e.g. a `print`/
 * `console.log` call); most steps have none.
 */
export const ScrubberStepSchema = z.object({
  line: z.number().int().nonnegative(),
  vars: z.record(z.string(), z.string()),
  output: z.string().optional(),
})

/**
 * A pause point in the trace, sitting after `steps[afterStep]` has executed.
 * `target` is only meaningful (and required) for `question: 'var-value'`.
 * See PuzzleSchema's superRefine for what "consistent with the trace" means
 * for each question type — that's the mechanism, this is just the shape.
 */
export const ScrubberCheckpointSchema = z.object({
  afterStep: z.number().int().nonnegative(),
  question: z.enum(['next-line', 'var-value', 'output']),
  target: z.string().min(1).optional(),
  choices: z.array(z.string().min(1)).min(2).max(5),
  correct: z.number().int().nonnegative(),
})

export const ScrubberSchema = BaseSchema.extend({
  interaction: z.literal('scrubber'),
  steps: z.array(ScrubberStepSchema).min(1),
  checkpoints: z.array(ScrubberCheckpointSchema).min(2).max(4),
})

/** `steps[index]`, guarding noUncheckedIndexedAccess for an index already bounds-checked at the call site. */
function requireStep(
  steps: readonly z.infer<typeof ScrubberStepSchema>[],
  index: number,
): z.infer<typeof ScrubberStepSchema> {
  const step = steps[index]
  if (step === undefined) {
    throw new Error(
      `requireStep: index ${String(index)} out of range for ${String(steps.length)} steps`,
    )
  }
  return step
}

function validateScrubberCheckpoints(
  puzzle: z.infer<typeof ScrubberSchema>,
  ctx: z.RefinementCtx,
): void {
  const lineCount = puzzle.snippet.split('\n').length
  puzzle.steps.forEach((step, i) => {
    if (step.line >= lineCount) {
      ctx.addIssue({
        code: 'custom',
        message: `steps[${String(i)}].line (${String(step.line)}) is out of range for a ${String(lineCount)}-line snippet`,
        path: ['steps', i, 'line'],
      })
    }
  })

  puzzle.checkpoints.forEach((checkpoint, i) => {
    const path: (string | number)[] = ['checkpoints', i]
    const previous = i > 0 ? puzzle.checkpoints[i - 1] : undefined

    if (previous !== undefined && checkpoint.afterStep <= previous.afterStep) {
      ctx.addIssue({
        code: 'custom',
        message: 'checkpoints must be strictly ordered by afterStep, with no duplicates',
        path: [...path, 'afterStep'],
      })
    }

    if (checkpoint.correct >= checkpoint.choices.length) {
      ctx.addIssue({
        code: 'custom',
        message: `correct (${String(checkpoint.correct)}) is out of range for ${String(checkpoint.choices.length)} choices`,
        path: [...path, 'correct'],
      })
    }

    if (new Set(checkpoint.choices).size !== checkpoint.choices.length) {
      ctx.addIssue({
        code: 'custom',
        message: 'choices must be distinct',
        path: [...path, 'choices'],
      })
    }

    if (checkpoint.afterStep >= puzzle.steps.length) {
      ctx.addIssue({
        code: 'custom',
        message: `afterStep (${String(checkpoint.afterStep)}) is out of range for ${String(puzzle.steps.length)} steps`,
        path: [...path, 'afterStep'],
      })
      return
    }

    // Everything past this point compares a claimed answer against the
    // trace's own recorded state — the mechanism that makes a wrong trace
    // structurally unable to pass validation. correct/choices bounds were
    // already checked above; skip the value comparison if that already
    // failed rather than indexing into choices with an out-of-range value.
    if (checkpoint.correct >= checkpoint.choices.length) return
    const claimed = checkpoint.choices[checkpoint.correct]

    if (checkpoint.question === 'next-line') {
      if (checkpoint.afterStep >= puzzle.steps.length - 1) {
        ctx.addIssue({
          code: 'custom',
          message: 'a next-line checkpoint cannot sit on the final step',
          path: [...path, 'afterStep'],
        })
        return
      }
      const nextLine = requireStep(puzzle.steps, checkpoint.afterStep + 1).line
      if (claimed !== String(nextLine)) {
        ctx.addIssue({
          code: 'custom',
          message: `next-line choices[correct] ("${String(claimed)}") does not match the trace's actual next line (${String(nextLine)})`,
          path: [...path, 'choices'],
        })
      }
    }

    if (checkpoint.question === 'var-value') {
      if (checkpoint.target === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: 'a var-value checkpoint requires target',
          path: [...path, 'target'],
        })
        return
      }
      const step = requireStep(puzzle.steps, checkpoint.afterStep)
      const actual = Object.hasOwn(step.vars, checkpoint.target)
        ? step.vars[checkpoint.target]
        : undefined
      if (actual === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: `target "${checkpoint.target}" is not a variable present at step ${String(checkpoint.afterStep)}`,
          path: [...path, 'target'],
        })
      } else if (claimed !== actual) {
        ctx.addIssue({
          code: 'custom',
          message: `var-value choices[correct] ("${String(claimed)}") does not match the trace's value ("${actual}") for "${checkpoint.target}"`,
          path: [...path, 'choices'],
        })
      }
    }

    if (checkpoint.question === 'output') {
      const step = requireStep(puzzle.steps, checkpoint.afterStep)
      const actual = step.output ?? ''
      if (claimed !== actual) {
        ctx.addIssue({
          code: 'custom',
          message: `output choices[correct] ("${String(claimed)}") does not match the output actually produced at step ${String(checkpoint.afterStep)} ("${actual}")`,
          path: [...path, 'choices'],
        })
      }
    }
  })
}

export const PuzzleSchema = z
  .discriminatedUnion('interaction', [McqSchema, SwipeBinarySchema, TapLineSchema, ScrubberSchema])
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

    if (puzzle.interaction === 'scrubber') {
      validateScrubberCheckpoints(puzzle, ctx)
    }
  })

export type Puzzle = z.infer<typeof PuzzleSchema>
export type McqPuzzle = z.infer<typeof McqSchema>
export type SwipeBinaryPuzzle = z.infer<typeof SwipeBinarySchema>
export type TapLinePuzzle = z.infer<typeof TapLineSchema>
export type ScrubberPuzzle = z.infer<typeof ScrubberSchema>
