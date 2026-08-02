/**
 * `pnpm generate:scrubber-puzzles` — LLM-assisted authoring pipeline for
 * Trace mode content (docs/prompts/claude_code_prompt_v2_phase4.md, Item 4).
 * Sibling module to generatePuzzles.ts, not an extension of it — see the
 * design-call note below. Reuses id assignment, disk writes, and cost
 * accounting from puzzleAuthoringShared.ts; everything else here is
 * scrubber-specific, because generation is a genuinely different shape.
 *
 * **Design call (sibling vs. extending generatePuzzles.ts):** sibling
 * module. Two reasons. First, generatePuzzles.ts calls `main()` at import
 * time (its last line is `main().catch(...)`) — anything that imported it
 * to reuse a helper would trigger a live quiz-generation run as a side
 * effect, which rules out importing it directly regardless of how the
 * two-pass shape is built. Second, the actually-divergent parts (the
 * manifest, the prompt, and the generation shape below) are large enough
 * that folding them into generatePuzzles.ts as a second mode would make
 * that file's control flow harder to follow for both content types, not
 * easier — the plan's own "sibling module... vs a rewrite larger than a
 * sibling module" framing is exactly this tradeoff. The genuinely shared
 * surface (id-counter logic, writePuzzle, cost accounting) was extracted to
 * puzzleAuthoringShared.ts instead of being duplicated or imported through
 * generatePuzzles.ts's side-effecting module.
 *
 * **Two-pass generation, not the plan's original one-pass wording.** The
 * plan's Item 1 spec text ("LLM proposes snippet + bug + checkpoint
 * placements -> trace generator executes -> validator asserts") has a bug:
 * proposing checkpoint placements before the trace exists is impossible for
 * anything but `next-line` — a `var-value`/`output` checkpoint's `choices`
 * are real values at real steps that don't exist until execution. This
 * pipeline is three passes in practice:
 *
 * 1. **Propose** (`propose`) — the model emits snippet/pattern/language/
 *    prompt/explanation/difficulty against ScrubberProposeSchema. No
 *    `steps`, no `checkpoints` — the model never emits a trace; traceGen is
 *    the only source of truth for `steps[]` (traceGen/types.ts).
 * 2. **Execute** (`traceSnippet`) — the isolated trace generator
 *    (jsTraceGen.ts / pyTraceGen.ts, both already child-process isolated
 *    per OD-2) produces `steps[]` by actually running the snippet.
 * 3. **Place checkpoints** (`placeCheckpoints`) — a second model call picks
 *    which steps are worth pausing at and what to ask, now with the real
 *    trace in hand. The model supplies `afterStep`/`question`/`target`
 *    only — never `choices`/`correct`.
 *
 * **Deterministic distractor synthesis** (`synthesizeChoices`) computes
 * `choices`/`correct` from the trace itself rather than asking the model:
 * for `var-value`, the best wrong answers are values the target variable
 * actually held at other steps (real stale-state, exactly what the puzzle
 * teaches); for `output`, other steps' recorded state; for `next-line`,
 * other lines the trace actually visited. This is cheaper, more reliable,
 * and — per the locked decision — pedagogically better than model-invented
 * distractors. A checkpoint synthesis can't serve (e.g. a target with no
 * other distinct historical value) is dropped, not patched with a model
 * fallback; if too few checkpoints survive, the whole attempt retries from
 * `propose` like any other validation failure.
 *
 * Every candidate still goes through the same PuzzleSchema.safeParse
 * (ordering, range, uniqueness, the var-value changed-since-previous-step
 * rule, the next-line not-on-final-step rule) as any other puzzle —
 * anything inconsistent is rejected automatically, never by a human. Self-
 * review (Sonnet) is the only stage judging "is this interesting," and
 * carries one scrubber-specific question the quiz reviewer never needed
 * (Item 5): can these checkpoints be answered from the snippet alone,
 * without stepping through the trace?
 */
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { MAX_DIFFICULTY, MIN_DIFFICULTY, PuzzleSchema, ScrubberProposeSchema } from '../schema'
import type { Puzzle } from '../schema'
import { PATTERN_LABELS } from '../patterns'
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
import { generateJsTrace } from './traceGen/jsTraceGen'
import { generatePyTrace } from './traceGen/pyTraceGen'
import type { TraceResult, TraceStep } from './traceGen/types'

// ---------------------------------------------------------------------------
// Locked decisions (docs/prompts/claude_code_prompt_v2_phase4.md)
// ---------------------------------------------------------------------------

/** Decision 3: Haiku 4.5 generates (propose + placement — both are schema/trace/validator-bounded), Sonnet 5 reviews (the only stage where a wrong judgment ships). */
const GENERATE_MODEL = 'claude-haiku-4-5-20251001'
const REVIEW_MODEL = 'claude-sonnet-5'
const MAX_GENERATION_ATTEMPTS = 3

/** Decision 6: scrubber content is restricted to these seven patterns — see the doc comment above SCRUBBER_PATTERN_ALLOWLIST's declaration for why the other six are excluded. */
const SCRUBBER_PATTERN_ALLOWLIST: readonly PatternSlug[] = [
  'off-by-one',
  'mutable-state',
  'scope-closures',
  'type-coercion',
  'control-flow',
  'recursion-termination',
  'data-structure-misuse',
]

/** Decision 6: "seven patterns across 40-60 puzzles is 6-8 each." */
const MIN_SCRUBBER_PER_PATTERN = 6
const TARGET_SCRUBBER_PER_PATTERN = 8

