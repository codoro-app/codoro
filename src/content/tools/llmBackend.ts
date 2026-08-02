/**
 * Pluggable LLM backend seam (Phase 4 decision 4, docs/v2-build-plan.md).
 * One call shape — "generate JSON conforming to a Zod schema" — with two
 * implementations:
 *
 * - `api`: the Messages API via @anthropic-ai/sdk, using zodOutputFormat
 *   for real structured output. Bills a Claude Platform/Console account
 *   (ANTHROPIC_API_KEY) — kept for Phase 6 quiz volume and for whenever
 *   Console credits exist.
 * - `cli`: shells out to `claude -p` (Claude Code non-interactive mode)
 *   via node:child_process. Per Anthropic's help center (2026-06-15 pause
 *   notice), this draws on the invoking account's Claude subscription
 *   usage limits, not Console credits — the affordable path when there
 *   are no Console credits, which is why this is the default.
 *
 * Both return the SAME shape, and the caller (generatePuzzles.ts / the
 * scrubber pipeline) runs the SAME PuzzleSchema.safeParse (or equivalent)
 * over the result either way — that Zod pass is the one authoritative
 * check, per generatePuzzles.ts's own doc comment. This module's job stops
 * at "did the backend produce something JSON-shaped," which is exactly
 * the split Item 6 (docs/prompts/claude_code_prompt_v2_phase4.md) needs to
 * measure: a `parsed: null` result here is a backend-attributable
 * parse/format failure, never a semantic judgment about the puzzle.
 *
 * CLI backend auth note, verified empirically before relying on it: this
 * repo's `generate:puzzles` script runs as `tsx --env-file=.env`, so
 * ANTHROPIC_API_KEY (needed by the `api` backend above) is already in
 * `process.env` on every real invocation, not just this one. `claude -p`
 * prefers an API key over OAuth/subscription login whenever one is present
 * in its environment — confirmed live: a trivial call with the key present
 * billed $0.0116 to the API account, with the CLI's own warning naming the
 * precedence ("claude.ai connectors are disabled because ANTHROPIC_API_KEY
 * ... takes precedence"). Left unhandled, the `cli` backend would silently
 * bill the wrong account on every real run, defeating decision 4's whole
 * premise. `buildCliChildEnv` strips known Anthropic-auth env vars before
 * spawning the child; verified live that this removes the precedence
 * warning (i.e. actually flips the auth source, not just cosmetic).
 *
 * `--json-schema` + `--output-format json` were verified live against the
 * installed CLI (v2.1.220) before building against them, per this decision's
 * own instruction not to assume flag names from memory: the response
 * envelope carries a `structured_output` field already parsed against the
 * schema (in addition to a `result` string carrying the same JSON as text)
 * — materially better reliability than "prompt for JSON, extract it" would
 * have been. `MAX_GENERATION_ATTEMPTS` (generatePuzzles.ts) still absorbs
 * whatever parse-failure rate remains; Item 6 measures the real number
 * rather than assuming one.
 */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'

/**
 * Per-model pricing for the `api` backend's cost guard. The `cli` backend
 * spends no Console credits (it draws on subscription usage), so this
 * table and `costOf` are meaningless for it — see COST_CEILING_USD vs the
 * cli backend's own call/token ceiling in generatePuzzles.ts.
 *
 * Confirmed at https://platform.claude.com/docs/en/about-claude/pricing on
 * 2026-08-01. Sonnet 5's intro rate ($2/$10 per Mtok) expires 2026-08-31 —
 * re-confirm before trusting this for any api-backend run after that date;
 * the standard rate is $3/$15. Haiku 4.5 is $1/$5.
 */
export const MODEL_PRICING: Readonly<
  Record<string, { inputPerMtok: number; outputPerMtok: number }>
> = {
  'claude-sonnet-5': { inputPerMtok: 2, outputPerMtok: 10 },
  'claude-haiku-4-5-20251001': { inputPerMtok: 1, outputPerMtok: 5 },
}

/** Per-model, per decision 1: "the moment the models differ, the guard is silently wrong" against a single shared MODEL constant. */
export function costOf(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model]
  if (!pricing) {
    throw new Error(
      `costOf: no pricing configured for model "${model}" — add it to MODEL_PRICING in llmBackend.ts.`,
    )
  }
  return (
    (inputTokens / 1_000_000) * pricing.inputPerMtok +
    (outputTokens / 1_000_000) * pricing.outputPerMtok
  )
}

export type BackendKind = 'api' | 'cli'

