/**
 * `pnpm generate:puzzles` — LLM-assisted puzzle authoring pipeline. Per puzzle:
 * generate (structured output against PuzzleSchema) -> validate (PuzzleSchema,
 * catches what JSON Schema can't express, e.g. correct_choice/correct_line
 * range checks) -> self-review (a second, independently-framed API call
 * checking correctness the schema can't) -> write.
 *
 * Retry limits are real limits, not aspirational: MAX_GENERATION_ATTEMPTS
 * bounds the generate/validate loop, and a self-review fail discards the
 * puzzle outright rather than looping — a puzzle whose own correctness is in
 * doubt gets regenerated from scratch, not patched.
 *
 * Authoring-time only: never imported by app code, never bundled. See
 * ../GENERATING_PUZZLES.md for usage, budget notes, and what to do when a
 * puzzle is discarded.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import {
  MAX_DIFFICULTY,
  McqSchema,
  MIN_DIFFICULTY,
  PuzzleSchema,
  SwipeBinarySchema,
  TapLineSchema,
} from '../schema'
import type { Puzzle } from '../schema'
import { PATTERN_LABELS, PATTERN_SLUGS } from '../patterns'
import type { PatternSlug } from '../patterns'
import { loadRawPuzzleFiles } from './loadPuzzles'
import { validatePuzzleFiles } from './validatePuzzles'

const MODEL = 'claude-sonnet-5'
// Intro pricing through 2026-08-31 (standard rate is $3/$15 after) — confirm
// at https://platform.claude.com/docs/en/about-claude/pricing before trusting
// this for a budget decision months from now.
const INPUT_COST_PER_MTOK = 2
const OUTPUT_COST_PER_MTOK = 10
const MAX_GENERATION_ATTEMPTS = 3

/** Hard stop on batch spend, checked before every puzzle in main()'s loop. */
const COST_CEILING_USD = 0.7

type Interaction = 'mcq' | 'swipe-binary' | 'tap-line'
/** Which edge of a puzzle's targetRange to lean toward — see buildGapManifest. */
type Bias = 'low' | 'mid' | 'high'

/**
 * Structured output is requested per-variant, not against PuzzleSchema's
 * discriminated union — Claude's structured-output API rejects the $defs
 * shape zodOutputFormat produces for a discriminated union ("For 'anyOf',
 * '$defs' is not supported"). The target interaction is already known
 * before each call, so a flat per-variant schema is all that's needed here;
 * PuzzleSchema (union + superRefine) is still the authoritative validation
 * applied to the result below.
 */
const INTERACTION_SCHEMAS = {
  mcq: McqSchema,
  'swipe-binary': SwipeBinarySchema,
  'tap-line': TapLineSchema,
} as const

/** Short, stable per-pattern id prefix. Once assigned, never change — ids are forever. */
const PATTERN_PREFIXES: Record<PatternSlug, string> = {
  'off-by-one': 'oob',
  'null-undefined': 'nul',
  'type-coercion': 'tc',
  'mutable-state': 'mut',
  'scope-closures': 'scl',
  concurrency: 'con',
  'resource-management': 'res',
  'error-handling': 'err',
  'recursion-termination': 'rec',
  'data-structure-misuse': 'dsm',
  'string-formatting': 'str',
  'input-validation': 'inp',
  'control-flow': 'cf',
}

const CONTENT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const PUZZLES_DIR = join(CONTENT_DIR, 'puzzles')
const CALIBRATION = readFileSync(join(CONTENT_DIR, 'CALIBRATION.md'), 'utf-8')

const client = new Anthropic()

const ReviewSchema = z.object({
  pass: z.boolean(),
  reason: z.string().min(1),
})

const totals = { inputTokens: 0, outputTokens: 0 }

function costOf(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens / 1_000_000) * INPUT_COST_PER_MTOK +
    (outputTokens / 1_000_000) * OUTPUT_COST_PER_MTOK
  )
}

function logUsage(label: string, usage: { input_tokens: number; output_tokens: number }): void {
  totals.inputTokens += usage.input_tokens
  totals.outputTokens += usage.output_tokens
  console.log(
    `    [${label}] in=${String(usage.input_tokens)} out=${String(usage.output_tokens)} — running total: $${costOf(totals.inputTokens, totals.outputTokens).toFixed(4)}`,
  )
}