/** Decision 7: 60/40 JS/Python. */
const LANGUAGE_MIX_JS_SHARE = 0.6

const MIN_PATTERN_SPREAD = 800
const BUCKET_SIZE = 200
/** Highest bucket start the global scrubber dead-zone top-up covers — matches generatePuzzles.ts's/contentStats.ts's own MAX_DEAD_ZONE_BUCKET_START (bucket 2000-2199 is the last one required to have coverage). */
const MAX_DEAD_ZONE_BUCKET_START = 2000

/**
 * Provisional — decision/Item 1 calls for sizing the cli backend's ceiling
 * against "the measured per-puzzle call count from the pilot," which hasn't
 * run yet (this is that pilot's own ceiling). Sized generously for a
 * --limit=10 attended run: generateScrubberPuzzle's nested retry (see its
 * own doc comment) bounds one puzzle's worst case at MAX_GENERATION_ATTEMPTS
 * propose attempts x (1 propose call + up to MAX_GENERATION_ATTEMPTS
 * placement calls) + 1 review call = 3 x (1 + 3) + 1 = 13 calls; x 10
 * puzzles = 130, still comfortably under this ceiling. Item 6 must replace
 * this with the measured number before stage 2 (30) runs — noted again at
 * that call site.
 */
const CLI_CALL_CEILING = 250
const CLI_TOKEN_CEILING = 4_000_000

/**
 * Estimate, not a measurement — Item 1's instruction to measure against a
 * real scrubber generation requires actually spending on the api backend,
 * which this pipeline hasn't done (decision 4 defaults to cli, which spends
 * no Console credits, and the user has none to spend for a calibration run
 * either). Derived from reasoning about the three-call shape instead:
 * placement's input carries the full trace (larger than quiz's single-
 * puzzle input), review's input carries steps+checkpoints (larger than a
 * quiz puzzle). Flagged in the Item 6/7 handback rather than presented as
 * measured; if an api-backend run ever happens, replace this with a real
 * number the same way Item 1 did for the quiz pipeline.
 */
const EST_PROPOSE_INPUT_TOKENS = 3500
const EST_PROPOSE_OUTPUT_TOKENS = 500
const EST_PLACEMENT_INPUT_TOKENS = 3200
const EST_PLACEMENT_OUTPUT_TOKENS = 300
const EST_REVIEW_INPUT_TOKENS = 4200
const EST_REVIEW_OUTPUT_TOKENS = 250
const PROJECTED_COST_PER_PUZZLE =
  (costOf(GENERATE_MODEL, EST_PROPOSE_INPUT_TOKENS, EST_PROPOSE_OUTPUT_TOKENS) +
    costOf(GENERATE_MODEL, EST_PLACEMENT_INPUT_TOKENS, EST_PLACEMENT_OUTPUT_TOKENS) +
    costOf(REVIEW_MODEL, EST_REVIEW_INPUT_TOKENS, EST_REVIEW_OUTPUT_TOKENS)) *
  1.25
const PROJECTED_CALLS_PER_PUZZLE = 3
const PROJECTED_TOKENS_PER_PUZZLE = Math.round(
  (EST_PROPOSE_INPUT_TOKENS +
    EST_PROPOSE_OUTPUT_TOKENS +
    EST_PLACEMENT_INPUT_TOKENS +
    EST_PLACEMENT_OUTPUT_TOKENS +
    EST_REVIEW_INPUT_TOKENS +
    EST_REVIEW_OUTPUT_TOKENS) *
    1.25,
)

/** Re-derived per decision 4's own instruction — see COST_CEILING_USD's neighbor comment in generatePuzzles.ts for why 0.7 (the quiz number) doesn't transfer. Not measured (see PROJECTED_COST_PER_PUZZLE's comment); ~2.5x the estimate for a 10-puzzle pilot. */
const COST_CEILING_USD = PROJECTED_COST_PER_PUZZLE * 10 * 2.5

// ---------------------------------------------------------------------------
// Language + difficulty guidance
// ---------------------------------------------------------------------------

type Language = 'javascript' | 'python'
type Bias = 'low' | 'mid' | 'high'

interface ScrubberGenerateArgs {
  readonly id: string
  readonly pattern: PatternSlug
  readonly language: Language
  readonly targetRange: string
  readonly bias: Bias
}

function difficultyGuidance(args: ScrubberGenerateArgs): string {
  const [rangeFloor, rangeCeil] = args.targetRange.split('-').map(Number)
  const floor = rangeFloor ?? MIN_DIFFICULTY
  const ceil = rangeCeil ?? MAX_DIFFICULTY
  const nearPoint =
    args.bias === 'low'
      ? floor + 50
      : args.bias === 'high'
        ? ceil - 50
        : Math.round((floor + ceil) / 2)
  const sumTarget = Math.min(20, Math.max(4, Math.round((nearPoint - 800) / 100) + 4))

  const shapingHint =
    args.bias === 'low'
      ? `Pick the most blatant, easy-to-trace version of this pattern's bug you can think of — a handful of steps, no more than one or two variables worth watching. A puzzle that feels "too easy" for this pattern is exactly the point of this one.`
      : args.bias === 'high'
        ? `Pick a version of this pattern's bug that genuinely rewards stepping through — state that changes across a loop or multiple branches, a value that looks right for several steps before it doesn't, or interacting variables. Push for the hardest reasonable variant of this pattern's bug, even if this pattern's bugs typically lean simpler than that.`
        : `Pick a typical, moderate-difficulty example of this pattern's bug — enough intermediate state to be worth stepping through, not so much that the trace becomes tedious.`

  return (
    `- target difficulty range: ${args.targetRange} (this is what the FINAL difficulty_rating field should land in). ${shapingHint}\n` +
    `- Aim for S+T+D+C summing to approximately ${String(sumTarget)} (each sub-score 1-5) so the computed difficulty_rating lands in the target range. Pick content that genuinely scores at this level under the rubric — do not pick a harder or easier bug and then self-report a number that doesn't match what you actually wrote.`
  )
}

