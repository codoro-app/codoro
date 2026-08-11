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
 * Boss's authored run (src/content/bossRun.ts) gets the same treatment as
 * the daily calendar above: every id must resolve to a real, non-scrubber
 * puzzle, and ids must be unique. Boss-specific on top of that, since the
 * whole feature's premise is "escalating difficulty": ratings must be
 * non-decreasing across the run, and the run must be exactly
 * BOSS_RUN_LENGTH long. A future hand-edit that breaks the escalation (or
 * silently drops/adds a puzzle) fails the build instead of shipping a Boss
 * run that doesn't actually escalate.
 */
export const BOSS_RUN_LENGTH = 10

export function validateBossRun(
  bossRun: readonly string[],
  valid: readonly ValidatedPuzzle[],
): string[] {
  const errors: string[] = []
  const byId = new Map(valid.map((entry) => [entry.puzzle.id, entry.puzzle]))
  const scrubberIds = new Set(
    valid
      .filter((entry) => entry.puzzle.interaction === 'scrubber')
      .map((entry) => entry.puzzle.id),
  )

  if (bossRun.length !== BOSS_RUN_LENGTH) {
    errors.push(
      `bossRun.ts: expected exactly ${String(BOSS_RUN_LENGTH)} entries, found ${String(bossRun.length)}`,
    )
  }

  const seen = new Set<string>()
  let previousRating: number | null = null

  bossRun.forEach((id, index) => {
    if (seen.has(id)) {
      errors.push(`bossRun.ts: duplicate id "${id}" at position ${String(index)}`)
      return
    }
    seen.add(id)

    if (scrubberIds.has(id)) {
      errors.push(
        `bossRun.ts: entry "${id}" at position ${String(index)} is a scrubber puzzle — Boss's strike model needs a binary correct/wrong outcome, not scrubber's partial credit.`,
      )
      return
    }

    const puzzle = byId.get(id)
    if (!puzzle) {
      errors.push(
        `bossRun.ts: entry "${id}" at position ${String(index)} does not match any valid puzzle`,
      )
      return
    }

    if (previousRating !== null && puzzle.difficulty_rating < previousRating) {
      errors.push(
        `bossRun.ts: entry "${id}" at position ${String(index)} (rating ${String(puzzle.difficulty_rating)}) is lower than the previous entry's rating ${String(previousRating)} — Boss must escalate, never step down`,
      )
    }
    previousRating = puzzle.difficulty_rating
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
  /\b(no ?bug|safe(?:ly)?|correct(?:ly)?|works?|fine|valid(?:ly)?|proper(?:ly)?|ok|right|normal)\b/i
const DEFECT_LABEL_RE =
  /\b((?<!no )bug|buggy|broken|race|leak|crash|throw|blow|corrupt|crashes|fails?|wrong|undefined behaviour|undefined behavior)\b/i

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

/**
 * Phase 6 v2 DoD targets (docs/v2-build-plan.md §Phase 6 items 4/5 + the v2
 * authoring amendment). Shared with contentStats.ts so the report and the hard
 * gate can never disagree on the target numbers.
 */
export const LANGUAGE_ORDER = ['javascript', 'python', 'java', 'c'] as const
export const LANGUAGE_TARGETS: Record<(typeof LANGUAGE_ORDER)[number], number> = {
  javascript: 40,
  python: 25,
  java: 25,
  c: 10,
}
export const LANGUAGE_TOLERANCE_POINTS = 10

/** Anti-anchoring hard bound: no single exact difficulty_rating may exceed this share of the pool. */
export const CLUSTER_MAX_SHARE = 0.15

/**
 * Phase 6 DoD hard gate — anti-anchoring. v1 clustered most of its library at a
 * handful of exact ratings (1000/1600/1700/1900); the difficulty rubric is the
 * real fix, this gate keeps a future batch from quietly re-concentrating
 * ratings. Same threshold contentStats reports on, but a hard
 * `validate:content` failure here (docs/v2-build-plan.md, Phase 6 item 5).
 */
export function validateRatingCluster(valid: readonly ValidatedPuzzle[]): string[] {
  if (valid.length === 0) return []

  const counts = new Map<number, number>()
  for (const entry of valid) {
    counts.set(
      entry.puzzle.difficulty_rating,
      (counts.get(entry.puzzle.difficulty_rating) ?? 0) + 1,
    )
  }

  const clustered = [...counts.entries()]
    .map(([rating, count]) => ({ rating, count, share: count / valid.length }))
    .filter((entry) => entry.share > CLUSTER_MAX_SHARE)
    .sort((a, b) => b.share - a.share)

  if (clustered.length === 0) return []

  return [
    `difficulty_rating anti-anchoring cluster: ${clustered
      .map(
        (entry) =>
          `${String(entry.rating)} (${String(entry.count)} puzzle(s), ${(entry.share * 100).toFixed(1)}%)`,
      )
      .join(
        ', ',
      )} — no single rating may be used by more than ${String(CLUSTER_MAX_SHARE * 100)}% of the pool.`,
  ]
}

/**
 * Phase 6 DoD hard gate — quiz language mix (scrubber excluded) within
 * LANGUAGE_TOLERANCE_POINTS of the 40/25/25/10 JS/Py/Java/C target. A library
 * that is ~all one language under-serves the learners that language is not.
 * Hard `validate:content` failure so an authoring batch can't silently tilt it.
 */
export function validateLanguageMix(valid: readonly ValidatedPuzzle[]): string[] {
  const quiz = valid.filter((entry) => entry.puzzle.interaction !== 'scrubber')
  if (quiz.length === 0) return []

  const counts = new Map<string, number>()
  for (const entry of quiz) {
    counts.set(entry.puzzle.language, (counts.get(entry.puzzle.language) ?? 0) + 1)
  }

  const outOfBand: string[] = []
  for (const lang of LANGUAGE_ORDER) {
    const share = ((counts.get(lang) ?? 0) / quiz.length) * 100
    if (Math.abs(share - LANGUAGE_TARGETS[lang]) > LANGUAGE_TOLERANCE_POINTS) {
      outOfBand.push(
        `${lang} at ${share.toFixed(1)}% (target ${String(LANGUAGE_TARGETS[lang])}% ±${String(LANGUAGE_TOLERANCE_POINTS)}pt)`,
      )
    }
  }

  if (outOfBand.length === 0) return []

  return [
    `quiz language mix is out of the 40/25/25/10 JS/Py/Java/C target band (±${String(LANGUAGE_TOLERANCE_POINTS)}pt): ${outOfBand.join('; ')}.`,
  ]
}

/**
 * Phase 6 v2 interaction-mix hard gate. Both DoD thresholds are NEW-content
 * deltas (≤⅓ of new quiz puzzles plain mcq; scrubber+drag-order ≥⅓ of new
 * content), which can't be judged from the full library state alone — so this
 * checks them against a FIXED baseline: the Phase 5 library as committed at
 * `020ed7b` (the parent of the Phase 6 v2 authoring branch). "New" is defined
 * deterministically as current − baseline, so any content authored after
 * Phase 5 is held to the same mix rules and the gate keeps working for future
 * authoring batches.
 */
const BASELINE_QUIZ = 111
const BASELINE_MCQ = 42
const BASELINE_DRAG_ORDER = 3
const BASELINE_SCRUBBER = 43
const BASELINE_TOTAL = 154
const NEW_QUIZ_MCQ_MAX_SHARE = 1 / 3
const NEW_CONTENT_INTERACTIVE_MIN_SHARE = 1 / 3

export function validateInteractionMix(valid: readonly ValidatedPuzzle[]): string[] {
  const puzzles = valid.map((entry) => entry.puzzle)
  const quiz = puzzles.filter((p) => p.interaction !== 'scrubber')
  const mcq = puzzles.filter((p) => p.interaction === 'mcq').length
  const dragOrder = puzzles.filter((p) => p.interaction === 'drag-order').length
  const scrubber = puzzles.filter((p) => p.interaction === 'scrubber').length

  const newQuiz = quiz.length - BASELINE_QUIZ
  const newContent = puzzles.length - BASELINE_TOTAL
  const newMcq = mcq - BASELINE_MCQ
  const newInteractive = dragOrder + scrubber - (BASELINE_DRAG_ORDER + BASELINE_SCRUBBER)

  const errors: string[] = []

  if (newQuiz > 0 && newMcq / newQuiz > NEW_QUIZ_MCQ_MAX_SHARE) {
    errors.push(
      `interaction mix: ${String(newMcq)} of ${String(newQuiz)} new quiz puzzles are plain mcq (${((newMcq / newQuiz) * 100).toFixed(1)}%) — above the ≤⅓ cap on new mcq content.`,
    )
  }

  if (newContent > 0 && newInteractive / newContent < NEW_CONTENT_INTERACTIVE_MIN_SHARE) {
    errors.push(
      `interaction mix: ${String(newInteractive)} of ${String(newContent)} new content pieces are interactive (scrubber or drag-order, ${((newInteractive / newContent) * 100).toFixed(1)}%) — below the ≥⅓ floor.`,
    )
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
