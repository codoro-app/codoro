/**
 * JS backend for scrubber trace generation: instruments a snippet with
 * @babel/core (inserting a call to a trace hook after/around each
 * executable statement), then runs the instrumented code in a node:vm
 * sandbox with no I/O and a step budget. The trace ground truth is the
 * result of actually running the code — see docs/v2-build-plan.md's
 * "Trace ground truth" locked decision — never asserted by hand or an LLM.
 *
 * What counts as a traced "step": every ExpressionStatement, VariableDeclaration,
 * ReturnStatement, BreakStatement, ContinueStatement, and ThrowStatement gets a
 * trace call immediately after it (a "leaf" step). Every IfStatement, ForStatement,
 * WhileStatement, and DoWhileStatement additionally gets a "header" trace call
 * inserted as the first statement of each block it controls (consequent/alternate/
 * body), representing "this control-flow line was reached" — critically, inside the
 * body means it fires once per loop iteration, not once total. A loop's own
 * init/test/update clauses are not separately traced; the header call covers "the
 * line was reached," and the body's own statements show state as it evolves.
 *
 * Known limitation, acceptable for a spike (flagged in the Phase 2 go/no-go
 * amendment if a pilot needs more): a condition that evaluates false is not
 * itself traced — you see the last true header/body, then whatever comes after
 * the loop, not a step showing the failing check itself.
 */
import { transformSync } from '@babel/core'
import * as t from '@babel/types'
import type { NodePath, PluginObject } from '@babel/core'
import vm from 'node:vm'
import { DEFAULT_MAX_TRACE_STEPS, DEFAULT_TIMEOUT_MS } from './types'
import type { TraceResult, TraceStep } from './types'

const TRACE_FN = '__codoro_trace'

/**
 * Run once per sandbox, before the instrumented snippet, to make the three
 * reachable nondeterministic APIs fail loudly instead of silently producing
 * a different trace on every run (P2, docs/v2-phase2-review.md). `new
 * Date(...)` with at least one explicit argument is passed through
 * unchanged — that form is genuinely deterministic.
 */
const NONDETERMINISM_GUARD = `
  Math.random = function random() {
    throw new Error(
      'generateJsTrace: Math.random() is not allowed in a trace snippet — traces must be deterministic (reproducible byte-for-byte). Remove the randomness or make it an explicit, fixed input instead.'
    )
  }
  Date = new Proxy(Date, {
    construct(target, args) {
      if (args.length === 0) {
        throw new Error(
          'generateJsTrace: new Date() with no arguments is not allowed in a trace snippet — it is not deterministic. Pass explicit arguments, e.g. new Date(2024, 0, 1), if you need a fixed date.'
        )
      }
      return Reflect.construct(target, args)
    },
    apply() {
      throw new Error(
        'generateJsTrace: Date() called as a function (not "new Date(...)") is not allowed in a trace snippet — it always returns the current time and is never deterministic.'
      )
    },
    get(target, prop, receiver) {
      if (prop === 'now') {
        return function now() {
          throw new Error(
            'generateJsTrace: Date.now() is not allowed in a trace snippet — it is not deterministic.'
          )
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })
`

export interface GenerateJsTraceOptions {
  readonly maxSteps?: number
  readonly timeoutMs?: number
}

/**
 * Every node the plugin itself constructs (a trace-call statement and its
 * snapshot IIFE's internals — the synthetic `var __v = {}`, its try/catch
 * assignments, etc.) gets added here so the visitor below can recognize
 * and skip its own output. This is the correctness mechanism, not
 * `path.skip()`: Babel's traversal queue still walks into a freshly
 * inserted/unshifted subtree (that's by design, so a plugin CAN
 * instrument its own output if it wants to), and those synthetic nodes
 * were built with `t.*`, never parsed from source, so they have no
 * `.loc` — visiting them as if they were real snippet code crashes
 * `line0`. Scoped fresh per generateJsTrace call (see createTracePlugin)
 * so nothing leaks across snippets.
 */
type InjectedNodes = WeakSet<t.Node>

/** Builds `(function () { var __v = {}; try { __v["name"] = name } catch (e) {} ... return __v })()`, marking every node it creates as injected. */
function buildSnapshotExpression(names: readonly string[], injected: InjectedNodes): t.Expression {
  const mark = <N extends t.Node>(node: N): N => {
    injected.add(node)
    return node
  }

  const vId = mark(t.identifier('__v'))
  const assigns = names.map((name) =>
    mark(
      t.tryStatement(
        mark(
          t.blockStatement([
            mark(
              t.expressionStatement(
                mark(
                  t.assignmentExpression(
                    '=',
                    mark(t.memberExpression(vId, mark(t.stringLiteral(name)), true)),
                    mark(t.identifier(name)),
                  ),
                ),
              ),
            ),
          ]),
        ),
        mark(t.catchClause(mark(t.identifier('__e')), mark(t.blockStatement([])))),
      ),
    ),
  )
  const body = mark(
    t.blockStatement([
      mark(
        t.variableDeclaration('var', [
          mark(t.variableDeclarator(vId, mark(t.objectExpression([])))),
        ]),
      ),
      ...assigns,
      mark(t.returnStatement(vId)),
    ]),
  )
  return mark(t.callExpression(mark(t.functionExpression(null, [], body)), []))
}

