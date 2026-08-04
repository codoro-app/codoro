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
const INTERACTION_TYPES = ['mcq', 'swipe-binary', 'tap-line', 'drag-order', 'scrubber'] as const

/**
 * Phase 6 v2 DoD language targets over the quiz library (scrubber excluded),
 * as % of quiz puzzles. See docs/v2-build-plan.md §Phase 6 item 4 — v1 shipped
 * JS-heavy; the plan locks 40/25/25/10 with ±10pt tolerance, so the report
 * flags any language that has drifted out of band while authoring.
 */
const LANGUAGE_ORDER = ['javascript', 'python', 'java', 'c'] as const
const LANGUAGE_TARGETS: Record<(typeof LANGUAGE_ORDER)[number], number> = {
  javascript: 40,
  python: 25,
  java: 25,
  c: 10,
}
const LANGUAGE_TOLERANCE_POINTS = 10

/** Phase 8 DoD: every pattern's difficulty ratings must span at least this many points. */
const MIN_PATTERN_SPREAD = 800
/**
 * Anti-anchoring clustering check (docs/prompts/claude_code_prompt_v2_phase4.md,
 * decision 8 / Item 5): v1 clustered most of 104 puzzles at exactly
 * 1000/1600/1700/1900 — the difficulty rubric is the actual fix (forcing a
 * non-round S/T/D/C sum), this is a visibility check that the rubric is
 * working. Advisory only in Phase 4 (the plan's own explicit call: at a
 * staged 10-puzzle pilot, two puzzles sharing a rating is already 20% and
 * would block a run for a non-defect) — becomes a hard Phase 6 DoD gate.
 */
const CLUSTERING_WARNING_THRESHOLD = 0.15
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

/** Advisory (Phase 4) anti-anchoring check: any single exact difficulty_rating value used by more than CLUSTERING_WARNING_THRESHOLD of the pool. */
function printClusteringWarning(puzzles: readonly Puzzle[]): void {
  if (puzzles.length === 0) return

  const counts = new Map<number, number>()
  for (const puzzle of puzzles) {
    counts.set(puzzle.difficulty_rating, (counts.get(puzzle.difficulty_rating) ?? 0) + 1)
  }

  const clustered = [...counts.entries()]
    .map(([rating, count]) => ({ rating, count, share: count / puzzles.length }))
    .filter((entry) => entry.share > CLUSTERING_WARNING_THRESHOLD)
    .sort((a, b) => b.share - a.share)

  if (clustered.length === 0) {
    console.log(
      `\nNo difficulty_rating value used by more than ${String(CLUSTERING_WARNING_THRESHOLD * 100)}% of the pool.`,
    )
    return
  }

  console.log(
    `\nADVISORY (anti-anchoring, Phase 4 — becomes a hard gate in Phase 6): difficulty_rating clustering above ${String(CLUSTERING_WARNING_THRESHOLD * 100)}% of the pool (${String(puzzles.length)} puzzles):`,
  )
  for (const { rating, count, share } of clustered) {
    console.log(`  ${String(rating)}: ${String(count)} puzzle(s) (${(share * 100).toFixed(1)}%)`)
  }
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

/** Phase 6 DoD language mix over quiz puzzles (scrubber excluded) vs the 40/25/25/10 target, ±10pt. */
function printLanguageMix(puzzles: readonly Puzzle[]): void {
  const quiz = puzzles.filter((p) => p.interaction !== 'scrubber')
  if (quiz.length === 0) return

  const counts = countBy(quiz, (p) => p.language)
  console.log('\nLanguage mix (quiz only) vs Phase 6 target 40/25/25/10 JS/Py/Java/C ±10pt')
  let anyFail = false
  for (const lang of LANGUAGE_ORDER) {
    const count = counts.get(lang) ?? 0
    const share = (count / quiz.length) * 100
    const target = LANGUAGE_TARGETS[lang]
    const off = share - target
    const fail = Math.abs(off) > LANGUAGE_TOLERANCE_POINTS
    if (fail) anyFail = true
    console.log(
      `  ${lang.padEnd(24)} ${String(count).padStart(3)}  ${share.toFixed(1).padStart(5)}%  target ${String(target)}%` +
        (fail
          ? `  FAIL (${off > 0 ? '+' : ''}${off.toFixed(1)}pt off target)`
          : off > 0
            ? `  (+${off.toFixed(1)}pt over)`
            : `  (${off.toFixed(1)}pt under)`),
    )
  }
  console.log(
    anyFail
      ? '\n  FAIL: one or more languages are outside the ±10pt target band.'
      : '\n  OK: every language is within the ±10pt target band.',
  )
}

/**
 * Phase 6 DoD interaction mix. Report-only here: the two thresholds — ≤⅓ of
 * NEW quiz plain mcq, and scrubber+drag-order ≥⅓ of NEW content — are
 * new-content-delta checks that can't be judged on the full library state, so
 * this prints the current library picture as orientation while authoring.
 * The delta gate itself lives in validate:content (Phase 6, Stage 3 wiring).
 */
function printInteractionMix(puzzles: readonly Puzzle[]): void {
  const quiz = puzzles.filter((p) => p.interaction !== 'scrubber')
  const mcqShare =
    quiz.length > 0 ? quiz.filter((p) => p.interaction === 'mcq').length / quiz.length : 0
  const interactiveShare =
    puzzles.length > 0
      ? puzzles.filter((p) => p.interaction === 'scrubber' || p.interaction === 'drag-order')
          .length / puzzles.length
      : 0
  console.log('\nInteraction mix (report-only; new-content delta hard-gated in validate:content)')
  console.log(`  quiz is ${(mcqShare * 100).toFixed(1)}% plain mcq (new-content target: ≤⅓)`)
  console.log(
    `  scrubber + drag-order is ${(interactiveShare * 100).toFixed(1)}% of all content (new-content target: ≥⅓)`,
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
  printClusteringWarning(puzzles)
  printLanguageMix(puzzles)
  printInteractionMix(puzzles)
}

main()