const FEW_SHOT_EXAMPLES: Puzzle[] = [
  {
    id: 'oob-000',
    pattern: 'off-by-one',
    difficulty_rating: 1000,
    explanation:
      '`i <= n` runs one iteration past the intended range, reading `arr[n]` which is out of bounds for a length-n array. It should be `i < n`.',
    prompt: "What's wrong with this loop?",
    language: 'javascript',
    snippet:
      'function sumFirstN(arr, n) {\n  let sum = 0\n  for (let i = 0; i <= n; i++) {\n    sum += arr[i]\n  }\n  return sum\n}',
    interaction: 'mcq',
    choices: [
      'The loop condition `i <= n` reads one element past the intended range',
      'The function is missing a return statement',
      '`sum` should be initialized to 1, not 0',
      'The parameters should be in the order `(n, arr)`',
    ],
    correct_choice: 0,
  },
  {
    id: 'mut-000',
    pattern: 'mutable-state',
    difficulty_rating: 1700,
    explanation:
      'Python evaluates a default argument value once, at function-definition time, not on every call. `basket=[]` creates a single list object that every call omitting the argument shares and mutates, so state leaks between calls that look independent.',
    prompt: 'Tap the line that causes a hidden bug.',
    language: 'python',
    snippet: 'def add_item(item, basket=[]):\n    basket.append(item)\n    return basket',
    interaction: 'tap-line',
    correct_line: 0,
  },
  {
    id: 'con-000',
    pattern: 'concurrency',
    difficulty_rating: 2275,
    explanation:
      "Between the two `await`s, a second concurrent request can read `seat.available` as true before the first request's `bookSeat` call commits, so both requests can book the same seat — there's no atomic check-and-set. Rated above the base S/T/D/C formula because swipe-binary carries a 50% guess floor; the +150-200 modifier keeps the Elo signal meaningful.",
    prompt: 'Is this seat-booking function safe under concurrent requests?',
    language: 'javascript',
    snippet:
      'async function reserveSeat(seatId) {\n  const seat = await db.getSeat(seatId)\n  if (seat.available) {\n    await db.bookSeat(seatId, currentUser)\n  }\n}',
    interaction: 'swipe-binary',
    left_label: 'Safe',
    right_label: 'Race condition',
    correct_direction: 'right',
  },
  {
    id: 'nul-000',
    pattern: 'null-undefined',
    difficulty_rating: 1300,
    explanation:
      '`user.address` is not guaranteed to exist — if a user record has no address on file, `user.address` is `undefined`, and reading `.city` off it throws a TypeError. The function needs an explicit null check (or optional chaining, `user.address?.city`) before accessing a nested property that might not be there.',
    prompt: 'Is this safe if a user has no address on file?',
    language: 'javascript',
    snippet: 'function getUserCity(user) {\n  return user.address.city\n}',
    interaction: 'swipe-binary',
    left_label: 'Throws on a missing address',
    right_label: 'Safe',
    correct_direction: 'left',
  },
]

