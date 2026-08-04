/**
 * Shared validation core for the content CLI tools: schema-checks every raw
 * puzzle file and enforces the rules no single file's schema can express on
 * its own — unique `id` across the whole pool, and the swipe-binary
 * direction balance below.
 */
import { PuzzleSchema } from '../schema'
import type { Puzzle, SwipeBinaryPuzzle } from '../schema'
import type { RawPuzzleFile } from './loadPuzzles'

export interface ValidatedPuzzle {
  readonly filePath: string
  readonly puzzle: Puzzle
}

export interface ValidationResult {
  readonly valid: readonly ValidatedPuzzle[]
  readonly errors: readonly string[]
}

/**
 * Hard bound on how skewed `swipe-binary` `correct_direction` may get across
 * the pool. This is a rating-integrity rule, not a style preference: a skew
 * past this line means a player who swipes the majority side without
 * reading climbs Elo for free on however much of the library that majority
 * covers. v1's content anchored 39/39 puzzles to "right" because
 * `generatePuzzles.ts`'s single worked example hardcoded that direction and
 * every generation run copied it (see docs/v2-build-plan.md Phase 0) — a
 * `content:stats`-style warning would not have caught that, since nothing
 * ever looked at the split until this was discovered by manual inspection.
 * This is deliberately a hard `validate:content` failure so a future
 * generation batch cannot quietly re-anchor the library the same way.
 */
const SWIPE_DIRECTION_SKEW_THRESHOLD = 0.65

function isSwipeBinaryEntry(
  entry: ValidatedPuzzle,
): entry is { filePath: string; puzzle: SwipeBinaryPuzzle } {
  return entry.puzzle.interaction === 'swipe-binary'
}

function validateSwipeDirectionBalance(valid: readonly ValidatedPuzzle[]): string[] {
  const swipeBinaryPuzzles = valid.filter(isSwipeBinaryEntry)
  if (swipeBinaryPuzzles.length === 0) return []

  const rightCount = swipeBinaryPuzzles.filter(
    (entry) => entry.puzzle.correct_direction === 'right',
  ).length
  const leftCount = swipeBinaryPuzzles.length - rightCount
  const rightRatio = rightCount / swipeBinaryPuzzles.length
  const leftRatio = leftCount / swipeBinaryPuzzles.length

  if (rightRatio <= SWIPE_DIRECTION_SKEW_THRESHOLD && leftRatio <= SWIPE_DIRECTION_SKEW_THRESHOLD) {
    return []
  }

  const dominant = rightCount >= leftCount ? 'right' : 'left'
  const dominantCount = Math.max(rightCount, leftCount)
  return [
    `swipe-binary correct_direction is skewed ${String(dominantCount)}/${String(swipeBinaryPuzzles.length)} "${dominant}" ` +
      `(right=${String(rightCount)}, left=${String(leftCount)}) — must stay within a ` +
      `${String(SWIPE_DIRECTION_SKEW_THRESHOLD * 100)}/${String((1 - SWIPE_DIRECTION_SKEW_THRESHOLD) * 100)} split in either ` +
      `direction, or a player who always swipes "${dominant}" without reading climbs Elo for free.`,
  ]
}

/**
 * Every daily-calendar id must resolve to a real, valid, non-scrubber
 * puzzle, and ids must be unique within the calendar. Checking against
 * quiz-only ids (not the full valid-id set) is deliberate: Daily serving a
 * scrubber puzzle was safe on `main` only by accident — none of the curated
 * ids happened to name one — not by rule. Rejecting scrubber ids here makes
 * it a build failure instead, the same structural guarantee `quizPool`
 * gives app code (docs/v2-phase2-review.md, P0). Daily-serves-scrubber is a
 * deliberate Phase 3+ content call, not a silent default this validator
 * should permit by omission.
 */
export function validateDailyCalendar(
  calendar: readonly string[],
  valid: readonly ValidatedPuzzle[],
): string[] {
  const quizIds = new Set(
    valid
      .filter((entry) => entry.puzzle.interaction !== 'scrubber')
      .map((entry) => entry.puzzle.id),
  )
  const scrubberIds = new Set(
    valid
      .filter((entry) => entry.puzzle.interaction === 'scrubber')
      .map((entry) => entry.puzzle.id),
  )

  const errors: string[] = []
  const seen = new Set<string>()

  calendar.forEach((id, index) => {
    if (seen.has(id)) {
      errors.push(`dailyCalendar.ts: duplicate id "${id}" at position ${String(index)}`)
      return
    }
    seen.add(id)

    if (scrubberIds.has(id)) {
      errors.push(
        `dailyCalendar.ts: entry "${id}" at position ${String(index)} is a scrubber puzzle — Daily serves quiz puzzles only; adding scrubber to Daily is an explicit future content decision, not a default.`,
      )
      return
    }

    if (!quizIds.has(id)) {
      errors.push(
        `dailyCalendar.ts: entry "${id}" at position ${String(index)} does not match any valid puzzle`,
      )
    }
  })

  return errors
}

