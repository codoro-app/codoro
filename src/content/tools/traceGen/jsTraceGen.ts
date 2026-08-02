/**
 * JS backend for scrubber trace generation. The actual instrumentation
 * (@babel/core) and node:vm sandbox execution happen in jsTracer.mjs, run
 * as a child process — this file is a thin, synchronous transport wrapper
 * around it, mirroring pyTraceGen.ts's role for the Python backend (though
 * pyTraceGen.ts is async since Python already ran in a subprocess; this
 * backend stays synchronous via `spawnSync` specifically to preserve its
 * existing public signature and test suite unchanged — see OD-2,
 * docs/v2-build-plan.md).
 *
 * Why a child process at all: node:vm's isolation is NOT a security
 * boundary (Node's own docs say so), and a crafted snippet can escape it —
 * `this.constructor.constructor('return process')()` resolves the real
 * host `process` object, including `process.env` and its Anthropic API key,
 * from inside what looks like a sandbox. Fine while snippets were
 * hand-authored ("my own code"); not fine once Phase 4 runs LLM-generated
 * snippets unattended, dozens of times, where the threat model changes to
 * "code I did not write." Running jsTracer.mjs as its own OS process means
 * an escape there reaches only that child's own `process`, never this
 * one's — the same isolation the Python backend already had via
 * pyTraceGen.ts/pyTracer.py. Two further, separate measures close what the
 * OS-process boundary alone does not: `buildChildEnv` below keeps the
 * child's *environment* from carrying this process's secrets (an escape
 * reaches the child's own real `process.env`, which would otherwise still
 * carry an inherited API key one process hop away instead of zero), and
 * jsTracer.mjs deletes every own property of the real `process` object
 * except the inert `exitCode` before running any untrusted code (native
 * internals like `process.getBuiltinModule`/`process.binding` reach raw
 * file reads and command execution regardless of what's in `process.env`,
 * and are independent escape hatches off the same real `process` object —
 * an earlier blocklist of just `binding`/`dlopen` missed
 * `getBuiltinModule`, which is why this is an allowlist now, not a
 * blocklist; see jsTracer.mjs's own doc comment). Together these close
 * the concrete vectors OD-2 names; this is still not a general-purpose
 * arbitrary-code sandbox, and isn't trying to be one — see
 * docs/v2-build-plan.md's OD-2 row for the stated scope.
 *
 * Trace ground truth is still the result of actually running the code —
 * see docs/v2-build-plan.md's "Trace ground truth" locked decision — never
 * asserted by hand or an LLM; only *where* it runs changed here.
 */
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_MAX_TRACE_STEPS, DEFAULT_TIMEOUT_MS } from './types'
import type { TraceResult } from './types'

export interface GenerateJsTraceOptions {
  readonly maxSteps?: number
  readonly timeoutMs?: number
}

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const TRACER_SCRIPT = path.join(currentDir, 'jsTracer.mjs')

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Deliberately NOT `{ ...process.env }`: unlike the Python backend (whose
 * restricted builtins block any path to `os.environ` regardless of what the
 * child's env holds), a JS escape reaches the child's own real global
 * `process` object directly — so if the child inherited the full parent
 * environment, `process.env.ANTHROPIC_API_KEY` would still be one process
 * hop away instead of zero, which is exactly the blast radius OD-2 exists
 * to close. Only what the Node runtime itself needs to start cleanly is
 * allowlisted; nothing else from the orchestrator's environment (API keys
 * included) crosses into the child.
 */
function buildChildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  if (process.env.PATH !== undefined) env.PATH = process.env.PATH
  // Windows needs SystemRoot/TEMP for internal OS calls (winsock/crypto,
  // temp-file handling) even in an otherwise-minimal child environment —
  // omitting them can make node's own startup misbehave on win32. No-ops on
  // other platforms since these vars won't be set there.
  if (process.env.SystemRoot !== undefined) env.SystemRoot = process.env.SystemRoot
  if (process.env.TEMP !== undefined) env.TEMP = process.env.TEMP
  if (process.env.TMP !== undefined) env.TMP = process.env.TMP
  return env
}

/**
 * Instruments and runs `snippet` in an isolated child process, returning
 * one TraceStep per executed line. Throws if the snippet exceeds `maxSteps`
 * (default DEFAULT_MAX_TRACE_STEPS, enforced inside jsTracer.mjs) or
 * `timeoutMs` (default DEFAULT_TIMEOUT_MS) wall-clock, enforced here via
 * `spawnSync`'s own `timeout` option against the child hanging, or if the
 * snippet itself throws (a puzzle snippet must actually run to
 * completion). Synchronous by design — see this file's doc comment for why
 * that's a deliberate constraint, not an oversight.
 */
export function generateJsTrace(
  snippet: string,
  options: GenerateJsTraceOptions = {},
): TraceResult {
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_TRACE_STEPS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const result = spawnSync(process.execPath, [TRACER_SCRIPT], {
    input: JSON.stringify({ snippet, maxSteps, timeoutMs }),
    timeout: timeoutMs,
    encoding: 'utf8',
    env: buildChildEnv(),
    // Generous headroom over a puzzle-worthy snippet's real output size —
    // this is a safety ceiling against a runaway trace's JSON blowing past
    // Node's default buffer, not a budget; DEFAULT_MAX_TRACE_STEPS already
    // bounds step count well before this would matter in practice.
    maxBuffer: 10 * 1024 * 1024,
  })

  if (result.error) {
    // Checked on `.code` alone, not `result.signal !== null`: a
    // maxBuffer overflow also kills the child with a signal, and
    // misreporting that as "timed out" would hide the real cause.
    const timedOut = (result.error as NodeJS.ErrnoException).code === 'ETIMEDOUT'
    if (timedOut) {
      throw new Error(`generateJsTrace: timed out after ${String(timeoutMs)}ms`)
    }
    throw new Error(`generateJsTrace: ${errorMessage(result.error)}`)
  }

  if (result.status !== 0) {
    throw new Error(
      `generateJsTrace: ${result.stderr.trim() || `tracer exited with code ${String(result.status)}`}`,
    )
  }

  try {
    return JSON.parse(result.stdout) as TraceResult
  } catch (err) {
    throw new Error(`generateJsTrace: failed to parse tracer output: ${errorMessage(err)}`, {
      cause: err,
    })
  }
}
