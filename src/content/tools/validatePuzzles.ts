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

  return { valid, errors }
}