function buildSystemPrompt(): string {
  return `You are authoring puzzles for Codoro, a "spot the bug" trivia app for
working software engineers. Each puzzle shows a short code snippet with
exactly one real bug and asks the player to find it, via one of three
interaction types: "mcq" (pick the right explanation from 2-5 choices),
"swipe-binary" (flick left/right between two labels, e.g. "Safe" vs "Buggy"),
or "tap-line" (tap the buggy line in the snippet).

Follow this difficulty-calibration rubric exactly when setting
difficulty_rating:

${CALIBRATION}

Here are four worked examples of correctly-shaped puzzle JSON: one "mcq",
one "tap-line", and two "swipe-binary" ones deliberately showing BOTH
possible correct_direction values — notice the second swipe-binary example
puts the buggy label on the left and "Safe" on the right, the mirror image
of the first. That pairing is intentional (see the swipe-binary requirement
below), not a preference for one layout over the other (ids are placeholders
— you will be told the real id to use):

${FEW_SHOT_EXAMPLES.map((p) => JSON.stringify(p, null, 2)).join('\n\n')}

Requirements for every puzzle you generate:
- The bug must be real, unambiguous, and actually present in the snippet as
  described by "explanation".
- "explanation" must be technically correct and specific to this snippet —
  not a generic description of the bug category.
- For "mcq": wrong choices must be plausible but definitively wrong, not
  arguably-also-correct or near-duplicates of the right answer.
- For "swipe-binary": the wrong side must be a real, temptingly-plausible
  alternative, not a strawman. Separately, and just as important:
  correct_direction must be chosen independently for THIS puzzle, based only
  on which side you happen to write the buggy label on — never out of habit
  or because a prior puzzle in this session used the same side. Across a
  batch of puzzles, correct_direction is expected to land near 50/50 between
  "left" and "right"; a batch that skews heavily toward one side turns
  swipe-binary into a free guess for anyone who swipes that side without
  reading, which defeats the puzzle. Flip a mental coin per puzzle rather
  than defaulting to whichever side felt natural to write first.
- For "tap-line": correct_line is a 0-based index into the snippet's lines.
- "id" must be lowercase kebab-case matching the exact id you are given —
  do not invent your own id.
- "language" is the snippet's real language (e.g. "javascript", "python",
  "java", "c").
- Compute difficulty_rating by actually scoring S/T/D/C per the rubric for
  THIS specific puzzle, not by guessing a round number for the target band.
  Before writing the final JSON, work through this explicitly: state S, T,
  D, and C as numbers 1-5, sum them, and apply
  rating = 800 + (sum - 4) * 100.
- If interaction is "swipe-binary": this is the single most commonly missed
  step, so do it explicitly and do not skip it — AFTER computing the base
  rating from the formula above, add a further flat +150 to +200 on top of
  it. The base-formula number alone is NOT the final difficulty_rating for
  a swipe-binary puzzle; the modifier is mandatory, not optional, and it is
  added on top of, not instead of, the base rating.`
}

interface GenerateArgs {
  id: string
  pattern: PatternSlug
  interaction: Interaction
  targetRange: string
  bias: Bias
}

/**
 * A numeric target alone isn't enough — the model tends to reach for a
 * pattern's "default" bug shape (e.g. concurrency bugs are inherently hard
 * to trace and highly context-dependent; error-handling bugs are often
 * blatant) and then self-report whatever S/T/D/C sum reaches the target,
 * rather than picking content that genuinely scores there. This computes an
 * explicit S/T/D/C sum target from the range/bias and pairs it with a
 * content-shaping instruction, so the puzzle's actual complexity — not just
 * its self-reported score — lands where it needs to.
 */
function difficultyGuidance(args: GenerateArgs): string {
  const [rangeFloor, rangeCeil] = args.targetRange.split('-').map(Number)
  const floor = rangeFloor ?? MIN_DIFFICULTY
  const ceil = rangeCeil ?? MAX_DIFFICULTY
  const nearPoint =
    args.bias === 'low'
      ? floor + 50
      : args.bias === 'high'
        ? ceil - 50
        : Math.round((floor + ceil) / 2)
  const swipeModifier = args.interaction === 'swipe-binary' ? 175 : 0
  const baseTarget = nearPoint - swipeModifier
  const sumTarget = Math.min(20, Math.max(4, Math.round((baseTarget - 800) / 100) + 4))

  const shapingHint =
    args.bias === 'low'
      ? `Pick the most blatant, single-step, context-independent version of this pattern's bug you can think of. Avoid multi-step tracing, hidden or interleaved state, or a subtle distractor — even if this pattern's bugs typically lean harder than that. A puzzle that feels "too easy" for this pattern is exactly the point of this one.`
      : args.bias === 'high'
        ? `Pick a version of this pattern's bug that requires tracing state across multiple steps (or multiple awaits/branches), that only manifests under a specific or narrow condition, and where the wrong answer is genuinely tempting — push for the hardest reasonable variant of this pattern's bug, even if this pattern's bugs typically lean simpler than that.`
        : `Pick a typical, moderate-difficulty example of this pattern's bug.`

  const modifierLine =
    swipeModifier > 0
      ? `Because interaction is "swipe-binary", the mandatory modifier applies: compute a BASE rating around ${String(baseTarget)} from S/T/D/C (sum ≈ ${String(sumTarget)}), then ADD +150 to +200 on top of that base to get the FINAL difficulty_rating you put in the JSON. The final number must come out noticeably higher than the base number — do not report the base (pre-modifier) number as difficulty_rating; that is the single most common mistake on this puzzle type.`
      : `Aim for S+T+D+C summing to approximately ${String(sumTarget)} (each sub-score 1-5) so the computed difficulty_rating lands in the target range.`

  return (
    `- target difficulty range: ${args.targetRange} (this is what the FINAL difficulty_rating field should land in). ${shapingHint}\n` +
    `- ${modifierLine} Pick content that genuinely scores at this level under the rubric — do not pick a harder or easier bug and then self-report a number that doesn't match what you actually wrote.`
  )
}

