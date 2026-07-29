/**
 * Python backend for scrubber trace generation: spawns `python3
 * pyTracer.py` as a subprocess and pairs its own sys.settrace instrumented
 * output with this generator's contract. Unlike the JS backend, no
 * instrumentation step is needed on this side — pyTracer.py drives a real
 * interpreter-level trace hook, so pairing "line about to run" events into
 * "line that just ran" steps happens entirely in Python. See pyTracer.py's
 * module docstring for that algorithm.
 *
 * Node <-> Python transport: the snippet + options go to the child's stdin
 * as one JSON payload (avoids argv-escaping a snippet containing quotes/
 * newlines); on success the child writes exactly one JSON blob to stdout
 * and exits 0, on failure it writes a message to stderr and exits non-zero
 * — success/failure is never ambiguous between "valid JSON on stdout" and
 * "readable error on stderr".
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DEFAULT_MAX_TRACE_STEPS, DEFAULT_TIMEOUT_MS } from './types'
import type { TraceResult } from './types'

export interface GeneratePyTraceOptions {
  readonly maxSteps?: number
  readonly timeoutMs?: number
}

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const TRACER_SCRIPT = path.join(currentDir, 'pyTracer.py')

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Runs `snippet` under pyTracer.py's sys.settrace harness, returning one
 * TraceStep per executed line. Rejects if the snippet exceeds `maxSteps`
 * (default DEFAULT_MAX_TRACE_STEPS) — enforced inside the Python harness,
 * which sees every executed line unconditionally, so unlike the JS
 * backend's babel instrumentation this alone catches even an empty-body
 * infinite loop — or `timeoutMs` (default DEFAULT_TIMEOUT_MS) wall-clock,
 * a defensive backstop enforced here on the Node side against the
 * subprocess itself hanging, or if the snippet throws / touches anything
 * outside the sandboxed builtins (e.g. `open`, `import`).
 */
export async function generatePyTrace(
  snippet: string,
  options: GeneratePyTraceOptions = {},
): Promise<TraceResult> {
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_TRACE_STEPS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return new Promise<TraceResult>((resolve, reject) => {
    const child = spawn('python3', [TRACER_SCRIPT], {
      // PYTHONHASHSEED pins str/set/frozenset hash order — without it,
      // set/frozenset repr order (and some dict-construction paths) are
      // randomized per-process, which would make traces nondeterministic
      // across subprocess restarts.
      env: { ...process.env, PYTHONHASHSEED: '0' },
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(new Error(`generatePyTrace: timed out after ${String(timeoutMs)}ms`))
    }, timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })

    child.on('error', (err: unknown) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err instanceof Error ? err : new Error(errorMessage(err)))
    })

    child.on('close', (code: number | null) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) {
        try {
          resolve(JSON.parse(stdout) as TraceResult)
        } catch (err) {
          reject(new Error(`generatePyTrace: failed to parse tracer output: ${errorMessage(err)}`))
        }
        return
      }
      reject(
        new Error(`generatePyTrace: ${stderr.trim() || `tracer exited with code ${String(code)}`}`),
      )
    })

    child.stdin.write(JSON.stringify({ snippet, maxSteps }))
    child.stdin.end()
  })
}
