/**
 * `pnpm author:scrubber-puzzles` — OFFLINE authoring harness for Trace-mode
 * (scrubber) content. Sibling to generateScrubberPuzzles.ts, but with the
 * model calls removed: you hand-author what the LLM pipeline's two model
 * passes would have produced (the snippet/metadata and the checkpoint
 * placements), and this tool performs the two local stages that pipeline
 * relies on for correctness — actually executing the snippet via the real
 * trace generator, and synthesizing answer choices from real trace state via
 * `synthesizeChoices` — then validates against the same `PuzzleSchema` and
 * writes only on pass. **No API call, no Anthropic token, no CLI/spawned
 * model.** This is the in-chat authoring path for the Phase 6 scrubber volume
 * batch (docs/v2-build-plan.md, Item 6): it makes schema "rejections"
 * structurally impossible, because a puzzle cannot be written unless its
 * steps came from a real execution, its choices came from that trace, and the
 * assembled file passes the exact validator `pnpm validate:content` uses.
 *
 * ## Intents file
 *
 * JSON array at the path given by `--intents=<path>`. Each intent:
 *
 * ```json
 * {
 *   "label": "authoring-only id, not written",
 *   "pattern": "control-flow",
 *   "language": "javascript",
 *   "difficulty_rating": 1550,
 *   "prompt": "Step through ... and predict what it prints.",
 *   "explanation": "The bug is ...",
 *   "snippet": "line 0\nline 1...",
 *   "checkpoints": [
 *     { "afterStep": 3, "question": "var-value", "target": "x" },
 *     { "afterStep": 9, "question": "output" },
 *     { "afterStep": 10, "question": "next-line" }
 *   ]
 * }
 * ```
 *
 * `checkpoints` is optional and drives the two modes:
 *
 * - **`--preview`** (Phase A): executes each snippet and prints its real
 *   trace so checkpoint placements can be chosen against actual steps.
 *   Checkpoints in the intent, if any, are also previewed as synthesized
 *   choices. Never writes.
 * - **default** (Phase B): with checkpoints present, synthesizes choices,
 *   assembles the full puzzle, validates it, and writes it. Skips (does not
 *   patch) any intent that fails validation or the authoring rules below.
 *
 * ## Authoring rules enforced before write (this batch's quality bar)
 *
 * - **6–8 checkpoints** per puzzle (schema floor is 2 / ceiling is 8; this
 *   batch targets 6–8).
 * - **≥2 distinct question types** across `next-line` / `var-value` /
 *   `output` (typically one of each) — the mix the user asked for.
 * - Every checkpoint must be structurally serveable by the trace
 *   (var-value target present with a distinct historical value, output on a
 *   step that printed, etc.); one that isn't fails the intent rather than
 *   being patched with invented choices — the pipeline's existing
 *   drop-don't-patch convention.
 * - The assembled puzzle passes `PuzzleSchema.safeParse`.
 *
 * Ids are assigned per pattern from the on-disk counters (shared prefix
 * namespace with every other puzzle, `createIdCounters`), so a write never
 * collides and reruns are safe.
 */
import { readFileSync } from 'node:fs'
import process from 'node:process'
import { z } from 'zod'
import { PuzzleSchema } from '../schema'
import type { PatternSlug } from '../patterns'
import { synthesizeChoices } from './generateScrubberPuzzles'
import { createIdCounters, writePuzzle } from './puzzleAuthoringShared'
import { generateJsTrace } from './traceGen/jsTraceGen'
import { generatePyTrace } from './traceGen/pyTraceGen'
import type { TraceResult } from './traceGen/types'

// Long wall-clock backstop: the JS backend spawns a fresh node child process
// per snippet, and a Windows cold start can exceed the traceGen default
// (2s). 15s is generous headroom above a ~1s warm trace with no realistic
// downside, while still turning a runaway snippet into a fast, clear failure
// rather than a hang (the default 2000-step budget still catches empty-body
// loops on its own).
const TRACE_TIMEOUT_MS = 15000

const LANGUAGE = z.enum(['javascript', 'python'])
const QUESTION = z.enum(['next-line', 'var-value', 'output'])

