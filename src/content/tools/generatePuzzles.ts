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
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import {
  DragOrderSchema,
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
import { costOf, createBackend, parseBackendArg } from './llmBackend'
import type { Backend } from './llmBackend'
import {
  CALIBRATION,
  createIdCounters,
  createUsageTracker,
  writePuzzle,
} from './puzzleAuthoringShared'

// Per-model, not a single MODEL constant (Phase 4 blocking precondition,
// docs/v2-build-plan.md): "the moment the models differ, the guard is
// silently wrong." Both are Sonnet 5 today — generate/review staying on the
// same model for quiz content is unchanged from before this split; what
// changed is that costOf (llmBackend.ts) now prices each call against the
// model that actually made it, so this stays correct the moment either one
// changes (Phase 6, or a future quiz-specific split).
const GENERATE_MODEL = 'claude-sonnet-5'
const REVIEW_MODEL = 'claude-sonnet-5'
const MAX_GENERATION_ATTEMPTS = 3

/**
 * Hard stop on batch spend for the `api` backend, checked before every
 * puzzle in main()'s loop. This is a runaway-loop circuit breaker, not a
 * budget — see PROJECTED_COST_PER_PUZZLE for the real per-puzzle estimate
 * --dry-run reports against.
 */
const COST_CEILING_USD = 0.7

/**
 * The `cli` backend spends no Console credits (draws on subscription usage
 * instead), so COST_CEILING_USD above is meaningless for it — a dollar
 * ceiling can't gate a quota it never touches. A runaway loop would instead
 * be free to drain the invoking account's shared Claude usage limits, so
 * this backend gets its own circuit breaker, denominated in calls and
 * tokens rather than dollars. Sized generously against this pipeline's own
 * existing per-puzzle estimates (~2 calls, ~8.7k tokens/puzzle — see
 * PROJECTED_COST_PER_PUZZLE below) with a wide safety margin, since quiz
 * batches here are typically small and gap-driven; the scrubber pipeline
 * (generateScrubberPuzzles.ts) sizes its own ceiling against its pilot's
 * measured per-puzzle call count instead of reusing this number.
 */
const CLI_CALL_CEILING = 150
const CLI_TOKEN_CEILING = 2_000_000

// 'drag-order' is a valid generation target (INTERACTION_SCHEMAS below can
// produce it), but no generation run targets it this phase — INTERACTION_CYCLE
// and the prompt text below stay scoped to the three interactions this
// pipeline actually authors content for; see docs/prompts for Phase 5b Item 5.
type Interaction = 'mcq' | 'swipe-binary' | 'tap-line' | 'drag-order'
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
  'drag-order': DragOrderSchema,
} as const

const ReviewSchema = z.object({
  pass: z.boolean(),
  reason: z.string().min(1),
})

/**
 * costUsd accumulates via costOf(model, ...) per call, never by summing raw
 * tokens across calls and pricing the total at one rate — that aggregate
 * approach is exactly the bug class this Phase 4 fix closes (see
 * COST_CEILING_USD's neighboring comment): correct even if generate/review
 * are ever on different models. See puzzleAuthoringShared.ts's
 * createUsageTracker for the implementation, shared with the scrubber
 * pipeline.
 */
const { totals, log: logUsage } = createUsageTracker()

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