export interface StructuredCallArgs {
  readonly model: string
  readonly systemPrompt: string
  readonly userPrompt: string
  readonly schema: z.ZodType
  readonly maxTokens: number
}

export interface StructuredCallUsage {
  readonly inputTokens: number
  readonly outputTokens: number
}

export interface StructuredCallResult {
  /**
   * Parsed JSON conforming to `schema`'s shape, or null if the backend
   * could not produce it — a parse/format failure, attributable to the
   * backend rather than model quality (Item 6's category 1). Still not
   * the authoritative check: the caller must run its own real Zod schema
   * (e.g. PuzzleSchema, with its cross-field superRefine rules) over this
   * regardless of backend.
   */
  readonly parsed: unknown
  readonly parseFailureReason: string | null
  readonly usage: StructuredCallUsage
}

export interface Backend {
  readonly kind: BackendKind
  generateStructured(args: StructuredCallArgs): Promise<StructuredCallResult>
}

// ---------------------------------------------------------------------------
// api backend
// ---------------------------------------------------------------------------

export function createApiBackend(): Backend {
  const client = new Anthropic()
  return {
    kind: 'api',
    async generateStructured(args: StructuredCallArgs): Promise<StructuredCallResult> {
      const response = await client.messages.parse({
        model: args.model,
        max_tokens: args.maxTokens,
        system: [{ type: 'text', text: args.systemPrompt, cache_control: { type: 'ephemeral' } }],
        output_config: { format: zodOutputFormat(args.schema) },
        messages: [{ role: 'user', content: args.userPrompt }],
      })
      const usage: StructuredCallUsage = {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      }
      if (response.parsed_output === null) {
        return {
          parsed: null,
          parseFailureReason: 'Model output did not conform to the requested JSON shape.',
          usage,
        }
      }
      return { parsed: response.parsed_output, parseFailureReason: null, usage }
    },
  }
}

// ---------------------------------------------------------------------------
// cli backend
// ---------------------------------------------------------------------------

/**
 * Only ANTHROPIC_API_KEY was empirically confirmed present in this repo's
 * .env; the other two are known alternate credential env vars for
 * Anthropic tooling generally, stripped defensively for the same reason
 * (a JS-realm escape isn't the threat model here — an ordinary env
 * variable being visible to the child process is).
 */
const ANTHROPIC_AUTH_ENV_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_API_KEY']

function buildCliChildEnv(): NodeJS.ProcessEnv {
  const excluded = new Set(ANTHROPIC_AUTH_ENV_VARS)
  const env: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (!excluded.has(key)) env[key] = value
  }
  return env
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

const CLAUDE_COMMAND_NAME = 'claude'
/** Generous headroom for a single generation/review call; a hang here would otherwise block the batch indefinitely (there is no other timeout on this synchronous spawn). */
const CLI_CALL_TIMEOUT_MS = 5 * 60 * 1000

let resolvedBinaryPath: string | null | undefined

/**
 * On win32, `spawnSync('claude', ...)` without `shell: true` fails with
 * ENOENT — confirmed live: Windows' CreateProcess (unlike a shell) does not
 * try PATHEXT extensions, and a bare `claude` on PATH here resolves to a
 * `.cmd` shim, not a directly-executable binary (`where claude` ->
 * `...\npm\claude` and `...\npm\claude.cmd`; neither spawns without a
 * shell). `shell: true` is deliberately not used as the fix: the
 * prompt/JSON-schema argv content would then go through cmd.exe's own
 * parsing, an injection and corruption hazard for content this pipeline
 * doesn't fully control (LLM-authored puzzle prompts, from Item 4 on).
 * Node itself blocks spawning a bare `.cmd`/`.bat` file without
 * `shell: true` (the CVE-2024-27980 fix), so neither the bare command name
 * nor the `.cmd` file directly are viable on Windows.
 *
 * The npm-global install's `.cmd` shim (the standard layout,
 * `%APPDATA%\npm\claude.cmd`) is a thin wrapper invoking a real,
 * directly-executable `claude.exe` — resolved here by locating the shim via
 * `where` (a real .exe, not a batch file — safe to spawn directly) and
 * reading the `.exe` path it wraps out of the shim's own text. Falls back
 * to the bare command name if any step of this fails, or on non-Windows
 * platforms where this whole problem doesn't exist (POSIX `execve`-based
 * spawning has no shim/PATHEXT ambiguity) — an `CLAUDE_CLI_BIN` env var
 * override is also honored first, for install layouts this heuristic
 * doesn't match. Resolved once and cached; a fresh generatePuzzles.ts
 * process is one batch run, not a long-lived server.
 */