function buildUserPrompt(args: GenerateArgs, priorError: string | null): string {
  const lines = [
    `Generate one puzzle with these exact parameters:`,
    `- id: "${args.id}"`,
    `- pattern: "${args.pattern}" (${PATTERN_LABELS[args.pattern]})`,
    `- interaction: "${args.interaction}"`,
    difficultyGuidance(args),
  ]
  if (priorError) {
    lines.push(
      '',
      'Your previous attempt failed validation with this error — fix the specific problem and return a complete, corrected puzzle:',
      priorError,
    )
  }
  return lines.join('\n')
}

async function generatePuzzle(args: GenerateArgs): Promise<Puzzle | null> {
  let lastError: string | null = null

  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
    let parsed: unknown
    try {
      const response = await client.messages.parse({
        model: MODEL,
        // Sonnet 5 defaults to adaptive thinking when `thinking` is
        // omitted, and thinking tokens draw from this same budget — a
        // tight cap here truncates mid-generation (seen in testing at
        // max_tokens: 4096, several calls hit the cap exactly and failed
        // to parse). This is a ceiling, not a target — extra headroom
        // costs nothing unless the model actually uses it.
        max_tokens: 8192,
        system: [{ type: 'text', text: buildSystemPrompt(), cache_control: { type: 'ephemeral' } }],
        output_config: { format: zodOutputFormat(INTERACTION_SCHEMAS[args.interaction]) },
        messages: [{ role: 'user', content: buildUserPrompt(args, lastError) }],
      })
      logUsage(`generate ${args.id} attempt ${String(attempt)}`, response.usage)
      parsed = response.parsed_output
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      console.warn(`    generate ${args.id} attempt ${String(attempt)} threw: ${lastError}`)
      continue
    }

    if (parsed === null) {
      lastError = 'Model output did not conform to the requested JSON shape.'
      continue
    }

    // Always own the id ourselves — never trust the model to avoid collisions.
    const candidate = { ...(parsed as Record<string, unknown>), id: args.id }
    const result = PuzzleSchema.safeParse(candidate)
    if (!result.success) {
      lastError = result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')
      console.warn(
        `    generate ${args.id} attempt ${String(attempt)} failed validation: ${lastError}`,
      )
      continue
    }

    return result.data
  }

  console.warn(
    `  DISCARDED ${args.id}: exceeded ${String(MAX_GENERATION_ATTEMPTS)} generation attempts. Last error: ${lastError ?? 'unknown'}`,
  )
  return null
}

function buildReviewSystemPrompt(): string {
  return `You are an independent reviewer for Codoro puzzle content. You did
not write the puzzle you're about to review — approach it skeptically. Your
job is to catch what schema validation cannot:

1. Is the claimed bug actually present in the snippet, exactly as the
   explanation describes it?
2. Is the explanation technically correct, with no factual errors?
3. For "mcq": are the wrong choices genuinely wrong — not arguably correct,
   not trivial near-duplicates of the right answer?
4. For "swipe-binary": is correct_direction actually correct, and is the
   wrong side a real, temptingly-plausible alternative rather than an
   obvious strawman?
5. For "tap-line": does correct_line actually point at the line containing
   the bug (not an adjacent line, not the call site)? correct_line is a
   0-based index into the snippet's lines — the FIRST line is index 0, not
   1. When you count lines to check this, count from 0. A puzzle is only
   miscalibrated on this point if it's wrong under 0-based counting; do not
   fail it for being "off by one" if the mismatch only appears when you
   count from 1.
6. Does difficulty_rating roughly match what applying this rubric to this
   specific puzzle would produce?

${CALIBRATION}

Return pass=true only if every check above holds. If you have real doubt on
any point, fail with a specific, actionable reason — don't rubber-stamp.`
}

