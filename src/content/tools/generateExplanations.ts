/**
 * `pnpm generate:explanations` — LLM-assisted authoring pipeline for the v6
 * Phase 6.0 coach layer. See docs/superpowers/plans/2026-09-19-wrong-answer-
 * explanations-spec.md §4.
 *
 * One LLM call per puzzle, not per wrong answer (§4.2) — the model sees every
 * distractor together, which is what keeps it from writing three
 * explanations that say the same thing. The model is asked for `entries`
 * only; `puzzle_id`/`interaction`/`generated_at`/`generator_version` are
 * filled in by this script, never trusted from the model (same reason
 * generatePuzzles.ts always owns `id` itself rather than the model's). The
 * resulting object is validated with `ExplanationSetSchema.safeParse` — per
 * generatePuzzles.ts's own doc comment, that Zod pass is the one
 * authoritative check; this module's job stops at "did it produce something
 * JSON-shaped, targeting exactly the wrong answers asked for."
 *
 * No self-review call, unlike generatePuzzles.ts's generate→review→write —
 * the spec's own quality gate is a human read of a stratified sample (§8),
 * deliberately not a second model call grading the first (a model checking
 * its own output for confident-but-wrong language-semantics claims is the
 * weakest possible reviewer for exactly the failure mode that matters).
 *
 * Idempotent by default (§4.3): a puzzle whose explanation file already
 * exists, validates, and covers exactly the wrong answers it currently has is
 * skipped unless --force. Writes per-puzzle, immediately — a batch that dies
 * partway through must not lose the puzzles it already wrote. Batched by
 * pattern so a bad prompt is caught early rather than after the whole run.
 *
 * Authoring-time only: never imported by app code, never bundled.
 */
import process from 'node:process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { ExplanationEntrySchema, ExplanationSetSchema } from '../explanationSchema'
import type { ExplanationEntry, ExplanationSet } from '../explanationSchema'
import type { Puzzle } from '../schema'
import { PATTERN_SLUGS } from '../patterns'
import type { PatternSlug } from '../patterns'
import { MISCONCEPTION_LABELS, MISCONCEPTION_SLUGS } from '../misconceptions'
import { loadRawPuzzleFiles } from './loadPuzzles'
import { validatePuzzleFiles } from './validatePuzzles'
import { costOf, createBackend, parseBackendArg } from './llmBackend'
import type { Backend } from './llmBackend'
import { createUsageTracker } from './puzzleAuthoringShared'
import { wrongTargetsFor } from './explanationTargets'

const GENERATE_MODEL = 'claude-sonnet-5'
const MAX_GENERATION_ATTEMPTS = 3

/**
 * Bump when the prompt below changes materially — carried into every
 * generated set's `generator_version`. v2 (Phase 6.1, spec §3.2a): the
 * "misconception" rule switched from free-form kebab-case to a closed list —
 * see MISCONCEPTION_SLUGS's own doc comment for why the v1 free-form version
 * produced an unusable 96%-singleton taxonomy.
 */
const GENERATOR_VERSION = 2

/** The three interactions an explanation set can target — mirrors ExplanationSetSchema's `interaction` enum, not PuzzleSchema's full union (drag-order/scrubber are deferred, see the spec's §10). */
type ExplainableInteraction = 'mcq' | 'tap-line' | 'swipe-binary'
const EXPLAINABLE_INTERACTIONS: readonly ExplainableInteraction[] = [
  'mcq',
  'tap-line',
  'swipe-binary',
]

function isExplainableInteraction(
  interaction: Puzzle['interaction'],
): interaction is ExplainableInteraction {
  return (EXPLAINABLE_INTERACTIONS as readonly string[]).includes(interaction)
}

/** Hard stop on batch spend for the `api` backend — see generatePuzzles.ts's identical guard for why this is a circuit breaker, not a budget. */
const COST_CEILING_USD = 2.0