// ---------------------------------------------------------------------------
// Pass 1: propose
// ---------------------------------------------------------------------------

const PROPOSE_FEW_SHOT: unknown[] = [
  {
    id: 'oob-000',
    pattern: 'off-by-one',
    difficulty_rating: 1000,
    explanation:
      '`i <= n` runs one iteration past the intended range, reading `arr[n]` which is out of bounds for a length-n array — `arr[3]` is `undefined`, so `sum` accumulates `NaN`.',
    prompt: 'Step through this loop and predict what gets printed.',
    language: 'javascript',
    snippet:
      'function sumFirstN(arr, n) {\n  let sum = 0\n  for (let i = 0; i <= n; i++) {\n    sum += arr[i]\n  }\n  console.log(sum)\n}\nsumFirstN([2, 4, 6], 3)',
    interaction: 'scrubber',
  },
  {
    id: 'mut-000',
    pattern: 'mutable-state',
    difficulty_rating: 1400,
    explanation:
      'Python evaluates a default argument value once, at function-definition time. `basket=[]` creates a single list object every call omitting the argument shares and mutates, so `"apple"` from the first call is still in `basket` on the second.',
    prompt: 'Step through these two calls and predict what the second one prints.',
    language: 'python',
    snippet:
      'def add_item(item, basket=[]):\n    basket.append(item)\n    return basket\n\nfirst = add_item("apple")\nsecond = add_item("banana")\nprint(second)',
    interaction: 'scrubber',
  },
]

function buildProposeSystemPrompt(): string {
  return `You are authoring puzzles for Codoro's "Trace" mode: a player scrubs
step-by-step through a short program's real execution (variable values and
printed output after each line), and along the way answers a handful of
paused questions about what the state is or is about to become. Every
puzzle has exactly one real, unambiguous bug.

You are doing ONLY the first of three passes. Emit the snippet and its
metadata — do NOT emit "steps" or "checkpoints". A separate tool actually
executes your snippet to produce the real trace, and a later pass places
checkpoints against that real trace; your job is only to write a snippet
worth stepping through.

Follow this difficulty-calibration rubric exactly when setting difficulty_rating:

${CALIBRATION}

Two worked examples of correctly-shaped "propose" output (ids are placeholders
— you will be told the real id to use):

${PROPOSE_FEW_SHOT.map((p) => JSON.stringify(p, null, 2)).join('\n\n')}

Requirements:
- The snippet must be a complete, self-contained, deterministic program: it
  must actually run top-to-bottom without throwing, in the given language,
  with no network/file/user input, and no reliance on wall-clock time or
  randomness (Date.now(), new Date() with no arguments, Math.random(),
  time.time(), random.random(), and equivalents are all off-limits — the
  trace must come out identical every time this snippet runs).
- The bug must be a real LOGIC bug, not a syntax error or a crash — the
  snippet must run to completion and produce a wrong answer, not throw.
- The snippet must be genuinely worth *stepping through*: state (variable
  values, or what gets printed) must change meaningfully across at least
  several steps, ideally through a loop, multiple branches, or interacting
  variables — not a one-line bug with no interesting intermediate state.
  That is the single most important difference from Codoro's quiz modes.
- The snippet should produce at least one printed line (console.log /
  print) somewhere in its execution, so an "output" question is possible.
- "explanation" must be technically correct and specific to this snippet.
- "id" must be lowercase kebab-case matching the exact id you are given —
  do not invent your own id.
- "language" must be exactly what you are instructed below.
- Compute difficulty_rating by actually scoring S/T/D/C per the rubric for
  THIS specific puzzle, not by guessing a round number for the target band.
  State S, T, D, and C as numbers 1-5, sum them, and apply
  rating = 800 + (sum - 4) * 100.`
}

function buildProposeUserPrompt(args: ScrubberGenerateArgs, priorError: string | null): string {
  const lines = [
    `Propose one Trace-mode snippet with these exact parameters:`,
    `- id: "${args.id}"`,
    `- pattern: "${args.pattern}" (${PATTERN_LABELS[args.pattern]})`,
    `- language: "${args.language}"`,
    difficultyGuidance(args),
  ]
  if (priorError) {
    lines.push(
      '',
      'Your previous attempt failed — fix the specific problem and return a complete, corrected proposal:',
      priorError,
    )
  }
  return lines.join('\n')
}

interface ProposeResult {
  readonly id: string
  readonly pattern: PatternSlug
  readonly difficulty_rating: number
  readonly explanation: string
  readonly prompt: string
  readonly language: string
  readonly snippet: string
  readonly interaction: 'scrubber'
}