/**
 * The floor on how much of the swipe-binary library must be the "code is
 * fine" negative class (docs/v2-build-plan.md, Phase 6 item 5). A swipe
 * puzzle carries a 50% guess floor; if the library is ~all "find the bug",
 * a player who reasons "everything here has a bug" wins on prior alone,
 * without tracing. Requiring ≥1/3 to answer "safe" means that strategy stops
 * working and real discrimination is restored. Like the direction-skew rule,
 * this is a hard `validate:content` failure, not a warning — a future
 * authoring batch must not be able to quietly re-concentrate the library on
 * bug-seeking.
 */
const SWIPE_SAFE_MIN_SHARE = 1 / 3

/**
 * Tokens asserting the code is fine (the correct side of a `'safe'` puzzle)
 * vs. tokens naming a defect. Used only to verify the *correct-side label* of
 * `correct_verdict: 'safe'` puzzles actually claims the code is fine — a
 * puzzle marketed as "the code is safe" whose correct label names a bug is
 * incoherent. Deliberately NOT applied to `'bug'` puzzles, whose correct-side
 * labels legitimately vary between naming the defect and describing the wrong
 * (buggy) behavior; checking them would false-positive on the existing,
 * already-authored library.
 */
const SAFE_VERDICT_CORRECT_LABEL_RE =
  /\b(safe|no ?bug|correct|works?|fine|valid|properly|ok|right|normal)\b/i
const DEFECT_LABEL_RE =
  /\b(bug|buggy|broken|race|leak|crash|throw|blow|corrupt|crashes|fails?|wrong|undefined behaviour|undefined behavior)\b/i

function correctDirectionLabel(puzzle: SwipeBinaryPuzzle): string {
  return puzzle.correct_direction === 'right' ? puzzle.right_label : puzzle.left_label
}

/**
 * Second half of the Phase 6 item 5 swipe-binary check: correct-label
 * SEMANTICS, not just side. Two rules, both hard:
 *  1. Pool: ≥ `SWIPE_SAFE_MIN_SHARE` of swipe-binary puzzles are
 *     `correct_verdict: 'safe'` (the negative class), so bug-seeking-by-prior
 *     can't climb Elo for free.
 *  2. Per-puzzle: a `'safe'` puzzle's correct-side label must actually claim
 *     the code is fine (contain a safe token and no defect token).
 */
function validateSwipeSemantics(valid: readonly ValidatedPuzzle[]): string[] {
  const swipeBinaryPuzzles = valid.filter(isSwipeBinaryEntry)
  if (swipeBinaryPuzzles.length === 0) return []

  const errors: string[] = []
  const safeCount = swipeBinaryPuzzles.filter((e) => e.puzzle.correct_verdict === 'safe').length
  const safeShare = safeCount / swipeBinaryPuzzles.length

  if (safeShare < SWIPE_SAFE_MIN_SHARE) {
    errors.push(
      `swipe-binary correct_verdict is ${String(safeCount)}/${String(swipeBinaryPuzzles.length)} "safe" (${(
        safeShare * 100
      ).toFixed(
        1,
      )}%) — below the ≥${String(Math.round(SWIPE_SAFE_MIN_SHARE * 100))}% floor for the "code is fine" negative class. ` +
        `Without it, a player who assumes "everything here has a bug" wins without reading the code.`,
    )
  }

  for (const entry of swipeBinaryPuzzles) {
    if (entry.puzzle.correct_verdict !== 'safe') continue
    const label = correctDirectionLabel(entry.puzzle)
    const isSafeClaim = SAFE_VERDICT_CORRECT_LABEL_RE.test(label) && !DEFECT_LABEL_RE.test(label)
    if (!isSafeClaim) {
      errors.push(
        `${entry.puzzle.id}: correct_verdict is "safe" but the correct-side label ("${label}") does not claim the ` +
          `code is fine — a "code is safe" puzzle's correct answer must be the label asserting safety, or the negative ` +
          `class reads as a guess.`,
      )
    }
  }

  return errors
}

export function validatePuzzleFiles(files: readonly RawPuzzleFile[]): ValidationResult {
  const valid: ValidatedPuzzle[] = []
  const errors: string[] = []
  const seenIds = new Map<string, string>()

  for (const { filePath, raw } of files) {
    const result = PuzzleSchema.safeParse(raw)
    if (!result.success) {
      for (const issue of result.error.issues) {
        const location = issue.path.length > 0 ? ` (${issue.path.join('.')})` : ''
        errors.push(`${filePath}: ${issue.message}${location}`)
      }
      continue
    }

    const existing = seenIds.get(result.data.id)
    if (existing) {
      errors.push(`${filePath}: duplicate id "${result.data.id}" (also used by ${existing})`)
      continue
    }

    seenIds.set(result.data.id, filePath)
    valid.push({ filePath, puzzle: result.data })
  }

  errors.push(...validateSwipeDirectionBalance(valid))
  errors.push(...validateSwipeSemantics(valid))

  return { valid, errors }
}