/**
 * The cli backend's own circuit breaker, denominated in calls/tokens rather
 * than dollars (see llmBackend.ts's header and generatePuzzles.ts's identical
 * pair) — sized against this batch's own shape: mcq (60 puzzles, ~3 wrong
 * choices each) is cheap; tap-line (39 puzzles, ~14 wrong lines each) is the
 * heavier half. One call per puzzle (vs. generatePuzzles.ts's two), so the
 * call ceiling only needs headroom for retries, not a second pass.
 */
const CLI_CALL_CEILING = 150
const CLI_TOKEN_CEILING = 1_500_000

const CONTENT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const EXPLANATIONS_DIR = join(CONTENT_DIR, 'explanations')

/**
 * What the model is actually asked to produce — `entries` only. Everything
 * else in an ExplanationSet is owned by this script (see the module header).
 */
const EntriesRequestSchema = z.object({
  entries: z.array(ExplanationEntrySchema).min(1),
})

/**
 * Renders MISCONCEPTION_SLUGS as a closed, numbered menu the model picks
 * from — one line per label, slug plus its human-readable gloss so the model
 * has semantic grounding beyond the bare slug. Generated from
 * misconceptions.ts, never hand-duplicated, so a future vocabulary edit
 * (docs/v6-misconception-vocabulary-2026-09-20.md's amendment path) updates
 * this prompt for free.
 */
function misconceptionMenu(): string {
  return MISCONCEPTION_SLUGS.map((slug) => `- ${slug}: ${MISCONCEPTION_LABELS[slug]}`).join('\n')
}

function buildSystemPrompt(): string {
  return `You are writing the "coach" layer for Codoro, a spot-the-bug trivia
app for working software engineers. The player already answered a puzzle
wrong — by picking a wrong mcq choice, tapping a wrong line, or swiping the
wrong direction. Your job is to write one short, targeted explanation for
EACH wrong answer you're given, addressed to someone who just made that
specific choice.

Ground every claim in the puzzle's existing "explanation" field, which you
will be given as the authoritative truth about what the bug actually is —
never invent a different bug, and never contradict it.

Rules for every "why_wrong" entry:
- Second person, 2-3 sentences, 40-600 characters.
- Address the choice they made specifically. Do not restate what the correct
  answer is — that's shown elsewhere.
- Two moves, in this order: name the misconception, then draw the actual
  distinction.
- Never use ordinal or positional language ("option B", "the second choice",
  "the one above/below"). Choices are shuffled per serving, so a positional
  reference is wrong roughly three-quarters of the time.
- No praise ("Great attempt!") and no scolding. "Close — this is the
  classic ..." is fine.
- Inline markdown is limited to backtick code spans (e.g. \`i <= len\`) — no
  bold, links, headers, or other spans.

Rules for "misconception":
- CLOSED LIST. You must return exactly one of the slugs below — anything
  else fails validation and the whole set is rejected. This is deliberate:
  the field is a shared taxonomy across the entire puzzle library, and a
  free-form version already produced an unusable one (274 distinct labels
  across 292 entries, 96% never reused).
- Pick the single closest-fitting label, even when the fit feels approximate
  — that is expected for a fixed vocabulary this size. Do not invent a new
  slug under any circumstance, including a close paraphrase of an existing
  one.
- Escape hatch: if a puzzle's actual misconception is not represented by ANY
  label below (not just an imperfect fit — genuinely absent), pick the
  closest one anyway and leave the puzzle id out of this run's summary notes
  for a human to review; growing the vocabulary is a deliberate, reviewed
  edit to misconceptions.ts (see its own doc comment), never something this
  pipeline does automatically.

Available misconceptions:
${misconceptionMenu()}

Interaction-specific rules:
- "mcq": target is the canonical index into the puzzle's "choices" array —
  the order you are given them in, not a shuffled/displayed order.
- "tap-line": target is the 0-based line index into the snippet. Many tapped
  lines are structurally uninteresting (a blank line, a closing brace, a
  function signature) — for a line that is NOT a plausible location for this
  bug, write exactly one sentence saying what the line does and why the bug
  cannot be there, and set misconception to exactly "not-the-bug-site".
- "swipe-binary": there is exactly one wrong answer (the direction the player
  did not pick), so write exactly one entry with target 0.

Return entries for EXACTLY the targets you are asked for — no more, no
fewer, and never for the correct answer.`
}

