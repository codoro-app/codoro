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

  function trace(line: number, rawVars: Record<string, unknown>): void {
    if (steps.length >= maxSteps) {
      throw new Error(
        `generateJsTrace: step budget exceeded (${String(maxSteps)} steps) — likely an infinite loop`,
      )
    }
    const vars: Record<string, string> = {}
    for (const [name, value] of Object.entries(rawVars)) {
      vars[name] = toDisplayString(value)
    }
    const step: TraceStep = outputSinceLastTrace
      ? { line, vars, output: outputSinceLastTrace }
      : { line, vars }
    steps.push(step)
    outputSinceLastTrace = ''
  }

  const sandboxConsole = {
    log: (...args: unknown[]) => {
      outputSinceLastTrace +=
        (outputSinceLastTrace ? ' ' : '') + args.map(toDisplayString).join(' ')
    },
  }

  // A bare object, not vm.createContext(globalThis) or similar — no require,
  // process, fs, or timers are reachable from the sandboxed snippet. Only
  // console (captured, not real stdout) and the trace hook are exposed;
  // language intrinsics (Object, Array, Math, JSON, ...) are still present
  // because they're part of the JS realm itself, not something we add.
  const sandbox = vm.createContext({
    console: sandboxConsole,
    [TRACE_FN]: trace,
  })

  vm.runInContext(code, sandbox, { timeout: timeoutMs, displayErrors: true })

  return { steps }
}