function buildTraceCall(
  line0Indexed: number,
  names: readonly string[],
  injected: InjectedNodes,
): t.ExpressionStatement {
  const call = t.expressionStatement(
    t.callExpression(t.identifier(TRACE_FN), [
      t.numericLiteral(line0Indexed),
      buildSnapshotExpression(names, injected),
    ]),
  )
  injected.add(call)
  return call
}

function bindingNamesInScope(path: NodePath): string[] {
  return Object.keys(path.scope.getAllBindings())
}

function line0(node: { loc?: t.SourceLocation | null }): number {
  const line = node.loc?.start.line
  if (line === undefined) {
    throw new Error('line0: node has no location information')
  }
  return line - 1
}

/** Ensures a loop/if branch body is a BlockStatement (so a header trace has somewhere to be inserted), wrapping a bare statement if needed. */
function ensureBlock(path: NodePath<t.Statement>): NodePath<t.BlockStatement> {
  if (!path.isBlockStatement()) {
    path.replaceWith(t.blockStatement([path.node]))
  }
  return path as NodePath<t.BlockStatement>
}

function insertTraceAfter(path: NodePath<t.Statement>, injected: InjectedNodes): void {
  path.insertAfter(buildTraceCall(line0(path.node), bindingNamesInScope(path), injected))
}

function insertHeader(
  blockPath: NodePath<t.BlockStatement>,
  headerLine: number,
  atPath: NodePath,
  injected: InjectedNodes,
): void {
  blockPath.unshiftContainer(
    'body',
    buildTraceCall(headerLine, bindingNamesInScope(atPath), injected),
  )
}

function createTracePlugin(): PluginObject {
  const injected: InjectedNodes = new WeakSet()
  const isInjected = (path: NodePath): boolean => injected.has(path.node)

  return {
    visitor: {
      ExpressionStatement(path: NodePath<t.ExpressionStatement>) {
        if (isInjected(path)) return
        if (!path.parentPath.isBlockStatement() && !path.parentPath.isProgram()) return
        insertTraceAfter(path, injected)
      },
      VariableDeclaration(path: NodePath<t.VariableDeclaration>) {
        if (isInjected(path)) return
        if (!path.parentPath.isBlockStatement() && !path.parentPath.isProgram()) return
        insertTraceAfter(path, injected)
      },
      ReturnStatement(path: NodePath<t.ReturnStatement>) {
        if (isInjected(path)) return
        insertTraceAfter(path, injected)
      },
      BreakStatement(path: NodePath<t.BreakStatement>) {
        if (isInjected(path)) return
        insertTraceAfter(path, injected)
      },
      ContinueStatement(path: NodePath<t.ContinueStatement>) {
        if (isInjected(path)) return
        insertTraceAfter(path, injected)
      },
      ThrowStatement(path: NodePath<t.ThrowStatement>) {
        if (isInjected(path)) return
        insertTraceAfter(path, injected)
      },
      IfStatement(path: NodePath<t.IfStatement>) {
        if (isInjected(path)) return
        const headerLine = line0(path.node)
        const consequent = ensureBlock(path.get('consequent'))
        insertHeader(consequent, headerLine, path, injected)

        const alternatePath = path.get('alternate')
        if (alternatePath.node && !alternatePath.isIfStatement()) {
          const alternate = ensureBlock(alternatePath)
          insertHeader(alternate, headerLine, path, injected)
        }
      },
      ForStatement(path: NodePath<t.ForStatement>) {
        if (isInjected(path)) return
        const headerLine = line0(path.node)
        const body = ensureBlock(path.get('body'))
        insertHeader(body, headerLine, path, injected)
      },
      WhileStatement(path: NodePath<t.WhileStatement>) {
        if (isInjected(path)) return
        const headerLine = line0(path.node)
        const body = ensureBlock(path.get('body'))
        insertHeader(body, headerLine, path, injected)
      },
      DoWhileStatement(path: NodePath<t.DoWhileStatement>) {
        if (isInjected(path)) return
        const headerLine = line0(path.node)
        const body = ensureBlock(path.get('body'))
        insertHeader(body, headerLine, path, injected)
      },
    },
  }
}

/** Converts a raw sandboxed JS value into a deterministic, address-free display string. */
function toDisplayString(value: unknown): string {
  if (typeof value === 'number') {
    if (Number.isNaN(value)) return 'NaN'
    if (value === Infinity) return 'Infinity'
    if (value === -Infinity) return '-Infinity'
    return String(value)
  }
  if (typeof value === 'function') return '[Function]'
  if (typeof value === 'undefined') return 'undefined'
  if (typeof value === 'bigint') return `${String(value)}n`
  try {
    const json: unknown = JSON.stringify(value)
    return typeof json === 'string' ? json : Object.prototype.toString.call(value)
  } catch {
    return Object.prototype.toString.call(value)
  }
}