async function selfReview(puzzle: Puzzle): Promise<{ pass: boolean; reason: string }> {
  try {
    const response = await client.messages.parse({
      model: MODEL,
      // Sonnet 5 defaults to adaptive thinking when `thinking` is omitted,
      // and thinking tokens draw from this same budget — too tight a limit
      // here truncates the JSON response before it completes (seen in
      // testing: several review calls hit exactly max_tokens and produced
      // unparseable output, even at 4096). Match generation's headroom.
      max_tokens: 8192,
      system: [
        { type: 'text', text: buildReviewSystemPrompt(), cache_control: { type: 'ephemeral' } },
      ],
      output_config: { format: zodOutputFormat(ReviewSchema) },
      messages: [
        { role: 'user', content: `Review this puzzle:\n\n${JSON.stringify(puzzle, null, 2)}` },
      ],
    })
    logUsage(`review ${puzzle.id}`, response.usage)

    if (response.parsed_output === null) {
      return { pass: false, reason: 'Review response did not conform to the requested JSON shape.' }
    }
    return response.parsed_output
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { pass: false, reason: `Review API call failed: ${message}` }
  }
}

function loadExistingCounters(): Map<string, number> {
  const counters = new Map<string, number>()
  for (const { raw } of loadRawPuzzleFiles()) {
    if (raw && typeof raw === 'object' && 'id' in raw && typeof raw.id === 'string') {
      const match = /^([a-z]+)-(\d+)$/.exec(raw.id)
      if (match?.[1] !== undefined && match[2] !== undefined) {
        const prefix = match[1]
        counters.set(prefix, Math.max(counters.get(prefix) ?? 0, Number(match[2])))
      }
    }
  }
  return counters
}

/** Returns the next id without consuming it — call commitId() only after a successful write. */
function peekNextId(pattern: PatternSlug, counters: Map<string, number>): string {
  const prefix = PATTERN_PREFIXES[pattern]
  const next = (counters.get(prefix) ?? 0) + 1
  return `${prefix}-${String(next).padStart(3, '0')}`
}

function commitId(pattern: PatternSlug, id: string, counters: Map<string, number>): void {
  const prefix = PATTERN_PREFIXES[pattern]
  const num = Number(id.slice(prefix.length + 1))
  counters.set(prefix, Math.max(counters.get(prefix) ?? 0, num))
}