/** Scrubber allowlist — mirrors generateScrubberPuzzles.ts's decision 6. Enumerating it as the intent schema's `pattern` field means authoring is type-checked against it at parse time. */
const SCRUBBER_PATTERN_ALLOWLIST: readonly PatternSlug[] = [
  'off-by-one',
  'mutable-state',
  'scope-closures',
  'type-coercion',
  'control-flow',
  'recursion-termination',
  'data-structure-misuse',
]
const PATTERN_ENUM = z.enum(
  SCRUBBER_PATTERN_ALLOWLIST as unknown as [PatternSlug, ...PatternSlug[]],
)

const AuthorCheckpointSchema = z.object({
  afterStep: z.number().int().nonnegative(),
  question: QUESTION,
  target: z.string().min(1).optional(),
})

const AuthorIntentSchema = z.object({
  // Authoring-only label (index/tag), never written to disk.
  label: z.string().min(1),
  pattern: PATTERN_ENUM,
  language: LANGUAGE,
  difficulty_rating: z.number().int().min(800).max(2400),
  prompt: z.string().min(1),
  explanation: z.string().min(1),
  snippet: z.string().min(1),
  checkpoints: z.array(AuthorCheckpointSchema).min(2).max(8).optional(),
})

type AuthorIntent = z.infer<typeof AuthorIntentSchema>
type AuthorCheckpoint = AuthorIntent['checkpoints'] extends readonly (infer T)[] | undefined
  ? T
  : never

function formatTraceForPrompt(trace: TraceResult): string {
  return trace.steps
    .map((step, i) => {
      const vars = Object.entries(step.vars)
        .map(([k, v]) => `${k}=${v}`)
        .join(', ')
      const output = step.output !== undefined ? ` | printed: ${step.output}` : ''
      return `  step ${String(i)}: line ${String(step.line)} | ${vars}${output}`
    })
    .join('\n')
}

/** Requires every intent's pattern be in the scrubber allowlist (already enforced at parse time by PATTERN_ENUM's type) and fields well-formed. */
function loadIntents(path: string): AuthorIntent[] {
  const raw = readFileSync(path, 'utf-8')
  const parsed: unknown = JSON.parse(raw)
  const list = Array.isArray(parsed) ? parsed : ((parsed as { puzzles?: unknown[] }).puzzles ?? [])
  const intents = list.map((item, i) => {
    const result = AuthorIntentSchema.safeParse({ ...(item as object), label: `#${String(i + 1)}` })
    if (!result.success) {
      throw new Error(
        `intents[${String(i)}] invalid: ${result.error.issues
          .map((iss) => `${iss.path.join('.')}: ${iss.message}`)
          .join('; ')}`,
      )
    }
    return result.data
  })
  return intents
}

async function runTrace(intent: AuthorIntent): Promise<TraceResult> {
  return intent.language === 'javascript'
    ? generateJsTrace(intent.snippet, { timeoutMs: TRACE_TIMEOUT_MS })
    : generatePyTrace(intent.snippet, { timeoutMs: TRACE_TIMEOUT_MS })
}

/** Number of distinct question kinds across a checkpoint list — this batch requires ≥2. */
export function distinctQuestionTypes(checkpoints: readonly AuthorCheckpoint[]): number {
  return new Set(checkpoints.map((c) => c.question)).size
}

/**
 * Synthesizes every checkpoint's choices from the trace. Returns the
 * synthesized checkpoints on full success, or a list of failure reasons (one
 * per checkpoint that couldn't be served). Never invents choices.
 */
function synthesizeAll(
  trace: TraceResult,
  checkpoints: readonly AuthorCheckpoint[],
): { ok: true; synthesized: CandidateCheckpoint[] } | { ok: false; failures: string[] } {
  const synthesized: CandidateCheckpoint[] = []
  const failures: string[] = []
  for (const placement of checkpoints) {
    const result = synthesizeChoices(trace, placement)
    if (result === null) {
      failures.push(
        `afterStep=${String(placement.afterStep)} (${placement.question})${
          placement.target !== undefined ? ` target=${placement.target}` : ''
        }: no serveable choices in this trace`,
      )
      continue
    }
    synthesized.push({
      afterStep: placement.afterStep,
      question: placement.question,
      ...(placement.target !== undefined ? { target: placement.target } : {}),
      choices: [...result.choices],
      correct: result.correct,
    })
  }
  return failures.length > 0 ? { ok: false, failures } : { ok: true, synthesized }
}

