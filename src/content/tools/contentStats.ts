/**
 * `pnpm content:stats` — coverage report over src/content/puzzles/: counts
 * per pattern, a difficulty histogram, and per-interaction-type counts, so
 * gaps are visible while authoring. Not CI-gated (validate:content is the
 * gate); this is a developer-facing report only.
 */
import { PATTERN_SLUGS } from '../patterns'
import { MAX_DIFFICULTY, MIN_DIFFICULTY } from '../schema'
import type { Puzzle } from '../schema'
import { loadRawPuzzleFiles } from './loadPuzzles'
import { validatePuzzleFiles } from './validatePuzzles'

const BUCKET_SIZE = 200
const INTERACTION_TYPES = ['mcq', 'swipe-binary', 'tap-line'] as const

function difficultyBucketLabel(rating: number): string {
  const bucketStart =
    Math.floor((rating - MIN_DIFFICULTY) / BUCKET_SIZE) * BUCKET_SIZE + MIN_DIFFICULTY
  const bucketEnd = Math.min(bucketStart + BUCKET_SIZE - 1, MAX_DIFFICULTY)
  return `${String(bucketStart)}-${String(bucketEnd)}`
}

function countBy<T extends string>(
  puzzles: readonly Puzzle[],
  key: (puzzle: Puzzle) => T,
): Map<T, number> {
  const counts = new Map<T, number>()
  for (const puzzle of puzzles) {
    const bucket = key(puzzle)
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1)
  }
  return counts
}

function printCounts(title: string, counts: Map<string, number>, order?: readonly string[]): void {
  console.log(`\n${title}`)
  const keys = order ?? [...counts.keys()].sort()
  for (const key of keys) {
    console.log(`  ${key.padEnd(24)} ${String(counts.get(key) ?? 0)}`)
  }
}

function main(): void {
  const files = loadRawPuzzleFiles()
  const { valid, errors } = validatePuzzleFiles(files)

  if (errors.length > 0) {
    console.warn(
      `content:stats: ${String(errors.length)} file(s) failed validation and are excluded below — run "pnpm validate:content" for details.`,
    )
  }

  const puzzles = valid.map((entry) => entry.puzzle)
  console.log(`content:stats: ${String(puzzles.length)} valid puzzle(s)`)

  printCounts(
    'By pattern',
    countBy(puzzles, (p) => p.pattern),
    PATTERN_SLUGS,
  )
  printCounts(
    'By interaction type',
    countBy(puzzles, (p) => p.interaction),
    INTERACTION_TYPES,
  )
  printCounts(
    'Difficulty histogram',
    countBy(puzzles, (p) => difficultyBucketLabel(p.difficulty_rating)),
  )
}

main()