function writePuzzle(puzzle: Puzzle): void {
  const dir = join(PUZZLES_DIR, puzzle.pattern)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${puzzle.id}.json`), JSON.stringify(puzzle, null, 2) + '\n', 'utf-8')
}

interface PuzzleSpec {
  pattern: PatternSlug
  interaction: Interaction
  targetRange: string
  bias: Bias
}

/** Phase 8 DoD: every pattern's difficulty ratings must span at least this many points. */
const MIN_PATTERN_SPREAD = 800
const BUCKET_SIZE = 200
/**
 * Highest bucket start the dead-zone sweep checks. Bucket 2000-2199 is the
 * last one included, covering the DoD's "no empty 200pt bucket ~900-2150"
 * — matches contentStats.ts's own dead-zone check range.
 */
const MAX_DEAD_ZONE_BUCKET_START = 2000

/** Mirrors contentStats.ts's difficultyBucketLabel — same bucket math, kept local to avoid a shared module for one five-line function. */
function bucketLabel(rating: number): string {
  const bucketStart =
    Math.floor((rating - MIN_DIFFICULTY) / BUCKET_SIZE) * BUCKET_SIZE + MIN_DIFFICULTY
  const bucketEnd = Math.min(bucketStart + BUCKET_SIZE - 1, MAX_DIFFICULTY)
  return `${String(bucketStart)}-${String(bucketEnd)}`
}

function loadValidPuzzles(): Puzzle[] {
  return validatePuzzleFiles(loadRawPuzzleFiles()).valid.map((entry) => entry.puzzle)
}

const INTERACTION_CYCLE: Interaction[] = ['swipe-binary', 'mcq', 'tap-line', 'swipe-binary', 'mcq']

function nextInteraction(cursor: number): Interaction {
  return INTERACTION_CYCLE[cursor % INTERACTION_CYCLE.length] ?? 'mcq'
}

/**
 * Gap-driven manifest: reads real per-pattern difficulty spread and global
 * 200pt bucket coverage off disk (loadValidPuzzles — same validated source
 * contentStats.ts reports on) and generates only the minimum needed to
 * satisfy the Phase 8 DoD — every pattern spans >= MIN_PATTERN_SPREAD, and
 * no global bucket between MIN_DIFFICULTY and MAX_DEAD_ZONE_BUCKET_START is
 * empty. Idempotent: a pattern or bucket already satisfied contributes
 * nothing, so a rerun after the curve is covered returns [].
 *
 * Two puzzles per deficient pattern (not one) — enough to survive a single
 * self-review discard and to satisfy "at least 2 puzzles" at the needed
 * end. Each fix targets whichever end (low/high) still leaves an empty
 * global bucket uncovered, so one puzzle can close both the pattern's
 * spread gap and the global dead zone at once; a puzzle's bias (see Bias)
 * pushes the model toward the far edge of its target bucket so the actual
 * computed rating doesn't just barely clear MIN_PATTERN_SPREAD.
 */
function buildGapManifest(): PuzzleSpec[] {
  const puzzles = loadValidPuzzles()

  const byPattern = new Map<PatternSlug, number[]>()
  for (const pattern of PATTERN_SLUGS) byPattern.set(pattern, [])
  const coveredBuckets = new Set<string>()
  for (const puzzle of puzzles) {
    byPattern.get(puzzle.pattern)?.push(puzzle.difficulty_rating)
    coveredBuckets.add(bucketLabel(puzzle.difficulty_rating))
  }

  const specs: PuzzleSpec[] = []
  let cursor = 0

  const deficient = PATTERN_SLUGS.map((pattern) => {
    const ratings = byPattern.get(pattern) ?? []
    const min = ratings.length > 0 ? Math.min(...ratings) : MIN_DIFFICULTY
    const max = ratings.length > 0 ? Math.max(...ratings) : MIN_DIFFICULTY
    return { pattern, min, max, range: max - min }
  })
    .filter((p) => p.range < MIN_PATTERN_SPREAD)
    .sort((a, b) => a.range - b.range)

  for (const { pattern, min, max } of deficient) {
    const lowTarget = Math.max(MIN_DIFFICULTY, max - MIN_PATTERN_SPREAD)
    const highTarget = Math.min(MAX_DIFFICULTY, min + MIN_PATTERN_SPREAD)
    const lowBucket = bucketLabel(lowTarget)
    const highBucket = bucketLabel(highTarget)
    const lowFillsGap = !coveredBuckets.has(lowBucket)
    const highFillsGap = !coveredBuckets.has(highBucket)

    // Prefer whichever direction also empties a still-open global bucket.
    // If both or neither do, extend whichever end has more room — the one
    // further from its floor/ceiling — since that's the side the pattern's
    // existing ratings are clustered away from.
    const direction: 'low' | 'high' =
      lowFillsGap && !highFillsGap
        ? 'low'
        : highFillsGap && !lowFillsGap
          ? 'high'
          : min - MIN_DIFFICULTY > MAX_DIFFICULTY - max
            ? 'low'
            : 'high'

    const targetRange = direction === 'low' ? lowBucket : highBucket
    coveredBuckets.add(targetRange)

    for (let i = 0; i < 2; i++) {
      specs.push({ pattern, interaction: nextInteraction(cursor), targetRange, bias: direction })
      cursor++
    }
  }

  for (let start = MIN_DIFFICULTY; start <= MAX_DEAD_ZONE_BUCKET_START; start += BUCKET_SIZE) {
    const bucket = bucketLabel(start)
    if (coveredBuckets.has(bucket)) continue

    // No deficient pattern claimed this bucket — assign it to whichever
    // pattern has the most spread headroom, so one more puzzle can't push
    // it back under MIN_PATTERN_SPREAD.
    const widest = PATTERN_SLUGS.map((pattern) => {
      const ratings = byPattern.get(pattern) ?? []
      const range = ratings.length > 0 ? Math.max(...ratings) - Math.min(...ratings) : 0
      return { pattern, range }
    }).sort((a, b) => b.range - a.range)[0]
    if (!widest) continue

    specs.push({
      pattern: widest.pattern,
      interaction: nextInteraction(cursor),
      targetRange: bucket,
      bias: 'mid',
    })
    coveredBuckets.add(bucket)
    cursor++
  }

  return specs
}

const EST_GENERATE_INPUT_TOKENS = 4200
const EST_GENERATE_OUTPUT_TOKENS = 700
const EST_REVIEW_INPUT_TOKENS = 3600
const EST_REVIEW_OUTPUT_TOKENS = 250
/**
 * Conservative per-puzzle cost projection for --dry-run, derived from the
 * `in=3812 out=612` generate-call example in GENERATING_PUZZLES.md, rounded
 * up, plus an estimated review call, plus a 25% buffer for the occasional
 * validation retry — real batches don't hit max_tokens (8192) in practice.
 */
const PROJECTED_COST_PER_PUZZLE =
  (costOf(EST_GENERATE_INPUT_TOKENS, EST_GENERATE_OUTPUT_TOKENS) +
    costOf(EST_REVIEW_INPUT_TOKENS, EST_REVIEW_OUTPUT_TOKENS)) *
  1.25

/** Parses --limit=N off argv, for testing a prompt change on a few puzzles before spending on the full manifest. */
function parseLimitArg(): number | null {
  const arg = process.argv.find((a) => a.startsWith('--limit='))
  if (!arg) return null
  const value = Number(arg.slice('--limit='.length))
  return Number.isInteger(value) && value > 0 ? value : null
}

async function main(): Promise<void> {
  const isDryRun = process.argv.includes('--dry-run')
  const limit = parseLimitArg()
  const fullManifest = buildGapManifest()
  const manifest = limit !== null ? fullManifest.slice(0, limit) : fullManifest
  const counters = loadExistingCounters()

  if (fullManifest.length === 0) {
    console.log(
      'generate:puzzles: curve already covered — every pattern spans >= 800 points and no 200pt bucket between 800 and 2199 is empty. Nothing to generate.',
    )
    return
  }

  const projectedCost = manifest.length * PROJECTED_COST_PER_PUZZLE

  console.log(
    `generate:puzzles: ${isDryRun ? 'DRY RUN' : 'FULL BATCH'} — ${String(manifest.length)} puzzle(s) targeted (gap-driven)` +
      (limit !== null ? ` [--limit=${String(limit)} of ${String(fullManifest.length)}]` : '') +
      '\n',
  )
  for (const spec of manifest) {
    console.log(
      `  - ${spec.pattern} / ${spec.interaction} / target ${spec.targetRange} (bias: ${spec.bias})`,
    )
  }
  console.log(
    `\nProjected cost: ~$${projectedCost.toFixed(4)} (${String(manifest.length)} puzzle(s) x ~$${PROJECTED_COST_PER_PUZZLE.toFixed(4)}/puzzle, conservative estimate)`,
  )
  if (projectedCost > COST_CEILING_USD) {
    console.warn(
      `  WARNING: projected cost exceeds COST_CEILING_USD ($${COST_CEILING_USD.toFixed(2)}) — shrink the manifest before running for real.`,
    )
  }

  if (isDryRun) {
    return
  }

  let written = 0
  let discarded = 0

  for (const spec of manifest) {
    const currentCost = costOf(totals.inputTokens, totals.outputTokens)
    if (currentCost >= COST_CEILING_USD) {
      console.warn(
        `\ngenerate:puzzles: COST_CEILING_USD ($${COST_CEILING_USD.toFixed(2)}) reached at $${currentCost.toFixed(4)} — stopping before the next puzzle. ${String(manifest.length - written - discarded)} puzzle(s) left un-attempted.`,
      )
      break
    }

    const id = peekNextId(spec.pattern, counters)
    console.log(`=== ${id} (${spec.pattern}, ${spec.interaction}, target ${spec.targetRange}) ===`)

    const puzzle = await generatePuzzle({ ...spec, id })
    if (!puzzle) {
      discarded++
      continue
    }

    const review = await selfReview(puzzle)
    if (!review.pass) {
      console.warn(`  DISCARDED ${id}: self-review failed — ${review.reason}`)
      discarded++
      continue
    }

    writePuzzle(puzzle)
    commitId(spec.pattern, id, counters)
    written++
    console.log(`  WROTE ${id}`)
  }

  const totalCost = costOf(totals.inputTokens, totals.outputTokens)
  console.log(
    `\ngenerate:puzzles: ${String(written)} written, ${String(discarded)} discarded. ` +
      `Total: in=${String(totals.inputTokens)} out=${String(totals.outputTokens)} tokens, ~$${totalCost.toFixed(4)}.`,
  )

  if (written === 0 && manifest.length > 0) {
    process.exitCode = 1
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