function numberedLines(snippet: string): string {
  return snippet
    .split('\n')
    .map((line, index) => `${String(index)}: ${line}`)
    .join('\n')
}

function buildUserPrompt(
  puzzle: Puzzle,
  wrongTargets: number[],
  priorError: string | null,
): string {
  const lines: string[] = [
    `Puzzle id: ${puzzle.id}`,
    `Pattern: ${puzzle.pattern}`,
    `Language: ${puzzle.language}`,
    `Prompt shown to the player: ${puzzle.prompt}`,
    `Snippet:\n${puzzle.snippet}`,
    `Existing explanation (ground truth for what the bug actually is): ${puzzle.explanation}`,
  ]

  if (puzzle.interaction === 'mcq') {
    const correctText = puzzle.choices[puzzle.correct_choice]
    lines.push(
      `Correct choice (canonical index ${String(puzzle.correct_choice)}): "${String(correctText)}"`,
    )
    lines.push(
      'Write one entry for EACH of these wrong choices, keyed by canonical index into "choices":',
    )
    for (const target of wrongTargets) {
      lines.push(`  - target ${String(target)}: "${String(puzzle.choices[target])}"`)
    }
  } else if (puzzle.interaction === 'tap-line') {
    const snippetLines = puzzle.snippet.split('\n')
    lines.push(`Snippet, numbered (0-based):\n${numberedLines(puzzle.snippet)}`)
    lines.push(
      `Correct line: ${String(puzzle.correct_line)} ("${String(snippetLines[puzzle.correct_line])}")`,
    )
    lines.push('Write one entry for EACH of these tapped lines, keyed by 0-based line index:')
    for (const target of wrongTargets) {
      lines.push(`  - target ${String(target)}: "${String(snippetLines[target])}"`)
    }
  } else if (puzzle.interaction === 'swipe-binary') {
    const correctLabel =
      puzzle.correct_direction === 'left' ? puzzle.left_label : puzzle.right_label
    const wrongDirection = puzzle.correct_direction === 'left' ? 'right' : 'left'
    const wrongLabel = wrongDirection === 'left' ? puzzle.left_label : puzzle.right_label
    lines.push(
      `Left label: "${puzzle.left_label}", right label: "${puzzle.right_label}". Correct direction: ${puzzle.correct_direction} ("${correctLabel}"), correct_verdict: ${puzzle.correct_verdict}.`,
    )
    lines.push(
      `Write exactly one entry, target 0, explaining why the WRONG direction (${wrongDirection}, "${wrongLabel}") is wrong.`,
    )
  }

  if (priorError) {
    lines.push(
      '',
      'Your previous attempt failed validation with this error — fix the specific problem and return a complete, corrected set of entries:',
      priorError,
    )
  }

  return lines.join('\n')
}

/** entries' targets must be exactly `wrongTargets`, no more, no fewer — the model owns the prose, never the target list. */
function targetMismatchError(
  entries: readonly ExplanationEntry[],
  wrongTargets: number[],
): string | null {
  const got = new Set(entries.map((entry) => entry.target))
  const want = new Set(wrongTargets)
  const missing = wrongTargets.filter((target) => !got.has(target))
  const extra = [...got].filter((target) => !want.has(target))
  if (missing.length === 0 && extra.length === 0) return null
  const parts: string[] = []
  if (missing.length > 0) parts.push(`missing entries for target(s) ${missing.join(', ')}`)
  if (extra.length > 0) parts.push(`unexpected entries for target(s) ${extra.join(', ')}`)
  return `entries must target exactly [${wrongTargets.join(', ')}] — ${parts.join('; ')}.`
}

const { totals, log: logUsage } = createUsageTracker()

