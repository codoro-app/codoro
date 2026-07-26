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

/** Phase 8 DoD: every pattern's difficulty ratings must span at least this many points. */
const MIN_PATTERN_SPREAD = 800
/**
 * Highest bucket start the dead-zone check covers — bucket 2000-2199 is the
 * last one included, matching generatePuzzles.ts's MAX_DEAD_ZONE_BUCKET_START.
 */
const MAX_DEAD_ZONE_BUCKET_START = 2000

function difficultyBucketLabel(rating: number): string {
  const bucketStart =
    Math.floor((rating - MIN_DIFFICULTY) / BUCKET_SIZE) * BUCKET_SIZE + MIN_DIFFICULTY
  const bucketEnd = Math.min(bucketStart + BUCKET_SIZE - 1, MAX_DIFFICULTY)
  return `${String(bucketStart)}-${String(bucketEnd)}`
}

/** Per-pattern min/max/range, flagging any pattern under MIN_PATTERN_SPREAD. */
function printPatternSpread(puzzles: readonly Puzzle[]): void {
  console.log('\nPer-pattern spread (min / max / range)')
  let anyFail = false
  for (const pattern of PATTERN_SLUGS) {
    const ratings = puzzles.filter((p) => p.pattern === pattern).map((p) => p.difficulty_rating)
    if (ratings.length === 0) {
      console.log(`  ${pattern.padEnd(24)} no puzzles`)
      anyFail = true
      continue
    }
    const min = Math.min(...ratings)
    const max = Math.max(...ratings)
    const range = max - min
    const fail = range < MIN_PATTERN_SPREAD
    if (fail) anyFail = true
    console.log(
      `  ${pattern.padEnd(24)} min=${String(min)} max=${String(max)} range=${String(range)}${fail ? '  FAIL (< 800)' : ''}`,
    )
  }
  console.log(
    anyFail
      ? '\n  FAIL: one or more patterns are under the 800-point spread DoD.'
      : '\n  OK: every pattern spans >= 800 points.',
  )
}

/** Empty 200pt global difficulty buckets between MIN_DIFFICULTY and MAX_DEAD_ZONE_BUCKET_START. */
function printEmptyBuckets(puzzles: readonly Puzzle[]): void {
  const occupied = new Set(puzzles.map((p) => difficultyBucketLabel(p.difficulty_rating)))
  const empty: string[] = []
  for (let start = MIN_DIFFICULTY; start <= MAX_DEAD_ZONE_BUCKET_START; start += BUCKET_SIZE) {
    const label = difficultyBucketLabel(start)
    if (!occupied.has(label)) empty.push(label)
  }
  const rangeLabel = `${String(MIN_DIFFICULTY)}-${String(MAX_DEAD_ZONE_BUCKET_START + BUCKET_SIZE - 1)}`
  console.log(
    empty.length > 0
      ? `\nEmpty 200pt buckets (${rangeLabel}): ${empty.join(', ')}`
      : `\nNo empty 200pt buckets between ${rangeLabel}.`,
  )
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

  printPatternSpread(puzzles)
  printEmptyBuckets(puzzles)
}

main()