async function generatePuzzle(backend: Backend, args: GenerateArgs): Promise<Puzzle | null> {
  let lastError: string | null = null

  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
    let parsed: unknown
    try {
      const response = await backend.generateStructured({
        model: GENERATE_MODEL,
        // Sonnet 5 defaults to adaptive thinking when `thinking` is
        // omitted, and thinking tokens draw from this same budget — a
        // tight cap here truncates mid-generation (seen in testing at
        // max_tokens: 4096, several calls hit the cap exactly and failed
        // to parse). This is a ceiling, not a target — extra headroom
        // costs nothing unless the model actually uses it.
        maxTokens: 8192,
        systemPrompt: buildSystemPrompt(),
        userPrompt: buildUserPrompt(args, lastError),
        schema: INTERACTION_SCHEMAS[args.interaction],
      })
      logUsage(`generate ${args.id} attempt ${String(attempt)}`, GENERATE_MODEL, response.usage)
      parsed = response.parsed
      if (parsed === null && response.parseFailureReason) {
        lastError = response.parseFailureReason
        console.warn(`    generate ${args.id} attempt ${String(attempt)} threw: ${lastError}`)
        continue
      }
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

async function selfReview(
  backend: Backend,
  puzzle: Puzzle,
): Promise<{ pass: boolean; reason: string }> {
  try {
    const response = await backend.generateStructured({
      model: REVIEW_MODEL,
      // Sonnet 5 defaults to adaptive thinking when `thinking` is omitted,
      // and thinking tokens draw from this same budget — too tight a limit
      // here truncates the JSON response before it completes (seen in
      // testing: several review calls hit exactly max_tokens and produced
      // unparseable output, even at 4096). Match generation's headroom.
      maxTokens: 8192,
      systemPrompt: buildReviewSystemPrompt(),
      userPrompt: `Review this puzzle:\n\n${JSON.stringify(puzzle, null, 2)}`,
      schema: ReviewSchema,
    })
    logUsage(`review ${puzzle.id}`, REVIEW_MODEL, response.usage)

    if (response.parsed === null) {
      return {
        pass: false,
        reason:
          response.parseFailureReason ??
          'Review response did not conform to the requested JSON shape.',
      }
    }
    // The api backend's zodOutputFormat already guarantees this shape, but
    // the cli backend's structured_output is never validated by anything
    // upstream of here — without this check, a malformed {pass: "false"}
    // (truthy) would read as an un-rejected review and let an un-reviewed
    // puzzle get written.
    const reviewResult = ReviewSchema.safeParse(response.parsed)
    if (!reviewResult.success) {
      return {
        pass: false,
        reason: `Review response did not match the expected shape: ${reviewResult.error.issues.map((issue) => issue.message).join('; ')}`,
      }
    }
    return reviewResult.data
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    return { pass: false, reason: `Review call failed: ${message}` }
  }
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

/**
 * Quiz puzzles only. Phase 4 (docs/prompts/claude_code_prompt_v2_phase4.md,
 * Item 4) found buildGapManifest reading the unfiltered pool here — the
 * five scrubber pilots that predate this fix were already counting toward
 * per-pattern spread and bucket coverage below, exactly the contamination
 * generateScrubberPuzzles.ts's own manifest exists to keep scoped away
 * from. Verified before fixing: none of the four overlapping patterns
 * (off-by-one, mutable-state, scope-closures, type-coercion) currently flip
 * deficient/covered because of it — each already clears the 800pt spread
 * on quiz-only ratings alone — but Item 4 is about to add 40-60 more
 * scrubber puzzles into these same patterns, at which point the
 * contamination would start mattering for real.
 */
function loadValidPuzzles(): Puzzle[] {
  return validatePuzzleFiles(loadRawPuzzleFiles())
    .valid.map((entry) => entry.puzzle)
    .filter((puzzle) => puzzle.interaction !== 'scrubber')
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
 * Priced per-model (GENERATE_MODEL for the generate call, REVIEW_MODEL for
 * review) even though both are the same model today, for the same reason
 * costOf itself takes a model — see this file's other per-model comments.
 */
const PROJECTED_COST_PER_PUZZLE =
  (costOf(GENERATE_MODEL, EST_GENERATE_INPUT_TOKENS, EST_GENERATE_OUTPUT_TOKENS) +
    costOf(REVIEW_MODEL, EST_REVIEW_INPUT_TOKENS, EST_REVIEW_OUTPUT_TOKENS)) *
  1.25
/** Same shape as the cost projection above, in calls/tokens rather than dollars — what --dry-run reports for the cli backend. */
const PROJECTED_CALLS_PER_PUZZLE = 2
const PROJECTED_TOKENS_PER_PUZZLE = Math.round(
  (EST_GENERATE_INPUT_TOKENS +
    EST_GENERATE_OUTPUT_TOKENS +
    EST_REVIEW_INPUT_TOKENS +
    EST_REVIEW_OUTPUT_TOKENS) *
    1.25,
)

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
  const backendKind = parseBackendArg()
  const fullManifest = buildGapManifest()
  const manifest = limit !== null ? fullManifest.slice(0, limit) : fullManifest
  const counters = createIdCounters()

  if (fullManifest.length === 0) {
    console.log(
      'generate:puzzles: curve already covered — every pattern spans >= 800 points and no 200pt bucket between 800 and 2199 is empty. Nothing to generate.',
    )
    return
  }

  const projectedCost = manifest.length * PROJECTED_COST_PER_PUZZLE
  const projectedCalls = manifest.length * PROJECTED_CALLS_PER_PUZZLE
  const projectedTokens = manifest.length * PROJECTED_TOKENS_PER_PUZZLE

  console.log(
    `generate:puzzles: ${isDryRun ? 'DRY RUN' : 'FULL BATCH'} — backend=${backendKind} (${backendKind === 'cli' ? 'spends: Claude subscription usage' : 'spends: Console credits (USD)'}) — ${String(manifest.length)} puzzle(s) targeted (gap-driven)` +
      (limit !== null ? ` [--limit=${String(limit)} of ${String(fullManifest.length)}]` : '') +
      '\n',
  )
  for (const spec of manifest) {
    console.log(
      `  - ${spec.pattern} / ${spec.interaction} / target ${spec.targetRange} (bias: ${spec.bias})`,
    )
  }
  console.log(`\nModels: generate=${GENERATE_MODEL}, review=${REVIEW_MODEL}`)
  if (backendKind === 'api') {
    console.log(
      `Projected cost: ~$${projectedCost.toFixed(4)} (${String(manifest.length)} puzzle(s) x ~$${PROJECTED_COST_PER_PUZZLE.toFixed(4)}/puzzle, conservative estimate)`,
    )
    if (projectedCost > COST_CEILING_USD) {
      console.warn(
        `  WARNING: projected cost exceeds COST_CEILING_USD ($${COST_CEILING_USD.toFixed(2)}) — shrink the manifest before running for real.`,
      )
    }
  } else {
    console.log(
      `Projected usage: ~${String(projectedCalls)} call(s), ~${String(projectedTokens)} tokens (${String(manifest.length)} puzzle(s) x ~${String(PROJECTED_CALLS_PER_PUZZLE)} calls / ~${String(PROJECTED_TOKENS_PER_PUZZLE)} tokens/puzzle) — drawn from your Claude subscription's usage limits, not billed in dollars` +
        ` (notional $-equivalent if it had run on the api backend: ~$${projectedCost.toFixed(4)})`,
    )
    if (projectedCalls > CLI_CALL_CEILING || projectedTokens > CLI_TOKEN_CEILING) {
      console.warn(
        `  WARNING: projected usage exceeds this run's cli ceiling (${String(CLI_CALL_CEILING)} calls / ${String(CLI_TOKEN_CEILING)} tokens) — shrink the manifest before running for real.`,
      )
    }
  }

  if (isDryRun) {
    return
  }

  // Constructed here, not at module load: checkCliAvailable (inside
  // createBackend for the cli kind) fails loudly before any generation
  // attempt, but only for the backend actually selected — a --dry-run with
  // no --backend flag shouldn't require the claude binary to be installed
  // just to print a projection.
  const backend = createBackend(backendKind)

  let written = 0
  let discarded = 0

  for (const spec of manifest) {
    if (backend.kind === 'api' && totals.costUsd >= COST_CEILING_USD) {
      console.warn(
        `\ngenerate:puzzles: COST_CEILING_USD ($${COST_CEILING_USD.toFixed(2)}) reached at $${totals.costUsd.toFixed(4)} — stopping before the next puzzle. ${String(manifest.length - written - discarded)} puzzle(s) left un-attempted.`,
      )
      break
    }
    if (
      backend.kind === 'cli' &&
      (totals.callCount >= CLI_CALL_CEILING ||
        totals.inputTokens + totals.outputTokens >= CLI_TOKEN_CEILING)
    ) {
      console.warn(
        `\ngenerate:puzzles: cli ceiling reached (${String(totals.callCount)} calls, ${String(totals.inputTokens + totals.outputTokens)} tokens) — stopping before the next puzzle. ${String(manifest.length - written - discarded)} puzzle(s) left un-attempted.`,
      )
      break
    }

    const id = counters.peek(spec.pattern)
    console.log(`=== ${id} (${spec.pattern}, ${spec.interaction}, target ${spec.targetRange}) ===`)

    const puzzle = await generatePuzzle(backend, { ...spec, id })
    if (!puzzle) {
      discarded++
      continue
    }

    const review = await selfReview(backend, puzzle)
    if (!review.pass) {
      console.warn(`  DISCARDED ${id}: self-review failed — ${review.reason}`)
      discarded++
      continue
    }

    writePuzzle(puzzle)
    counters.commit(spec.pattern, id)
    written++
    console.log(`  WROTE ${id}`)
  }

  console.log(
    `\ngenerate:puzzles: ${String(written)} written, ${String(discarded)} discarded. ` +
      `Total: ${String(totals.callCount)} call(s), in=${String(totals.inputTokens)} out=${String(totals.outputTokens)} tokens` +
      (backend.kind === 'api'
        ? `, ~$${totals.costUsd.toFixed(4)}.`
        : ` (subscription usage; notional ~$${totals.costUsd.toFixed(4)}).`),
  )

  if (written === 0 && manifest.length > 0) {
    process.exitCode = 1
  }
}

// Only run as a side effect when this file is executed directly (`tsx
// .../generatePuzzles.ts`), never when imported — nothing imports this
// module today, but generateScrubberPuzzles.ts's identical pattern turned
// out to be a real bug (a test importing it for one pure export silently
// triggered a full generation run, including spawning the claude CLI) the
// moment something did import it. Guarding here closes the same latent
// hazard before it can bite the same way.
const isEntryPoint =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]
if (isEntryPoint) {
  main().catch((err: unknown) => {
    console.error(err)
    process.exitCode = 1
  })
}