async function generateExplanationSet(
  backend: Backend,
  puzzle: Puzzle,
  wrongTargets: number[],
): Promise<ExplanationSet | null> {
  let lastError: string | null = null

  for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
    let parsed: unknown
    try {
      const response = await backend.generateStructured({
        model: GENERATE_MODEL,
        // 8192 measured too tight live: a 26-line tap-line puzzle (25 wrong
        // lines) already produced 6678 output tokens at ~267 tokens/entry,
        // and the largest tap-line snippet in the pool (cf-032) has 30 lines
        // (29 entries) — comfortably over 8192 at that rate. Sized well
        // past that worst case; a ceiling, not a target, so extra headroom
        // costs nothing unless the model actually uses it.
        maxTokens: 16384,
        systemPrompt: buildSystemPrompt(),
        userPrompt: buildUserPrompt(puzzle, wrongTargets, lastError),
        schema: EntriesRequestSchema,
      })
      logUsage(`generate ${puzzle.id} attempt ${String(attempt)}`, GENERATE_MODEL, response.usage)
      parsed = response.parsed
      if (parsed === null && response.parseFailureReason) {
        lastError = response.parseFailureReason
        console.warn(`    generate ${puzzle.id} attempt ${String(attempt)} threw: ${lastError}`)
        continue
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      console.warn(`    generate ${puzzle.id} attempt ${String(attempt)} threw: ${lastError}`)
      continue
    }

    const requestResult = EntriesRequestSchema.safeParse(parsed)
    if (!requestResult.success) {
      lastError = requestResult.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')
      console.warn(
        `    generate ${puzzle.id} attempt ${String(attempt)} failed validation: ${lastError}`,
      )
      continue
    }

    const mismatch = targetMismatchError(requestResult.data.entries, wrongTargets)
    if (mismatch) {
      lastError = mismatch
      console.warn(
        `    generate ${puzzle.id} attempt ${String(attempt)} failed validation: ${lastError}`,
      )
      continue
    }

    const candidate = {
      puzzle_id: puzzle.id,
      interaction: puzzle.interaction,
      generated_at: new Date().toISOString(),
      generator_version: GENERATOR_VERSION,
      entries: requestResult.data.entries,
    }
    const result = ExplanationSetSchema.safeParse(candidate)
    if (!result.success) {
      lastError = result.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')
      console.warn(
        `    generate ${puzzle.id} attempt ${String(attempt)} failed validation: ${lastError}`,
      )
      continue
    }

    return result.data
  }

  console.warn(
    `  FAILED ${puzzle.id}: exceeded ${String(MAX_GENERATION_ATTEMPTS)} generation attempts. Last error: ${lastError ?? 'unknown'}`,
  )
  return null
}

function explanationFilePath(puzzleId: string): string {
  return join(EXPLANATIONS_DIR, `${puzzleId}.json`)
}

function writeExplanationSet(set: ExplanationSet): void {
  mkdirSync(EXPLANATIONS_DIR, { recursive: true })
  writeFileSync(explanationFilePath(set.puzzle_id), JSON.stringify(set, null, 2) + '\n', 'utf-8')
}

/**
 * True when an existing, on-disk explanation file for `puzzle` already
 * satisfies it — schema-valid AND covering exactly the current wrong
 * targets (guards against a stale file left over from before the puzzle's
 * own choices/snippet changed). An invalid or incomplete file is always
 * regenerated, --force or not; --force additionally regenerates a file that
 * already satisfies this.
 */
function isAlreadySatisfied(puzzleId: string, wrongTargets: number[]): boolean {
  const path = explanationFilePath(puzzleId)
  if (!existsSync(path)) return false

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return false
  }

  const result = ExplanationSetSchema.safeParse(raw)
  if (!result.success) return false

  return targetMismatchError(result.data.entries, wrongTargets) === null
}

