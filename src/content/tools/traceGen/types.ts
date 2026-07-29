/**
 * Shared trace output shape for both trace-generator backends (jsTraceGen.ts,
 * pyTraceGen.ts). Re-exports the Zod-inferred types from ../../schema.ts
 * rather than hand-duplicating an interface, so the generators are
 * structurally incapable of drifting from what ScrubberSchema will accept —
 * a shape mismatch here becomes a type error at the call site, not a
 * validate:content failure discovered later.
 *
 * The generator's job stops at `steps`: `checkpoints` (which steps to pause
 * at, and what to ask) is a human/LLM authoring decision, not something a
 * trace tool derives from execution.
 */
import type { z } from 'zod'
import type { ScrubberStepSchema } from '../../schema'

export type TraceStep = z.infer<typeof ScrubberStepSchema>

export interface TraceResult {
  readonly steps: readonly TraceStep[]
}

/**
 * Ceiling on the number of trace steps a single generation run may produce,
 * shared by both backends. A puzzle-worthy snippet is a handful of lines
 * executed at most a few dozen times; this is generous headroom above that
 * while still turning a runaway loop into a fast, clear failure instead of
 * a hang. Callers may override it (see each backend's options) — tests use
 * a tiny budget so a deliberately infinite snippet fails in milliseconds.
 */
export const DEFAULT_MAX_TRACE_STEPS = 2000

/**
 * Wall-clock backstop for each backend's execution, independent of the step
 * budget above. Exists for the case a step budget can't catch on its own —
 * an empty infinite loop body (`while (true) {}`) has no statement to
 * instrument, so nothing ever calls the trace hook to be counted.
 */
export const DEFAULT_TIMEOUT_MS = 2000
