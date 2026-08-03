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
 * `snippet`), `drag-order` (Phase 5b Item 5: `blocks` in authored/display
 * order, `correct_order` a permutation pointing at the correct reading
 * order). The cross-field checks the per-variant schemas can't express
 * alone — `correct_choice` in range, `correct_line` in range,
 * `correct_order` a valid permutation of `blocks`' indices — are chained on
 * as a `superRefine` after the union, since they need the discriminant
 * already narrowed.
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
 * `blocks` is always display-ready — the AUTHORED (shuffled) order the
 * player sees on load, never re-shuffled at runtime — mirroring McqSchema's
 * `choices`/`correct_choice` and TapLineSchema's `correct_line` convention:
 * content is display-ready, a separate field points at what's correct.
 * `correct_order[i]` is the index into `blocks` belonging at position `i`
 * of the correct sequence, so the correct reading order is
 * `correct_order.map(idx => blocks[idx])`. `.min(3)`: fewer than three
 * blocks is a coin flip, not a puzzle (see PuzzleSchema's superRefine for
 * the permutation check `correct_order` gets on top of this).
 *
 * Deliberately excluded from Rush's puzzle pool — see rush.ts's
 * `RushInteraction` doc comment for why.
 */
export const DragOrderSchema = BaseSchema.extend({
  interaction: z.literal('drag-order'),
  blocks: z.array(z.string().min(1)).min(3),
  correct_order: z.array(z.number().int().nonnegative()),
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
  // .min(1), not just optional: an authored `output: ""` would otherwise
  // pass the "output is present" refinement below but could never match a
  // `.min(1)` choice either, reproducing the exact confusing
  // choices-mismatch error P5 was written to eliminate. The real trace
  // generators never emit an empty string (they omit the field instead),
  // so this only rejects content that was already unusable.
  output: z.string().min(1).optional(),
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

/**
 * Phase 4 (docs/v2-build-plan.md, Item 4): the shape requested from the
 * model's "propose" call in the scrubber pipeline's two-pass generation —
 * every BaseSchema field plus the interaction discriminant, but neither
 * `steps` nor `checkpoints`. Generation is necessarily two-pass because a
 * `var-value`/`output` checkpoint's `choices` are real values at real steps
 * that don't exist until the trace generator (the only source of truth for
 * `steps[]`) has actually executed the snippet — the model is never asked
 * to emit a trace. Exported for generateScrubberPuzzles.ts's structured-
 * output request, same pattern as McqSchema/SwipeBinarySchema/TapLineSchema
 * above (Claude's structured-output API rejects the $defs shape
 * zodOutputFormat produces for a discriminated union).
 */
export const ScrubberProposeSchema = BaseSchema.extend({
  interaction: z.literal('scrubber'),
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
      const target = checkpoint.target
      const step = requireStep(puzzle.steps, checkpoint.afterStep)
      const actual = Object.hasOwn(step.vars, target) ? step.vars[target] : undefined
      if (actual === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: `target "${target}" is not a variable present at step ${String(checkpoint.afterStep)}`,
          path: [...path, 'target'],
        })
        return
      }
      if (claimed !== actual) {
        ctx.addIssue({
          code: 'custom',
          message: `var-value choices[correct] ("${String(claimed)}") does not match the trace's value ("${actual}") for "${target}"`,
          path: [...path, 'choices'],
        })
      }

      // Option B (docs/v2-phase2-review.md, P1): the checkpoint's target
      // stays on screen at the pause, masked by the UI (Phase 3) — but that
      // only reads as an honest question if the value the player fills in
      // is one they had to actually compute. A target that has sat
      // unchanged for one or more prior steps was already visible before
      // the question was asked. `afterStep: 0` has no previous step to
      // compare against — nothing was on screen before, so it counts as
      // changed by definition. A target absent at the previous step and
      // present now also counts as changed (it just entered scope).
      const changedAtStep =
        checkpoint.afterStep === 0 ||
        (() => {
          const previousStep = requireStep(puzzle.steps, checkpoint.afterStep - 1)
          const previousValue = Object.hasOwn(previousStep.vars, target)
            ? previousStep.vars[target]
            : undefined
          return previousValue !== actual
        })()
      if (!changedAtStep) {
        ctx.addIssue({
          code: 'custom',
          message: `var-value checkpoint targets "${target}" at step ${String(checkpoint.afterStep)}, but its value did not change from step ${String(checkpoint.afterStep - 1)} (still "${actual}") — the masked value would already have been visible on screen before this question was asked. Pick a checkpoint where the target's value actually changes at this step.`,
          path: [...path, 'afterStep'],
        })
      }
    }

    if (checkpoint.question === 'output') {
      const step = requireStep(puzzle.steps, checkpoint.afterStep)
      // Option B (docs/v2-phase2-review.md, P1/P5): an output checkpoint
      // asks "what did this line print?" — that question is only
      // answerable if the step actually produced output. This was
      // previously an emergent consequence of `actual = step.output ?? ''`
      // (an empty string can never equal a `.min(1)` choice), never a
      // stated rule; made explicit here with a message that tells an
      // author what to do instead of a confusing choices mismatch.
      if (step.output === undefined) {
        ctx.addIssue({
          code: 'custom',
          message: `an output checkpoint requires steps[${String(checkpoint.afterStep)}].output to be present — this step produced no output, so "what did this line print?" has no answer to ask about. Pick a step that actually produces output, or use a different question type.`,
          path: [...path, 'afterStep'],
        })
        return
      }
      const actual = step.output
      if (claimed !== actual) {
        ctx.addIssue({
          code: 'custom',
          message: `output choices[correct] ("${String(claimed)}") does not match the output actually produced at step ${String(checkpoint.afterStep)} ("${actual}")`,
          path: [...path, 'choices'],
        })
      }

      // Phase 5 Item 0: an output checkpoint whose correct choice carries a
      // quoted console.log/print literal label (e.g. `"max sum:" 10`) is
      // answerable by format alone — it's the only choice that looks like
      // real printed output — unless at least one distractor also carries a
      // quoted label. Confirmed live on oob-011 (both output checkpoints).
      const correctLabel = /^"[^"]*"/.exec(actual)?.[0] ?? null
      if (correctLabel !== null) {
        const distractors = checkpoint.choices.filter((_, ci) => ci !== checkpoint.correct)
        const hasLabeledDistractor = distractors.some((c) => /^"[^"]*"/.test(c))
        if (!hasLabeledDistractor) {
          ctx.addIssue({
            code: 'custom',
            message: `output checkpoint's correct choice ("${actual}") carries a quoted print-statement label, but none of its distractors do — the correct answer is identifiable by format alone, without tracing execution. Add at least one distractor that also carries a quoted label.`,
            path: [...path, 'choices'],
          })
        }
      }
    }
  })
}