function parseFlagArg(name: string): string | null {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`))
  return arg ? arg.slice(name.length + 3) : null
}

function parsePatternArg(): PatternSlug | null {
  const value = parseFlagArg('pattern')
  if (value === null) return null
  if (!(PATTERN_SLUGS as readonly string[]).includes(value)) {
    throw new Error(`--pattern must be one of ${PATTERN_SLUGS.join(', ')}, got "${value}"`)
  }
  return value as PatternSlug
}

function parseInteractionArg(): ExplainableInteraction | null {
  const value = parseFlagArg('interaction')
  if (value === null) return null
  if (!isExplainableInteraction(value as Puzzle['interaction'])) {
    throw new Error(
      `--interaction must be one of ${EXPLAINABLE_INTERACTIONS.join(', ')}, got "${value}"`,
    )
  }
  return value as ExplainableInteraction
}

interface Target {
  readonly puzzle: Puzzle
  readonly wrongTargets: number[]
}

/**
 * Every explainable puzzle in the real, validated pool (mcq/tap-line/
 * swipe-binary — §10 defers scrubber/drag-order), grouped by pattern per
 * §4.3's "batch by pattern" run discipline, and filtered by --pattern/
 * --interaction if given. Throws if the pool itself is invalid — this
 * pipeline must never run against content that doesn't already pass
 * PuzzleSchema.
 */
function buildManifest(
  patternFilter: PatternSlug | null,
  interactionFilter: ExplainableInteraction | null,
): Target[] {
  const { valid, errors } = validatePuzzleFiles(loadRawPuzzleFiles())
  if (errors.length > 0) {
    throw new Error(
      `generate:explanations: puzzle pool has ${String(errors.length)} validation error(s) — fix them before generating explanations:\n${errors.join('\n')}`,
    )
  }

  const targets: Target[] = []
  for (const pattern of PATTERN_SLUGS) {
    if (patternFilter !== null && pattern !== patternFilter) continue
    const puzzlesInPattern = valid
      .map((entry) => entry.puzzle)
      .filter((puzzle) => puzzle.pattern === pattern)
      .filter((puzzle): puzzle is Puzzle => isExplainableInteraction(puzzle.interaction))
      .filter((puzzle) => interactionFilter === null || puzzle.interaction === interactionFilter)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

    for (const puzzle of puzzlesInPattern) {
      const wrongTargets = wrongTargetsFor(puzzle)
      if (wrongTargets === null) continue
      targets.push({ puzzle, wrongTargets })
    }
  }
  return targets
}

// Measured live across a small mixed mcq/tap-line sample before the real
// batch: mcq (~3 entries/puzzle) ran ~900-1200 output tokens; tap-line
// (~14-25 entries/puzzle) ran ~2700-6700. Blended against the full batch's
// actual entries/puzzle average (745 wrong answers / 99 puzzles ≈ 7.5) at
// ~290 tokens/entry observed, rather than a flat guess.
const EST_INPUT_TOKENS = 3800
const EST_OUTPUT_TOKENS = 2200
/** Conservative per-puzzle cost projection for --dry-run, plus a 25% buffer for the occasional validation retry. */
const PROJECTED_COST_PER_PUZZLE = costOf(GENERATE_MODEL, EST_INPUT_TOKENS, EST_OUTPUT_TOKENS) * 1.25
const PROJECTED_CALLS_PER_PUZZLE = 1
const PROJECTED_TOKENS_PER_PUZZLE = Math.round((EST_INPUT_TOKENS + EST_OUTPUT_TOKENS) * 1.25)

async function main(): Promise<void> {
  const isDryRun = process.argv.includes('--dry-run')
  const force = process.argv.includes('--force')
  const patternFilter = parsePatternArg()
  const interactionFilter = parseInteractionArg()
  const backendKind = parseBackendArg()

  const manifest = buildManifest(patternFilter, interactionFilter)
  const pending = force
    ? manifest
    : manifest.filter((t) => !isAlreadySatisfied(t.puzzle.id, t.wrongTargets))
  const alreadySatisfied = manifest.length - pending.length

  console.log(
    `generate:explanations: ${isDryRun ? 'DRY RUN' : 'FULL BATCH'} — backend=${backendKind} (${backendKind === 'cli' ? 'spends: Claude subscription usage' : 'spends: Console credits (USD)'})` +
      (patternFilter ? ` — pattern=${patternFilter}` : '') +
      (interactionFilter ? ` — interaction=${interactionFilter}` : '') +
      `\n${String(manifest.length)} puzzle(s) in scope, ${String(alreadySatisfied)} already satisfied (skipped${force ? ', but --force is set so all will regenerate' : ''}), ${String(pending.length)} to generate.`,
  )

  if (pending.length > 0) {
    const projectedCost = pending.length * PROJECTED_COST_PER_PUZZLE
    const projectedCalls = pending.length * PROJECTED_CALLS_PER_PUZZLE
    const projectedTokens = pending.length * PROJECTED_TOKENS_PER_PUZZLE
    if (backendKind === 'api') {
      console.log(
        `Projected cost: ~$${projectedCost.toFixed(4)} (${String(pending.length)} puzzle(s) x ~$${PROJECTED_COST_PER_PUZZLE.toFixed(4)}/puzzle, conservative estimate)`,
      )
    } else {
      console.log(
        `Projected usage: ~${String(projectedCalls)} call(s), ~${String(projectedTokens)} tokens — drawn from your Claude subscription's usage limits, not billed in dollars (notional $-equivalent if it had run on the api backend: ~$${projectedCost.toFixed(4)})`,
      )
    }
  }

  if (isDryRun || pending.length === 0) {
    if (pending.length === 0) console.log('generate:explanations: nothing to do.')
    return
  }

  const backend = createBackend(backendKind)

  let generated = 0
  const failed: string[] = []

  for (const { puzzle, wrongTargets } of pending) {
    if (backend.kind === 'api' && totals.costUsd >= COST_CEILING_USD) {
      console.warn(
        `\ngenerate:explanations: COST_CEILING_USD ($${COST_CEILING_USD.toFixed(2)}) reached at $${totals.costUsd.toFixed(4)} — stopping. ${String(pending.length - generated - failed.length)} puzzle(s) left un-attempted.`,
      )
      break
    }
    if (
      backend.kind === 'cli' &&
      (totals.callCount >= CLI_CALL_CEILING ||
        totals.inputTokens + totals.outputTokens >= CLI_TOKEN_CEILING)
    ) {
      console.warn(
        `\ngenerate:explanations: cli ceiling reached (${String(totals.callCount)} calls, ${String(totals.inputTokens + totals.outputTokens)} tokens) — stopping. ${String(pending.length - generated - failed.length)} puzzle(s) left un-attempted.`,
      )
      break
    }

    console.log(
      `=== ${puzzle.id} (${puzzle.pattern}, ${puzzle.interaction}, ${String(wrongTargets.length)} wrong answer(s)) ===`,
    )
    const set = await generateExplanationSet(backend, puzzle, wrongTargets)
    if (!set) {
      failed.push(puzzle.id)
      continue
    }

    writeExplanationSet(set)
    generated++
    console.log(`  WROTE ${puzzle.id}.json (${String(set.entries.length)} entries)`)
  }

  console.log(
    `\ngenerate:explanations: ${String(generated)} generated, ${String(alreadySatisfied)} skipped, ${String(failed.length)} failed. ` +
      `Total: ${String(totals.callCount)} call(s), in=${String(totals.inputTokens)} out=${String(totals.outputTokens)} tokens` +
      (backend.kind === 'api'
        ? `, ~$${totals.costUsd.toFixed(4)}.`
        : ` (subscription usage; notional ~$${totals.costUsd.toFixed(4)}).`),
  )
  if (failed.length > 0) {
    console.log(`Failed: ${failed.join(', ')}`)
    process.exitCode = 1
  }
}

// Only run as a side effect when this file is executed directly (`tsx
// .../generateExplanations.ts`) — see generatePuzzles.ts's identical guard
// for the bug this closes (a test importing this module for one pure export
// silently triggering a live generation run).
const isEntryPoint =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]
if (isEntryPoint) {
  main().catch((err: unknown) => {
    console.error(err)
    process.exitCode = 1
  })
}