/**
 * Instruments and runs `snippet`, returning one TraceStep per executed line.
 * Throws if the snippet exceeds `maxSteps` (default DEFAULT_MAX_TRACE_STEPS)
 * or `timeoutMs` (default DEFAULT_TIMEOUT_MS) wall-clock, or if the snippet
 * itself throws (a puzzle snippet must actually run to completion).
 */
export function generateJsTrace(
  snippet: string,
  options: GenerateJsTraceOptions = {},
): TraceResult {
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_TRACE_STEPS
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS

  const transformed = transformSync(snippet, {
    plugins: [createTracePlugin],
    babelrc: false,
    configFile: false,
    sourceType: 'script',
  })
  const code = transformed?.code
  if (code === null || code === undefined) {
    throw new Error('generateJsTrace: babel produced no output for this snippet')
  }

  const steps: TraceStep[] = []
  let outputSinceLastTrace = ''

  // First-seen order across the WHOLE trace, not each step's own insertion
  // order: bindingNamesInScope/getAllBindings() lists the innermost scope's
  // own bindings before its parent's, so a loop variable (bound in the
  // loop's own nested scope) jumps ahead of outer-scope variables the
  // moment the loop is entered, reordering the panel mid-scrub (P3,
  // docs/v2-phase2-review.md). Fixing this at snapshot-display time, not in
  // the babel instrumentation, keeps the instrumentation itself simple —
  // each step's own `rawVars` still only contains whatever it actually
  // caught in scope, this just re-keys the *display* object so a name
  // keeps the column position it was first given, in every later step.
  const varOrder: string[] = []
  const seenVarNames = new Set<string>()

  function trace(line: number, rawVars: Record<string, unknown>): void {
    if (steps.length >= maxSteps) {
      throw new Error(
        `generateJsTrace: step budget exceeded (${String(maxSteps)} steps) — likely an infinite loop`,
      )
    }
    for (const name of Object.keys(rawVars)) {
      if (!seenVarNames.has(name)) {
        seenVarNames.add(name)
        varOrder.push(name)
      }
    }
    const vars: Record<string, string> = {}
    for (const name of varOrder) {
      if (name in rawVars) {
        vars[name] = toDisplayString(rawVars[name])
      }
    }
    const step: TraceStep = outputSinceLastTrace
      ? { line, vars, output: outputSinceLastTrace }
      : { line, vars }
    steps.push(step)
    outputSinceLastTrace = ''
  }

  const sandboxConsole = {
    log: (...args: unknown[]) => {
      // '\n' between separate console.log calls (real terminal output, one
      // line per call) — but a single call's own args still join with ' ',
      // matching console.log's own multi-arg formatting (P4,
      // docs/v2-phase2-review.md). Joining every call with ' ' collapsed
      // two calls onto one line, so the displayed output could disagree
      // with what the program actually printed for an `output` checkpoint.
      outputSinceLastTrace +=
        (outputSinceLastTrace ? '\n' : '') + args.map(toDisplayString).join(' ')
    },
  }

  // A bare object, not vm.createContext(globalThis) or similar — require,
  // process, fs, and timers are not exposed as globals, so a snippet has no
  // *direct* handle to them. This is NOT a security boundary, though:
  // node:vm's isolation is explicitly not one (Node's own docs say so), and
  // `this.constructor.constructor('return process')()` reaches out of the
  // context via Function's constructor, which is still present because it's
  // part of the JS realm itself. Fine while snippets are hand-authored (this
  // phase); revisit before Phase 4 runs LLM-generated snippets, where the
  // threat model changes from "my own code" to "code I did not write" — see
  // docs/v2-phase2-review.md (P6) and the build plan's open-defects table.
  // console (captured, not real stdout) and the trace hook are exposed;
  // other language intrinsics (Object, Array, Math, JSON, ...) are still
  // present because they're part of the JS realm itself, not something we add.
  const sandbox = vm.createContext({
    console: sandboxConsole,
    [TRACE_FN]: trace,
  })

  // Determinism is enforced, not just claimed (P2, docs/v2-phase2-review.md):
  // Math.random/Date.now/new Date() (no-arg) are all reachable in a fresh
  // vm realm and would otherwise let a snippet trace differently on every
  // run, silently defeating "trace ground truth is the result of actually
  // running the code." Throwing a named authoring error is the chosen
  // posture over silently pinning a seed: a snippet that *looks*
  // nondeterministic to a reader should fail loudly during authoring, not
  // quietly produce a plausible-but-arbitrary trace. `new Date(2024, 0, 1)`
  // (explicit arguments) is genuinely deterministic and stays allowed. Not
  // guarded: an explicit-argument Date's locale-sensitive formatting
  // (`toLocaleString()`, `Intl.DateTimeFormat`) can still vary by host
  // timezone/locale — same-run reproducibility holds, but a trace generated
  // on one machine could theoretically differ on another. Out of scope
  // here (matches P2's stated scope); flag if a pilot ever needs it.
  vm.runInContext(NONDETERMINISM_GUARD, sandbox, { displayErrors: true })

  vm.runInContext(code, sandbox, { timeout: timeoutMs, displayErrors: true })

  return { steps }
}