async function propose(
  backend: Backend,
  args: ScrubberGenerateArgs,
  priorError: string | null,
): Promise<{ result: ProposeResult | null; error: string | null }> {
  try {
    const response = await backend.generateStructured({
      model: GENERATE_MODEL,
      maxTokens: 8192,
      systemPrompt: buildProposeSystemPrompt(),
      userPrompt: buildProposeUserPrompt(args, priorError),
      schema: ScrubberProposeSchema,
    })
    usage.log(`propose ${args.id}`, GENERATE_MODEL, response.usage)
    if (response.parsed === null) {
      return { result: null, error: response.parseFailureReason ?? 'propose: no parseable output' }
    }
    const candidate = { ...(response.parsed as Record<string, unknown>), id: args.id }
    const result = ScrubberProposeSchema.safeParse(candidate)
    if (!result.success) {
      return {
        result: null,
        error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      }
    }
    return { result: result.data, error: null }
  } catch (err) {
    return { result: null, error: err instanceof Error ? err.message : String(err) }
  }
}

// ---------------------------------------------------------------------------
// Pass 2: execute
// ---------------------------------------------------------------------------

async function traceSnippet(language: Language, snippet: string): Promise<TraceResult> {
  return language === 'javascript' ? generateJsTrace(snippet) : generatePyTrace(snippet)
}

// ---------------------------------------------------------------------------
// Pass 3: place checkpoints
// ---------------------------------------------------------------------------

const PlacementSchema = z.object({
  checkpoints: z
    .array(
      z.object({
        afterStep: z.number().int().nonnegative(),
        question: z.enum(['next-line', 'var-value', 'output']),
        target: z.string().min(1).optional(),
      }),
    )
    .min(2)
    .max(4),
})
type Placement = z.infer<typeof PlacementSchema>
type PlacementCheckpoint = Placement['checkpoints'][number]

function formatTraceForPrompt(trace: TraceResult): string {
  return trace.steps
    .map((step, i) => {
      const vars = Object.entries(step.vars)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')
      const output = step.output !== undefined ? ` | printed: ${step.output}` : ''
      return `step ${String(i)}: line ${String(step.line)} | ${vars}${output}`
    })
    .join('\n')
}

function buildPlacementSystemPrompt(): string {
  return `You are choosing where a Codoro Trace-mode puzzle pauses. You are
given a snippet and its real, already-executed trace (one entry per
executed step, 0-indexed). Pick 2 to 4 steps worth pausing at and what to
ask — you do NOT choose the answer choices, only which step and which
question. A separate mechanism computes the actual answer choices from the
trace.

Question types:
- "next-line": asks which line runs next. Cannot be placed on the final
  step (there is no next line).
- "var-value": asks for the value of a specific variable ("target") right
  after this step. The target's value at this step must be DIFFERENT from
  its value at the previous step (or the target must be new at this step) —
  a value that hasn't changed was already visible before the question was
  asked, which defeats the point of pausing here.
- "output": asks what this step printed. Only valid on a step that actually
  printed something.

Rules:
- afterStep values across your checkpoints must be strictly increasing, no
  duplicates, and each must be a valid step index from the trace you were
  given.
- Pick checkpoints that genuinely require tracking execution to answer —
  if the answer is obvious just from reading the snippet once, without
  needing to know what happened at prior steps, it is not a good
  checkpoint. This is the most common way a Trace puzzle ends up feeling
  like a quiz question with extra steps instead of an honest trace.
- Prefer the step(s) closest to where the bug actually manifests — the
  point in the trace where a value first goes wrong, or where the wrong
  final output is produced.

Return only the checkpoints — no choices, no explanations.`
}

function buildPlacementUserPrompt(
  proposed: ProposeResult,
  trace: TraceResult,
  priorError: string | null,
): string {
  const lines = [
    `Snippet (pattern: ${proposed.pattern}, language: ${proposed.language}):`,
    proposed.snippet,
    '',
    `Bug: ${proposed.explanation}`,
    '',
    'Real trace:',
    formatTraceForPrompt(trace),
  ]
  if (priorError) {
    lines.push(
      '',
      'Your previous attempt failed — fix the specific problem and return a complete, corrected set of checkpoints:',
      priorError,
    )
  }
  return lines.join('\n')
}

async function placeCheckpoints(
  backend: Backend,
  proposed: ProposeResult,
  trace: TraceResult,
  priorError: string | null,
): Promise<{ result: readonly PlacementCheckpoint[] | null; error: string | null }> {
  try {
    const response = await backend.generateStructured({
      model: GENERATE_MODEL,
      maxTokens: 4096,
      systemPrompt: buildPlacementSystemPrompt(),
      userPrompt: buildPlacementUserPrompt(proposed, trace, priorError),
      schema: PlacementSchema,
    })
    usage.log(`place ${proposed.id}`, GENERATE_MODEL, response.usage)
    if (response.parsed === null) {
      return {
        result: null,
        error: response.parseFailureReason ?? 'placement: no parseable output',
      }
    }
    const result = PlacementSchema.safeParse(response.parsed)
    if (!result.success) {
      return {
        result: null,
        error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      }
    }
    return { result: result.data.checkpoints, error: null }
  } catch (err) {
    return { result: null, error: err instanceof Error ? err.message : String(err) }
  }
}

// ---------------------------------------------------------------------------
// Deterministic distractor synthesis
// ---------------------------------------------------------------------------

/** Small seeded PRNG (mulberry32) so choice ordering is reproducible per (afterStep, question, target) rather than drawing on Math.random — deterministic output makes this pure function directly unit-testable. */
function seededRandom(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function seedFrom(s: string): number {
  let hash = 0
  for (let i = 0; i < s.length; i++) hash = (Math.imul(hash, 31) + s.charCodeAt(i)) | 0
  return hash
}

/** Fisher-Yates using the seeded PRNG above — same seed always produces the same order. */
function seededShuffle<T>(items: readonly T[], seed: number): T[] {
  const rand = seededRandom(seed)
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const tmp = copy[i]
    copy[i] = copy[j] as T
    copy[j] = tmp as T
  }
  return copy
}

