/**
 * Shared authoring-pipeline plumbing between generatePuzzles.ts (quiz) and
 * generateScrubberPuzzles.ts (scrubber, Phase 4 Item 4) — the parts Item 4's
 * design call (docs/prompts/claude_code_prompt_v2_phase4.md) identified as
 * "worth reusing": per-pattern id assignment, writing a puzzle to disk, the
 * calibration rubric text, and per-model cost/usage accounting. Deliberately
 * has no `main()` and no top-level generation side effects, unlike either
 * pipeline file — importing this module never starts a generation run,
 * which is exactly why the two-pass scrubber shape and the quiz manifest
 * live in separate sibling files rather than one importing the other's
 * `main()`-on-import module.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Puzzle } from '../schema'
import type { PatternSlug } from '../patterns'
import { loadRawPuzzleFiles } from './loadPuzzles'
import { costOf } from './llmBackend'

/** Short, stable per-pattern id prefix. Once assigned, never change — ids are forever. */
export const PATTERN_PREFIXES: Record<PatternSlug, string> = {
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
export const CALIBRATION = readFileSync(join(CONTENT_DIR, 'CALIBRATION.md'), 'utf-8')

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

export interface IdCounters {
  /** Returns the next id without consuming it — call commit() only after a successful write. */
  peek(pattern: PatternSlug): string
  commit(pattern: PatternSlug, id: string): void
}

/** Reads existing ids off disk once (both quiz and scrubber puzzles share one prefix namespace per pattern) and hands back a peek/commit pair. */
export function createIdCounters(): IdCounters {
  const counters = loadExistingCounters()
  return {
    peek(pattern: PatternSlug): string {
      const prefix = PATTERN_PREFIXES[pattern]
      const next = (counters.get(prefix) ?? 0) + 1
      return `${prefix}-${String(next).padStart(3, '0')}`
    },
    commit(pattern: PatternSlug, id: string): void {
      const prefix = PATTERN_PREFIXES[pattern]
      const num = Number(id.slice(prefix.length + 1))
      counters.set(prefix, Math.max(counters.get(prefix) ?? 0, num))
    },
  }
}

export function writePuzzle(puzzle: Puzzle): void {
  const dir = join(PUZZLES_DIR, puzzle.pattern)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, `${puzzle.id}.json`), JSON.stringify(puzzle, null, 2) + '\n', 'utf-8')
}

export interface UsageTotals {
  callCount: number
  inputTokens: number
  outputTokens: number
  costUsd: number
}

export interface UsageTracker {
  readonly totals: UsageTotals
  readonly log: (
    label: string,
    model: string,
    usage: { inputTokens: number; outputTokens: number },
  ) => void
}

/**
 * costUsd accumulates via costOf(model, ...) per call, never by summing raw
 * tokens across calls and pricing the total at one rate — see
 * generatePuzzles.ts's per-model cost guard comment for why that aggregate
 * approach is the exact bug class Phase 4's Item 1 fix closes.
 * callCount/inputTokens/outputTokens still accumulate as simple totals
 * since the cli backend's ceiling is denominated in calls and tokens
 * directly, not dollars. Returns a fresh tracker per call — the quiz and
 * scrubber pipelines each run as their own process, so nothing is ever
 * shared between them; a shared instance would be a correctness bug in a
 * hypothetical future where both ran in the same process, not a real one.
 */
export function createUsageTracker(): UsageTracker {
  const totals: UsageTotals = { callCount: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }
  return {
    totals,
    log: (label, model, usage) => {
      totals.callCount += 1
      totals.inputTokens += usage.inputTokens
      totals.outputTokens += usage.outputTokens
      try {
        totals.costUsd += costOf(model, usage.inputTokens, usage.outputTokens)
      } catch (err) {
        // Only the api backend's dollar-ceiling guard actually needs this
        // number — the cli backend's ceiling is calls/tokens, not dollars,
        // so an unpriced model here (e.g. MODEL_PRICING missing an entry)
        // must never discard a call that already happened. Cost tracking
        // degrades to "unknown," never fatal.
        console.warn(
          `    [${label}] cost tracking skipped (${err instanceof Error ? err.message : String(err)})`,
        )
      }
      console.log(
        `    [${label}] model=${model} in=${String(usage.inputTokens)} out=${String(usage.outputTokens)} — running total: ${String(totals.callCount)} call(s), ${String(totals.inputTokens + totals.outputTokens)} tokens, ~$${totals.costUsd.toFixed(4)}`,
      )
    },
  }
}