function resolveClaudeBinary(): string {
  if (resolvedBinaryPath !== undefined) return resolvedBinaryPath ?? CLAUDE_COMMAND_NAME

  // Checked before the platform branch below (not after): the doc comment
  // above promises this override is "honored first" on every platform, not
  // just Windows — an install layout the win32 heuristic doesn't match can
  // exist on macOS/Linux too (e.g. a non-PATH install).
  const override = process.env.CLAUDE_CLI_BIN
  if (override) {
    resolvedBinaryPath = override
    return override
  }

  if (process.platform !== 'win32') {
    resolvedBinaryPath = null
    return CLAUDE_COMMAND_NAME
  }

  try {
    const whereResult = spawnSync('where', ['claude.cmd'], { encoding: 'utf8' })
    const shimPath = whereResult.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean)
    if (whereResult.status !== 0 || !shimPath) {
      resolvedBinaryPath = null
      return CLAUDE_COMMAND_NAME
    }
    const shimContent = readFileSync(shimPath, 'utf8')
    // Anchored to the literal "claude.exe" filename, not just any *.exe —
    // a looser match could pick up an unrelated interpreter the shim also
    // references (e.g. a bundled node.exe sitting in the same directory on
    // some install layouts) and silently spawn the wrong binary.
    const match = /"%dp0%\\(.+?\bclaude\.exe)"/.exec(shimContent)
    const relativeExePath = match?.[1]
    if (!relativeExePath) {
      resolvedBinaryPath = null
      return CLAUDE_COMMAND_NAME
    }
    const exePath = join(dirname(shimPath), relativeExePath)
    if (!existsSync(exePath)) {
      resolvedBinaryPath = null
      return CLAUDE_COMMAND_NAME
    }
    resolvedBinaryPath = exePath
    return exePath
  } catch {
    resolvedBinaryPath = null
    return CLAUDE_COMMAND_NAME
  }
}

/**
 * Fails loudly, once, before any generation attempt — per decision 4,
 * "fail loudly with a clear message... rather than silently falling
 * through to the other [backend]."
 */
function checkCliAvailable(): void {
  const binary = resolveClaudeBinary()
  const result = spawnSync(binary, ['--version'], {
    encoding: 'utf8',
    env: buildCliChildEnv(),
  })
  if (result.error || result.status !== 0) {
    const detail = result.error
      ? errorMessage(result.error)
      : result.stderr.trim() || `exited with code ${String(result.status)}`
    throw new Error(
      `CLI backend selected (--backend=cli, the default) but "${binary}" was not found or failed to run (${detail}). ` +
        `Install Claude Code and log in, or pass --backend=api to use the Messages API instead (requires ANTHROPIC_API_KEY and Console credits). ` +
        `If Claude Code is installed somewhere this couldn't find, set CLAUDE_CLI_BIN to the full path of its executable.`,
    )
  }
}

/** JSON Schema, not `$schema`-qualified — the installed CLI (v2.1.220) rejects a `$schema` pointing at a meta-schema URL it won't fetch ("no schema with key or ref ..."), confirmed live. */
function toCliJsonSchema(schema: z.ZodType): unknown {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>
  const rest = { ...jsonSchema }
  delete rest.$schema
  return rest
}

interface CliResultEnvelope {
  readonly is_error?: boolean
  readonly result?: string
  readonly structured_output?: unknown
  readonly usage?: {
    readonly input_tokens?: number
    readonly output_tokens?: number
    readonly cache_creation_input_tokens?: number
    readonly cache_read_input_tokens?: number
  }
}