interface CandidateCheckpoint {
  afterStep: number
  question: 'next-line' | 'var-value' | 'output'
  target?: string
  choices: string[]
  correct: number
}

/** Authoring rules that go beyond PuzzleSchema: 6–8 checkpoints and ≥2 question types. */
export function authoringRuleViolations(
  checkpoints: readonly CandidateCheckpoint[],
): string | null {
  if (checkpoints.length < 6 || checkpoints.length > 8) {
    return `expected 6-8 checkpoints, got ${String(checkpoints.length)}`
  }
  if (distinctQuestionTypes(checkpoints) < 2) {
    return `needs >=2 distinct question types across next-line/var-value/output, got only ${String(new Set(checkpoints.map((c) => c.question)).size)} type(s)`
  }
  return null
}

function parseIntentsPath(): string | null {
  const arg = process.argv.find((a) => a.startsWith('--intents='))
  return arg ? arg.slice('--intents='.length) : null
}

async function main(): Promise<void> {
  const path = parseIntentsPath()
  if (!path) {
    console.error('author:scrubber-puzzles: pass --intents=<path-to-json>')
    process.exitCode = 1
    return
  }
  const isPreview = process.argv.includes('--preview')
  const intents = loadIntents(path)
  const counters = createIdCounters()

  for (const intent of intents) {
    let trace: TraceResult
    try {
      trace = await runTrace(intent)
    } catch (err) {
      console.error(
        `  EXEC FAIL ${intent.label} (${intent.pattern}/${intent.language}): ${err instanceof Error ? err.message : String(err)}`,
      )
      continue
    }
    if (trace.steps.length < 4) {
      console.warn(`  TOO SHORT ${intent.label}: trace only ${String(trace.steps.length)} step(s)`)
    }

    if (intent.checkpoints === undefined || isPreview) {
      // Phase A: preview the real trace (and choice synthesis if present). No write.
      console.log(
        `\n=== ${intent.label} (${intent.pattern}, ${intent.language}, rating ${String(intent.difficulty_rating)}) ===`,
      )
      console.log(formatTraceForPrompt(trace))
      if (intent.checkpoints !== undefined) {
        const result = synthesizeAll(trace, intent.checkpoints)
        if (result.ok) {
          console.log(
            `  checkpoints: ${result.synthesized.map((c) => `[${String(c.afterStep)}:${c.question}${c.target !== undefined ? ` ${c.target}` : ''} correct=${String(c.correct)}]`).join(' ')}`,
          )
        } else {
          console.log(`  checkpoint synthesis failures: ${result.failures.join(' | ')}`)
        }
      }
      continue
    }

    // Phase B: synthesize, assemble, validate, write on pass.
    const synth = synthesizeAll(trace, intent.checkpoints)
    if (!synth.ok) {
      console.warn(`  SKIP ${intent.label}: ${synth.failures.join(' | ')}`)
      continue
    }
    const ruleIssue = authoringRuleViolations(synth.synthesized)
    if (ruleIssue !== null) {
      console.warn(`  SKIP ${intent.label}: ${ruleIssue}`)
      continue
    }

    const id = counters.peek(intent.pattern)
    const candidate = {
      id,
      pattern: intent.pattern,
      difficulty_rating: intent.difficulty_rating,
      explanation: intent.explanation,
      prompt: intent.prompt,
      language: intent.language,
      snippet: intent.snippet,
      interaction: 'scrubber' as const,
      steps: trace.steps,
      checkpoints: synth.synthesized,
    }
    const result = PuzzleSchema.safeParse(candidate)
    if (!result.success) {
      console.warn(
        `  SKIP ${intent.label}: schema rejected — ${result.error.issues
          .map((iss) => `${iss.path.join('.')}: ${iss.message}`)
          .join('; ')}`,
      )
      continue
    }

    writePuzzle(result.data)
    counters.commit(intent.pattern, id)
    console.log(
      `  WROTE ${id} (${intent.pattern}, ${intent.language}, rating ${String(intent.difficulty_rating)}, ${String(synth.synthesized.length)} checkpoints)`,
    )
  }
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