export const PuzzleSchema = z
  .discriminatedUnion('interaction', [
    McqSchema,
    SwipeBinarySchema,
    TapLineSchema,
    DragOrderSchema,
    ScrubberSchema,
  ])
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

    if (puzzle.interaction === 'drag-order') {
      if (puzzle.correct_order.length !== puzzle.blocks.length) {
        ctx.addIssue({
          code: 'custom',
          message: `correct_order.length (${String(puzzle.correct_order.length)}) must equal blocks.length (${String(puzzle.blocks.length)})`,
          path: ['correct_order'],
        })
      } else {
        const seen = new Set<number>()
        puzzle.correct_order.forEach((index, i) => {
          if (index >= puzzle.blocks.length) {
            ctx.addIssue({
              code: 'custom',
              message: `correct_order[${String(i)}] (${String(index)}) is out of range for ${String(puzzle.blocks.length)} blocks`,
              path: ['correct_order', i],
            })
          } else if (seen.has(index)) {
            ctx.addIssue({
              code: 'custom',
              message: `correct_order[${String(i)}] (${String(index)}) is a duplicate — correct_order must be a permutation of every block index exactly once`,
              path: ['correct_order', i],
            })
          }
          seen.add(index)
        })

        const missing = puzzle.blocks.map((_, index) => index).filter((index) => !seen.has(index))
        if (missing.length > 0) {
          ctx.addIssue({
            code: 'custom',
            message: `correct_order is missing block index(es) ${missing.map(String).join(', ')} — it must be a permutation covering every block index exactly once`,
            path: ['correct_order'],
          })
        }

        // A drag-order puzzle whose blocks are already in the correct
        // order isn't a puzzle — there's nothing to reorder. Only checked
        // once correct_order is confirmed a real permutation (the branches
        // above) so this doesn't also fire (confusingly) for a puzzle
        // that's already broken in some other way.
        if (
          missing.length === 0 &&
          puzzle.correct_order.every((index, position) => index === position)
        ) {
          ctx.addIssue({
            code: 'custom',
            message:
              'correct_order is the identity permutation ([0, 1, 2, ...]) — blocks are already in their correct order, so there is nothing to drag. Shuffle blocks into a non-identity display order.',
            path: ['correct_order'],
          })
        }
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
export type DragOrderPuzzle = z.infer<typeof DragOrderSchema>
export type ScrubberPuzzle = z.infer<typeof ScrubberSchema>

/**
 * The element type of `quizPool` (src/content/index.ts) — every interaction
 * except scrubber. Scrubber is deliberately excluded from this union: it
 * gets its own mode/route/renderer (Phase 3), not a fourth branch in the
 * quiz shell, per the Phase 2 corrective review's "own mode with shared
 * rating" decision. Practice/Daily/Rush all serve from `quizPool`, typed to
 * this union, rather than the full `Puzzle` union `puzzlePool` carries.
 *
 * `PuzzleCardShellProps.puzzle` is still typed `Puzzle` (not `QuizPuzzle`)
 * — its exhaustive switch's `assertNever` default already forces a compile
 * error for any truly new interaction, and scrubber itself is handled
 * there with an explicit throw (see PuzzleCardShell.tsx), not by narrowing
 * this prop's type. `QuizPuzzle` exists for the pool split, not the shell.
 */
export type QuizPuzzle = McqPuzzle | SwipeBinaryPuzzle | TapLinePuzzle | DragOrderPuzzle