export function createCliBackend(): Backend {
  checkCliAvailable()
  return {
    kind: 'cli',
    // eslint-disable-next-line @typescript-eslint/require-await -- spawnSync is synchronous; the async signature matches the Backend interface both implementations share.
    async generateStructured(args: StructuredCallArgs): Promise<StructuredCallResult> {
      const jsonSchema = toCliJsonSchema(args.schema)
      const spawnResult = spawnSync(
        resolveClaudeBinary(),
        [
          '-p',
          args.userPrompt,
          '--model',
          args.model,
          '--system-prompt',
          args.systemPrompt,
          '--output-format',
          'json',
          '--json-schema',
          JSON.stringify(jsonSchema),
          '--no-session-persistence',
          '--strict-mcp-config',
          '--tools',
          '',
        ],
        {
          encoding: 'utf8',
          env: buildCliChildEnv(),
          maxBuffer: 20 * 1024 * 1024,
          timeout: CLI_CALL_TIMEOUT_MS,
          // Away from this repo's directory so no project-specific context
          // (CLAUDE.md, git status, cwd-derived info) can leak into a
          // supposedly clean authoring call — the whole point of passing a
          // fully custom --system-prompt.
          cwd: tmpdir(),
        },
      )

      const zeroUsage: StructuredCallUsage = { inputTokens: 0, outputTokens: 0 }

      if (spawnResult.error) {
        const timedOut = (spawnResult.error as NodeJS.ErrnoException).code === 'ETIMEDOUT'
        return {
          parsed: null,
          parseFailureReason: timedOut
            ? `claude CLI timed out after ${String(CLI_CALL_TIMEOUT_MS)}ms`
            : `claude CLI failed to run: ${errorMessage(spawnResult.error)}`,
          usage: zeroUsage,
        }
      }
      if (spawnResult.status !== 0) {
        return {
          parsed: null,
          parseFailureReason: `claude CLI exited with code ${String(spawnResult.status)}: ${spawnResult.stderr.trim() || '(no stderr)'}`,
          usage: zeroUsage,
        }
      }

      let envelope: CliResultEnvelope
      try {
        const raw: unknown = JSON.parse(spawnResult.stdout)
        // The envelope's own fields are read defensively below (all
        // optional-chained), but `raw` itself must be an object before any
        // property access is attempted — a schema-valid-but-degenerate
        // response (e.g. the CLI printing `null` or a bare number) would
        // otherwise throw here and skip the caller's logUsage entirely,
        // undercounting a call that was actually spawned (and may have
        // consumed real usage) — exactly the failure mode the cli backend's
        // call/token ceiling exists to catch.
        if (typeof raw !== 'object' || raw === null) {
          return {
            parsed: null,
            parseFailureReason: `claude CLI's stdout was valid JSON but not an object: ${spawnResult.stdout.slice(0, 200)}`,
            usage: zeroUsage,
          }
        }
        envelope = raw
      } catch (err) {
        return {
          parsed: null,
          parseFailureReason: `claude CLI produced unparseable JSON on stdout: ${errorMessage(err)}`,
          usage: zeroUsage,
        }
      }

      const usage: StructuredCallUsage = {
        // cache_creation/cache_read tokens are still real input tokens for
        // the CLI backend's own call-count/token ceiling (there's no
        // "credits" concept there to reconcile against, unlike the api
        // backend's costOf) — folded into inputTokens rather than dropped.
        inputTokens:
          (envelope.usage?.input_tokens ?? 0) +
          (envelope.usage?.cache_creation_input_tokens ?? 0) +
          (envelope.usage?.cache_read_input_tokens ?? 0),
        outputTokens: envelope.usage?.output_tokens ?? 0,
      }

      if (envelope.is_error) {
        return {
          parsed: null,
          parseFailureReason: `claude CLI reported an error result: ${envelope.result ?? '(no result text)'}`,
          usage,
        }
      }

      if (envelope.structured_output !== undefined) {
        return { parsed: envelope.structured_output, parseFailureReason: null, usage }
      }

      // Fallback: structured_output should always be present when
      // --json-schema was honored, but if a future CLI version drops it,
      // parse `result` as JSON directly rather than failing outright.
      if (typeof envelope.result === 'string') {
        try {
          return { parsed: JSON.parse(envelope.result) as unknown, parseFailureReason: null, usage }
        } catch (err) {
          return {
            parsed: null,
            parseFailureReason: `claude CLI's result text did not parse as JSON: ${errorMessage(err)}`,
            usage,
          }
        }
      }

      return {
        parsed: null,
        parseFailureReason:
          'claude CLI response envelope had neither structured_output nor a result string.',
        usage,
      }
    },
  }
}

// ---------------------------------------------------------------------------
// selection
// ---------------------------------------------------------------------------

export function parseBackendArg(defaultBackend: BackendKind = 'cli'): BackendKind {
  const arg = process.argv.find((a) => a.startsWith('--backend='))
  if (!arg) return defaultBackend
  const value = arg.slice('--backend='.length)
  if (value === 'api' || value === 'cli') return value
  throw new Error(`--backend must be "api" or "cli", got "${value}"`)
}

export function createBackend(kind: BackendKind): Backend {
  return kind === 'api' ? createApiBackend() : createCliBackend()
}
