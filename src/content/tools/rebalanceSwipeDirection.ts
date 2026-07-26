/**
 * `tsx src/content/tools/rebalanceSwipeDirection.ts` — one-off fix for the
 * swipe-binary rating-integrity bug (docs/v2-build-plan.md Phase 0): every
 * one of the 39 existing swipe-binary puzzles has `correct_direction:
 * "right"`, so a player who swipes right without reading climbs Elo for
 * free. Swapping `left_label`/`right_label` and flipping `correct_direction`
 * is semantics-preserving (the puzzle still asks the same question, on the
 * mirrored side), so this rebalances roughly half the pool to "left" rather
 * than authoring new content.
 *
 * Which puzzles flip is deterministic — an FNV-1a hash of each puzzle's
 * `id`, not `Math.random()` — so running this script twice against the same
 * input always flips the same set. That makes the result reproducible and
 * the JSON diff reviewable on its own terms, not just "trust the script ran
 * correctly once."
 *
 * Authoring-time only, same as generatePuzzles.ts: never imported by app
 * code, never bundled.
 */
import { writeFileSync } from 'node:fs'
import { loadRawPuzzleFiles } from './loadPuzzles'

const TARGET_LEFT_RATIO = 0.5

/** Text patterns that would make a flipped label/direction pair read wrong post-swap. */
const SIDE_REFERENCE_PATTERN =
  /\bswipe (left|right)\b|\bto the (left|right)\b|\b(left|right)[- ](hand )?side\b/i

interface RawSwipeBinary {
  id: string
  left_label: string
  right_label: string
  correct_direction: 'left' | 'right'
  explanation: string
  prompt: string
}

function isRawSwipeBinary(raw: unknown): raw is RawSwipeBinary {
  return (
    typeof raw === 'object' &&
    raw !== null &&
    (raw as Record<string, unknown>).interaction === 'swipe-binary'
  )
}

/** Standard 32-bit FNV-1a — deterministic, well-known, not cryptographic (doesn't need to be). */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

function main(): void {
  const files = loadRawPuzzleFiles()
  const swipeBinaryFiles = files.filter((file) => isRawSwipeBinary(file.raw))

  if (swipeBinaryFiles.length === 0) {
    console.log('rebalanceSwipeDirection: no swipe-binary puzzles found — nothing to do.')
    return
  }

  const sortedByHash = [...swipeBinaryFiles].sort(
    (a, b) => fnv1a((a.raw as RawSwipeBinary).id) - fnv1a((b.raw as RawSwipeBinary).id),
  )
  const targetFlipCount = Math.round(swipeBinaryFiles.length * TARGET_LEFT_RATIO)
  const flipIds = new Set(
    sortedByHash.slice(0, targetFlipCount).map((f) => (f.raw as RawSwipeBinary).id),
  )

  const sideReferenceWarnings: string[] = []
  let flippedCount = 0
  let rightCount = 0

  for (const { filePath, raw } of swipeBinaryFiles) {
    const puzzle = raw as RawSwipeBinary

    if (flipIds.has(puzzle.id)) {
      const { left_label, right_label, correct_direction } = puzzle
      puzzle.left_label = right_label
      puzzle.right_label = left_label
      puzzle.correct_direction = correct_direction === 'right' ? 'left' : 'right'
      flippedCount++

      for (const field of ['explanation', 'prompt'] as const) {
        if (SIDE_REFERENCE_PATTERN.test(puzzle[field])) {
          sideReferenceWarnings.push(`${filePath} (${field}): "${puzzle[field]}"`)
        }
      }

      writeFileSync(filePath, JSON.stringify(puzzle, null, 2) + '\n', 'utf-8')
    }

    if (puzzle.correct_direction === 'right') rightCount++
  }

  const total = swipeBinaryFiles.length
  const leftCount = total - rightCount
  console.log(
    `rebalanceSwipeDirection: flipped ${String(flippedCount)} of ${String(total)} swipe-binary puzzles. ` +
      `New split: right=${String(rightCount)} (${((rightCount / total) * 100).toFixed(1)}%), ` +
      `left=${String(leftCount)} (${((leftCount / total) * 100).toFixed(1)}%).`,
  )

  if (sideReferenceWarnings.length > 0) {
    console.warn(
      '\nrebalanceSwipeDirection: possible side references found in flipped puzzles — review and fix by hand:',
    )
    for (const warning of sideReferenceWarnings) {
      console.warn(`  - ${warning}`)
    }
  }
}

main()