const MAX_DISTRACTORS = 3

export interface SynthesizedChoices {
  readonly choices: readonly string[]
  readonly correct: number
}

/**
 * Computes choices/correct for one checkpoint straight from the trace — see
 * this file's module doc comment for why (real stale-state values are
 * better distractors than anything a model would invent). Returns null if
 * the checkpoint can't be served this way (e.g. a var-value target that
 * never held any other value across the trace) — the caller drops that
 * checkpoint rather than falling back to asking the model for choices.
 */
export function synthesizeChoices(
  trace: TraceResult,
  placement: PlacementCheckpoint,
): SynthesizedChoices | null {
  const step: TraceStep | undefined = trace.steps[placement.afterStep]
  if (!step) return null

  let correctValue: string | undefined
  let pool: string[]

  if (placement.question === 'next-line') {
    const nextStep = trace.steps[placement.afterStep + 1]
    if (!nextStep) return null
    correctValue = String(nextStep.line)
    pool = [...new Set(trace.steps.map((s) => String(s.line)))].filter((v) => v !== correctValue)
  } else if (placement.question === 'var-value') {
    if (!placement.target) return null
    correctValue = step.vars[placement.target]
    if (correctValue === undefined) return null
    pool = [
      ...new Set(
        trace.steps
          .map((s) => (placement.target ? s.vars[placement.target] : undefined))
          .filter((v): v is string => v !== undefined),
      ),
    ].filter((v) => v !== correctValue)
  } else {
    correctValue = step.output
    if (correctValue === undefined) return null
    const varValues = trace.steps.flatMap((s) => Object.values(s.vars))
    const outputValues = trace.steps
      .map((s) => s.output)
      .filter((v): v is string => v !== undefined)
    pool = [...new Set([...varValues, ...outputValues])].filter((v) => v !== correctValue)
  }

  if (pool.length === 0) return null

  const seed = seedFrom(
    `${String(placement.afterStep)}-${placement.question}-${placement.target ?? ''}`,
  )
  const distractors = seededShuffle(pool, seed).slice(0, MAX_DISTRACTORS)
  const raw = [
    { value: correctValue, isCorrect: true },
    ...distractors.map((value) => ({ value, isCorrect: false })),
  ]
  const shuffled = seededShuffle(raw, seed + 1)
  return {
    choices: shuffled.map((c) => c.value),
    correct: shuffled.findIndex((c) => c.isCorrect),
  }
}

// ---------------------------------------------------------------------------
// Assembly + retry loop
// ---------------------------------------------------------------------------

interface CandidateCheckpoint {
  afterStep: number
  question: 'next-line' | 'var-value' | 'output'
  target?: string
  choices: string[]
  correct: number
}

/** Deterministic — see synthesizeChoices. Drops any placement that can't be given real answer choices rather than falling back to a model-invented one. */
function synthesizeCheckpoints(
  trace: TraceResult,
  placements: readonly PlacementCheckpoint[],
): CandidateCheckpoint[] {
  const checkpoints: CandidateCheckpoint[] = []
  for (const placement of placements) {
    const synthesized = synthesizeChoices(trace, placement)
    if (!synthesized) continue
    checkpoints.push({
      afterStep: placement.afterStep,
      question: placement.question,
      ...(placement.target !== undefined ? { target: placement.target } : {}),
      choices: [...synthesized.choices],
      correct: synthesized.correct,
    })
  }
  return checkpoints
}

/**
 * Two nested retry loops, not one flat one — a placement-only failure (the
 * model picks a step the var-value changed-since-previous rule rejects, or
 * too few checkpoints synthesize) retries placement against the SAME
 * already-executed trace, rather than discarding a perfectly good snippet
 * and paying for a fresh propose call. Found by the Item 4 review pass: the
 * original flat loop also fed a stale error from one pass into the wrong
 * pass's retry prompt (e.g. a propose-stage Zod error text landing in the
 * next placement prompt) — separate proposeError/placementError variables,
 * each cleared when its own pass moves past it, close both problems at
 * once. Total call budget is still bounded: MAX_GENERATION_ATTEMPTS outer
 * (propose) attempts, each with up to MAX_GENERATION_ATTEMPTS inner
 * (placement) attempts — see CLI_CALL_CEILING's comment for the worst case.
 */
