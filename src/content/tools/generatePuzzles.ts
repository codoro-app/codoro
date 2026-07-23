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
import { McqSchema, PuzzleSchema, SwipeBinarySchema, TapLineSchema } from '../schema'
import type { Puzzle } from '../schema'
import { PATTERN_LABELS, PATTERN_SLUGS } from '../patterns'
import type { PatternSlug } from '../patterns'
import { loadRawPuzzleFiles } from './loadPuzzles'

const MODEL = 'claude-sonnet-5'
// Intro pricing through 2026-08-31 (standard rate is $3/$15 after) — confirm
// at https://platform.claude.com/docs/en/about-claude/pricing before trusting
// this for a budget decision months from now.
const INPUT_COST_PER_MTOK = 2
const OUTPUT_COST_PER_MTOK = 10
const MAX_GENERATION_ATTEMPTS = 3

type Interaction = 'mcq' | 'swipe-binary' | 'tap-line'
type Band = 'low' | 'mid' | 'high'

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

const BAND_RANGES: Record<Band, string> = {
  low: '900-1100',
  mid: '1500-1700',
  high: '1900-2150',
}

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

Here are three worked examples of correctly-shaped puzzle JSON, one per
interaction type (ids are placeholders — you will be told the real id to
use):

${FEW_SHOT_EXAMPLES.map((p) => JSON.stringify(p, null, 2)).join('\n\n')}

Requirements for every puzzle you generate:
- The bug must be real, unambiguous, and actually present in the snippet as
  described by "explanation".
- "explanation" must be technically correct and specific to this snippet —
  not a generic description of the bug category.
- For "mcq": wrong choices must be plausible but definitively wrong, not
  arguably-also-correct or near-duplicates of the right answer.
- For "swipe-binary": the wrong side must be a real, temptingly-plausible
  alternative, not a strawman.
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
  band: Band
}

function buildUserPrompt(args: GenerateArgs, priorError: string | null): string {
  const lines = [
    `Generate one puzzle with these exact parameters:`,
    `- id: "${args.id}"`,
    `- pattern: "${args.pattern}" (${PATTERN_LABELS[args.pattern]})`,
    `- interaction: "${args.interaction}"`,
    `- target difficulty band: ${BAND_RANGES[args.band]} (compute the real S/T/D/C-derived rating within or near this band; do not just pick the midpoint)`,
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
  band: Band
}

/**
 * Phase 8 convergence target: every pattern >= TARGET_PER_PATTERN puzzles.
 * Dynamic, not a fixed list — reads what's already on disk (via
 * loadRawPuzzleFiles, same source loadExistingCounters uses) and generates
 * exactly the gap for each pattern, so reruns after a partial batch (or
 * after DISCARDED puzzles left some patterns short) top up instead of
 * re-requesting puzzles that already exist.
 *
 * Interaction mix per pattern's gap cycles through the same ~45/35/20
 * swipe-binary/mcq/tap-line sequence buildDryRunManifest's sibling used
 * pre-Phase-8 (11 swipe / 9 mcq / 5 tap-line per 25), continued across
 * pattern boundaries (not reset per pattern) so the mix holds at the
 * batch level even though gap sizes differ per pattern. Bands cycle
 * low/mid/high independently so every pattern's new puzzles still span
 * the full range, regardless of where its gap-count lands in the
 * interaction cycle.
 */
const TARGET_PER_PATTERN = 8

function countExistingByPattern(): Map<PatternSlug, number> {
  const counts = new Map<PatternSlug, number>()
  for (const { raw } of loadRawPuzzleFiles()) {
    if (raw && typeof raw === 'object' && 'pattern' in raw && typeof raw.pattern === 'string') {
      const pattern = raw.pattern as PatternSlug
      counts.set(pattern, (counts.get(pattern) ?? 0) + 1)
    }
  }
  return counts
}

function buildFullManifest(): PuzzleSpec[] {
  const interactionCycle: Interaction[] = [
    'swipe-binary',
    'mcq',
    'swipe-binary',
    'tap-line',
    'mcq',
    'swipe-binary',
    'mcq',
    'swipe-binary',
    'tap-line',
    'mcq',
    'swipe-binary',
    'mcq',
    'swipe-binary',
    'tap-line',
    'mcq',
    'swipe-binary',
    'mcq',
    'swipe-binary',
    'tap-line',
    'mcq',
    'swipe-binary',
    'mcq',
    'swipe-binary',
    'tap-line',
    'swipe-binary',
  ]
  const bandCycle: Band[] = ['low', 'mid', 'high']

  const existing = countExistingByPattern()
  const specs: PuzzleSpec[] = []
  let cursor = 0

  for (const pattern of PATTERN_SLUGS) {
    const have = existing.get(pattern) ?? 0
    const needed = Math.max(0, TARGET_PER_PATTERN - have)
    for (let i = 0; i < needed; i++) {
      specs.push({
        pattern,
        interaction: interactionCycle[cursor % interactionCycle.length] ?? 'mcq',
        band: bandCycle[cursor % bandCycle.length] ?? 'mid',
      })
      cursor++
    }
  }

  return specs
}

function buildDryRunManifest(): PuzzleSpec[] {
  return [
    { pattern: 'off-by-one', interaction: 'mcq', band: 'low' },
    { pattern: 'mutable-state', interaction: 'tap-line', band: 'mid' },
    { pattern: 'concurrency', interaction: 'swipe-binary', band: 'high' },
  ]
}

async function main(): Promise<void> {
  const isDryRun = process.argv.includes('--dry-run')
  const manifest = isDryRun ? buildDryRunManifest() : buildFullManifest()
  const counters = loadExistingCounters()

  console.log(
    `generate:puzzles: ${isDryRun ? 'DRY RUN' : 'FULL BATCH'} — ${String(manifest.length)} puzzle(s) targeted\n`,
  )

  let written = 0
  let discarded = 0

  for (const spec of manifest) {
    const id = peekNextId(spec.pattern, counters)
    console.log(`=== ${id} (${spec.pattern}, ${spec.interaction}, ${spec.band}) ===`)

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