async function generateScrubberPuzzle(
  backend: Backend,
  args: ScrubberGenerateArgs,
): Promise<Puzzle | null> {
  let proposeError: string | null = null
  let lastFailureReason: string | null = null

  for (let proposeAttempt = 1; proposeAttempt <= MAX_GENERATION_ATTEMPTS; proposeAttempt++) {
    const { result: proposed, error: proposeFailure } = await propose(backend, args, proposeError)
    if (!proposed) {
      proposeError = proposeFailure
      lastFailureReason = proposeFailure
      console.warn(
        `    propose ${args.id} attempt ${String(proposeAttempt)} failed: ${proposeFailure ?? 'unknown'}`,
      )
      continue
    }

    let trace: TraceResult
    try {
      trace = await traceSnippet(args.language, proposed.snippet)
    } catch (err) {
      proposeError = `snippet failed to execute: ${err instanceof Error ? err.message : String(err)}`
      lastFailureReason = proposeError
      console.warn(
        `    execute ${args.id} attempt ${String(proposeAttempt)} failed: ${proposeError}`,
      )
      continue
    }

    if (trace.steps.length < 3) {
      proposeError = `trace only had ${String(trace.steps.length)} step(s) — too short to place a meaningful checkpoint`
      lastFailureReason = proposeError
      console.warn(`    execute ${args.id} attempt ${String(proposeAttempt)}: ${proposeError}`)
      continue
    }

    // This propose attempt produced a usable snippet + trace — reset the
    // propose-facing error so a later placement failure never leaks into a
    // future propose retry prompt.
    proposeError = null

    let placementError: string | null = null
    for (
      let placementAttempt = 1;
      placementAttempt <= MAX_GENERATION_ATTEMPTS;
      placementAttempt++
    ) {
      const { result: placements, error: placementFailure } = await placeCheckpoints(
        backend,
        proposed,
        trace,
        placementError,
      )
      if (!placements) {
        placementError = placementFailure
        lastFailureReason = placementFailure
        console.warn(
          `    place ${args.id} attempt ${String(proposeAttempt)}.${String(placementAttempt)} failed: ${placementFailure ?? 'unknown'}`,
        )
        continue
      }

      const checkpoints = synthesizeCheckpoints(trace, placements)
      if (checkpoints.length < 2) {
        placementError = `only ${String(checkpoints.length)} of ${String(placements.length)} placed checkpoint(s) could be given deterministic answer choices (not enough distinct historical values) — need at least 2. Pick different steps or targets.`
        lastFailureReason = placementError
        console.warn(
          `    synthesize ${args.id} attempt ${String(proposeAttempt)}.${String(placementAttempt)}: ${placementError}`,
        )
        continue
      }

      const candidate = { ...proposed, id: args.id, steps: trace.steps, checkpoints }
      const result = PuzzleSchema.safeParse(candidate)
      if (!result.success) {
        placementError = result.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; ')
        lastFailureReason = placementError
        console.warn(
          `    validate ${args.id} attempt ${String(proposeAttempt)}.${String(placementAttempt)} failed: ${placementError}`,
        )
        continue
      }

      return result.data
    }
    // Inner (placement) attempts exhausted for this snippet — fall through
    // to a fresh propose attempt rather than giving up entirely.
  }

  console.warn(
    `  DISCARDED ${args.id}: exceeded ${String(MAX_GENERATION_ATTEMPTS)} propose attempt(s) (each with up to ${String(MAX_GENERATION_ATTEMPTS)} placement attempt(s)). Last error: ${lastFailureReason ?? 'unknown'}`,
  )
  return null
}

// ---------------------------------------------------------------------------
// Self-review (Item 5: adds the scrubber-specific question)
// ---------------------------------------------------------------------------

const ReviewSchema = z.object({
  pass: z.boolean(),
  reason: z.string().min(1),
})

function buildReviewSystemPrompt(): string {
  return `You are an independent reviewer for Codoro Trace-mode puzzle
content. You did not write the puzzle you're about to review — approach it
skeptically. Your job is to catch what schema validation cannot:

1. Is the claimed bug actually present in the snippet, exactly as the
   explanation describes it?
2. Is the explanation technically correct, with no factual errors?
3. Does difficulty_rating roughly match what applying this rubric to this
   specific puzzle would produce?
4. **Can these checkpoints be answered from the snippet alone, without
   stepping through the trace?** This is the scrubber-specific failure
   mode: a trace that is perfectly consistent, passes every validator rule,
   and is still a quiz question with extra steps. If a checkpoint's answer
   is obvious on a single read of the snippet — no need to track how state
   actually evolved — fail the puzzle. Being right about the mechanics
   (schema-valid) is not the same as being worth playing.

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
      maxTokens: 8192,
      systemPrompt: buildReviewSystemPrompt(),
      userPrompt: `Review this puzzle:\n\n${JSON.stringify(puzzle, null, 2)}`,
      schema: ReviewSchema,
    })
    usage.log(`review ${puzzle.id}`, REVIEW_MODEL, response.usage)
    if (response.parsed === null) {
      return {
        pass: false,
        reason:
          response.parseFailureReason ??
          'Review response did not conform to the requested JSON shape.',
      }
    }
    const reviewResult = ReviewSchema.safeParse(response.parsed)
    if (!reviewResult.success) {
      return {
        pass: false,
        reason: `Review response did not match the expected shape: ${reviewResult.error.issues.map((i) => i.message).join('; ')}`,
      }
    }
    return reviewResult.data
  } catch (err) {
    return {
      pass: false,
      reason: `Review call failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

// ---------------------------------------------------------------------------
// Scrubber-scoped gap manifest
// ---------------------------------------------------------------------------

interface ScrubberPuzzleSpec {
  readonly pattern: PatternSlug
  readonly language: Language
  readonly targetRange: string
  readonly bias: Bias
}

function bucketLabel(rating: number): string {
  const bucketStart =
    Math.floor((rating - MIN_DIFFICULTY) / BUCKET_SIZE) * BUCKET_SIZE + MIN_DIFFICULTY
  const bucketEnd = Math.min(bucketStart + BUCKET_SIZE - 1, MAX_DIFFICULTY)
  return `${String(bucketStart)}-${String(bucketEnd)}`
}

/** All 8 global difficulty buckets (800-2400), in order — cycled per-pattern below so a fresh pattern's first TARGET_SCRUBBER_PER_PATTERN puzzles trivially clear MIN_PATTERN_SPREAD and spread across the full range rather than clustering. */
function allBuckets(): string[] {
  const buckets: string[] = []
  for (let start = MIN_DIFFICULTY; start < MAX_DIFFICULTY; start += BUCKET_SIZE) {
    buckets.push(bucketLabel(start))
  }
  return buckets
}

function loadValidScrubberPuzzles(): Puzzle[] {
  return validatePuzzleFiles(loadRawPuzzleFiles())
    .valid.map((entry) => entry.puzzle)
    .filter((puzzle) => puzzle.interaction === 'scrubber')
}

/**
 * Scrubber-scoped counterpart to generatePuzzles.ts's buildGapManifest:
 * scopes spread/bucket coverage to scrubber content only, honours the
 * pattern allowlist (decision 6), and steers the 60/40 language mix
 * (decision 7). Keeps the same two properties the quiz manifest has —
 * gap-driven and idempotent — so each staged run (Item 1, "10 -> stop -> 30
 * -> stop -> top up") recomputes against what's now on disk.
 */
function buildScrubberGapManifest(): ScrubberPuzzleSpec[] {
  const puzzles = loadValidScrubberPuzzles()
  const buckets = allBuckets()

  let jsCount = puzzles.filter((p) => p.language === 'javascript').length
  let pyCount = puzzles.filter((p) => p.language === 'python').length

  function nextLanguage(): Language {
    const total = jsCount + pyCount
    const jsShare = total === 0 ? 0 : jsCount / total
    const language: Language = jsShare < LANGUAGE_MIX_JS_SHARE ? 'javascript' : 'python'
    if (language === 'javascript') jsCount++
    else pyCount++
    return language
  }

  const specs: ScrubberPuzzleSpec[] = []

  for (const pattern of SCRUBBER_PATTERN_ALLOWLIST) {
    const patternPuzzles = puzzles.filter((p) => p.pattern === pattern)
    const ratings = patternPuzzles.map((p) => p.difficulty_rating)
    const bucketCounts = new Map<string, number>(buckets.map((b) => [b, 0]))
    for (const rating of ratings) {
      const label = bucketLabel(rating)
      bucketCounts.set(label, (bucketCounts.get(label) ?? 0) + 1)
    }

    const min = ratings.length > 0 ? Math.min(...ratings) : null
    const max = ratings.length > 0 ? Math.max(...ratings) : null
    const spread = min !== null && max !== null ? max - min : 0

    let needed = Math.max(0, MIN_SCRUBBER_PER_PATTERN - patternPuzzles.length)
    // Already at the count floor but still under the spread DoD: top up
    // rather than leaving a narrow pattern alone, mirroring the quiz
    // manifest's "2 puzzles per deficient pattern" top-up.
    if (
      needed === 0 &&
      spread < MIN_PATTERN_SPREAD &&
      patternPuzzles.length < TARGET_SCRUBBER_PER_PATTERN
    ) {
      needed = Math.min(2, TARGET_SCRUBBER_PER_PATTERN - patternPuzzles.length)
    }
    // Never generate past the per-pattern target in one manifest — the
    // staged-run design (10 -> 30 -> top up) means a later stage picks up
    // any pattern still short after this one.
    needed = Math.min(needed, Math.max(0, TARGET_SCRUBBER_PER_PATTERN - patternPuzzles.length))

    for (let i = 0; i < needed; i++) {
      // Greedy: fill whichever global bucket this pattern has the fewest
      // puzzles in first, so a handful of new puzzles spread across the
      // full range instead of clustering in one band.
      const sorted = [...bucketCounts.entries()].sort((a, b) => a[1] - b[1])
      const target = sorted[0]
      if (!target) break
      const [bucket] = target
      bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1)

      const bucketIndex = buckets.indexOf(bucket)
      const bias: Bias =
        bucketIndex === 0 ? 'low' : bucketIndex === buckets.length - 1 ? 'high' : 'mid'

      specs.push({ pattern, language: nextLanguage(), targetRange: bucket, bias })
    }
  }

  // Global dead-zone top-up. Found in Item 4's review pass: the per-pattern
  // loop above only guarantees MIN_PATTERN_SPREAD *within* each pattern —
  // greedily filling a pattern's own least-populated buckets first means a
  // brand-new pattern's MIN_SCRUBBER_PER_PATTERN (6) slots fill the 6
  // lowest of the 8 global buckets and never reach the top of the range.
  // Track every bucket this manifest will end up covering (existing +
  // already-queued specs) across ALL allowlisted patterns combined, and top
  // up any bucket up to MAX_DEAD_ZONE_BUCKET_START that's still empty —
  // mirrors generatePuzzles.ts's buildGapManifest dead-zone pass.
  const globalCoveredBuckets = new Set<string>()
  for (const puzzle of puzzles) globalCoveredBuckets.add(bucketLabel(puzzle.difficulty_rating))
  for (const spec of specs) globalCoveredBuckets.add(spec.targetRange)

  const patternTotals = new Map<PatternSlug, number>(SCRUBBER_PATTERN_ALLOWLIST.map((p) => [p, 0]))
  for (const puzzle of puzzles) {
    if (patternTotals.has(puzzle.pattern)) {
      patternTotals.set(puzzle.pattern, (patternTotals.get(puzzle.pattern) ?? 0) + 1)
    }
  }
  for (const spec of specs)
    patternTotals.set(spec.pattern, (patternTotals.get(spec.pattern) ?? 0) + 1)

  for (let start = MIN_DIFFICULTY; start <= MAX_DEAD_ZONE_BUCKET_START; start += BUCKET_SIZE) {
    const bucket = bucketLabel(start)
    if (globalCoveredBuckets.has(bucket)) continue

    // Assign to whichever allowlisted pattern has the fewest puzzles so far
    // (existing + already-queued) and hasn't already hit
    // TARGET_SCRUBBER_PER_PATTERN in this manifest — if every pattern is
    // already at its target, leave the bucket for a later top-up stage
    // rather than overshooting the per-pattern cap.
    const candidate = [...SCRUBBER_PATTERN_ALLOWLIST]
      .filter((p) => (patternTotals.get(p) ?? 0) < TARGET_SCRUBBER_PER_PATTERN)
      .sort((a, b) => (patternTotals.get(a) ?? 0) - (patternTotals.get(b) ?? 0))[0]
    if (!candidate) break

    const bucketIndex = buckets.indexOf(bucket)
    const bias: Bias =
      bucketIndex === 0 ? 'low' : bucketIndex === buckets.length - 1 ? 'high' : 'mid'
    specs.push({ pattern: candidate, language: nextLanguage(), targetRange: bucket, bias })
    globalCoveredBuckets.add(bucket)
    patternTotals.set(candidate, (patternTotals.get(candidate) ?? 0) + 1)
  }

  return specs
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const usage = createUsageTracker()

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
  const fullManifest = buildScrubberGapManifest()
  const manifest = limit !== null ? fullManifest.slice(0, limit) : fullManifest
  const counters = createIdCounters()

  if (fullManifest.length === 0) {
    console.log(
      `generate:scrubber-puzzles: curve already covered — every allowlisted pattern has >= ${String(MIN_SCRUBBER_PER_PATTERN)} puzzles spanning >= ${String(MIN_PATTERN_SPREAD)} points. Nothing to generate.`,
    )
    return
  }

  const projectedCost = manifest.length * PROJECTED_COST_PER_PUZZLE
  const projectedCalls = manifest.length * PROJECTED_CALLS_PER_PUZZLE
  const projectedTokens = manifest.length * PROJECTED_TOKENS_PER_PUZZLE

  console.log(
    `generate:scrubber-puzzles: ${isDryRun ? 'DRY RUN' : 'FULL BATCH'} — backend=${backendKind} (${backendKind === 'cli' ? 'spends: Claude subscription usage' : 'spends: Console credits (USD)'}) — ${String(manifest.length)} puzzle(s) targeted (gap-driven)` +
      (limit !== null ? ` [--limit=${String(limit)} of ${String(fullManifest.length)}]` : '') +
      '\n',
  )
  for (const spec of manifest) {
    console.log(
      `  - ${spec.pattern} / ${spec.language} / target ${spec.targetRange} (bias: ${spec.bias})`,
    )
  }
  console.log(`\nModels: generate/placement=${GENERATE_MODEL}, review=${REVIEW_MODEL}`)
  if (backendKind === 'api') {
    console.log(
      `Projected cost: ~$${projectedCost.toFixed(4)} (${String(manifest.length)} puzzle(s) x ~$${PROJECTED_COST_PER_PUZZLE.toFixed(4)}/puzzle, ESTIMATED not measured — see this file's cost-constant comments)`,
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

  const backend = createBackend(backendKind)

  let written = 0
  let discarded = 0

  for (const spec of manifest) {
    if (backend.kind === 'api' && usage.totals.costUsd >= COST_CEILING_USD) {
      console.warn(
        `\ngenerate:scrubber-puzzles: COST_CEILING_USD ($${COST_CEILING_USD.toFixed(2)}) reached at $${usage.totals.costUsd.toFixed(4)} — stopping before the next puzzle. ${String(manifest.length - written - discarded)} puzzle(s) left un-attempted.`,
      )
      break
    }
    if (
      backend.kind === 'cli' &&
      (usage.totals.callCount >= CLI_CALL_CEILING ||
        usage.totals.inputTokens + usage.totals.outputTokens >= CLI_TOKEN_CEILING)
    ) {
      console.warn(
        `\ngenerate:scrubber-puzzles: cli ceiling reached (${String(usage.totals.callCount)} calls, ${String(usage.totals.inputTokens + usage.totals.outputTokens)} tokens) — stopping before the next puzzle. ${String(manifest.length - written - discarded)} puzzle(s) left un-attempted.`,
      )
      break
    }

    const id = counters.peek(spec.pattern)
    console.log(`=== ${id} (${spec.pattern}, ${spec.language}, target ${spec.targetRange}) ===`)

    const puzzle = await generateScrubberPuzzle(backend, { ...spec, id })
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
    `\ngenerate:scrubber-puzzles: ${String(written)} written, ${String(discarded)} discarded. ` +
      `Total: ${String(usage.totals.callCount)} call(s), in=${String(usage.totals.inputTokens)} out=${String(usage.totals.outputTokens)} tokens` +
      (backend.kind === 'api'
        ? `, ~$${usage.totals.costUsd.toFixed(4)}.`
        : ` (subscription usage; notional ~$${usage.totals.costUsd.toFixed(4)}).`),
  )

  if (written === 0 && manifest.length > 0) {
    process.exitCode = 1
  }
}

// Only run as a side effect when this file is executed directly (`tsx
// .../generateScrubberPuzzles.ts`), never when imported for its exports
// (synthesizeChoices, imported directly by
// generateScrubberPuzzles.distractors.test.ts) — without this guard,
// importing this module for a pure function would silently kick off a full
// generation run, including spawning the claude CLI, on every test run.
const isEntryPoint =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]
if (isEntryPoint) {
  main().catch((err: unknown) => {
    console.error(err)
    process.exitCode = 1
  })
}
