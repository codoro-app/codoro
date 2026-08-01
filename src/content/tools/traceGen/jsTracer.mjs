/**
 * Child-process worker for JS scrubber trace generation, spawned by
 * jsTraceGen.ts (never imported directly, never run in-process with the
 * caller — a snippet gets a fresh Node process every time). Mirrors
 * pyTracer.py's role and transport contract exactly (OD-2,
 * docs/v2-build-plan.md): the snippet + options arrive on stdin as one JSON
 * payload, on success this process writes exactly one JSON blob to stdout
 * and exits 0, on failure it writes a message to stderr and exits non-zero
 * — success/failure is never ambiguous between "valid JSON on stdout" and
 * "readable error on stderr".
 *
 * This is the OD-2 fix: instruments a snippet with @babel/core (inserting a
 * call to a trace hook after/around each executable statement), then runs
 * the instrumented code in a node:vm sandbox with no I/O and a step budget
 * — exactly what jsTraceGen.ts used to do in-process. node:vm's isolation is
 * NOT a security boundary (Node's own docs say so; the confirmed escape
 * payload is `this.constructor.constructor('return process')()`), so this
 * now runs in its own disposable OS process instead of the process holding
 * the Anthropic API key — an escape here reaches only this child's own
 * `process` object, not the caller's.
 *
 * What counts as a traced "step": every ExpressionStatement, VariableDeclaration,
 * ReturnStatement, BreakStatement, ContinueStatement, and ThrowStatement gets a
 * trace call immediately after it (a "leaf" step). Every IfStatement, ForStatement,
 * WhileStatement, and DoWhileStatement additionally gets a "header" trace call
 * inserted as the first statement of each block it controls (consequent/alternate/
 * body) — inside the body means it fires once per loop iteration, not once total.
 * A loop's own init/test/update clauses are not separately traced.
 */
import { transformSync } from '@babel/core'
import * as t from '@babel/types'
import vm from 'node:vm'

const TRACE_FN = '__codoro_trace'

/**
 * Run once per sandbox, before the instrumented snippet, to make the three
 * reachable nondeterministic APIs fail loudly instead of silently producing
 * a different trace on every run. `new Date(...)` with at least one explicit
 * argument is passed through unchanged — that form is genuinely
 * deterministic.
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

/**
 * Every node the plugin itself constructs gets added here so the visitor
 * can recognize and skip its own output — Babel's traversal queue still
 * walks into a freshly inserted/unshifted subtree, and those synthetic
 * nodes have no `.loc` (never parsed from source), so visiting them as if
 * they were real snippet code crashes `line0`. Scoped fresh per snippet.
 */
function buildSnapshotExpression(names, injected) {
  const mark = (node) => {
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

function buildTraceCall(line0Indexed, names, injected) {
  const call = t.expressionStatement(
    t.callExpression(t.identifier(TRACE_FN), [
      t.numericLiteral(line0Indexed),
      buildSnapshotExpression(names, injected),
    ]),
  )
  injected.add(call)
  return call
}

function bindingNamesInScope(path) {
  return Object.keys(path.scope.getAllBindings())
}

function line0(node) {
  const line = node.loc?.start.line
  if (line === undefined) {
    throw new Error('line0: node has no location information')
  }
  return line - 1
}

/** Ensures a loop/if branch body is a BlockStatement (so a header trace has somewhere to be inserted), wrapping a bare statement if needed. */
function ensureBlock(path) {
  if (!path.isBlockStatement()) {
    path.replaceWith(t.blockStatement([path.node]))
  }
  return path
}

function insertTraceAfter(path, injected) {
  path.insertAfter(buildTraceCall(line0(path.node), bindingNamesInScope(path), injected))
}

function insertHeader(blockPath, headerLine, atPath, injected) {
  blockPath.unshiftContainer('body', buildTraceCall(headerLine, bindingNamesInScope(atPath), injected))
}

function createTracePlugin() {
  const injected = new WeakSet()
  const isInjected = (path) => injected.has(path.node)

  return {
    visitor: {
      ExpressionStatement(path) {
        if (isInjected(path)) return
        if (!path.parentPath.isBlockStatement() && !path.parentPath.isProgram()) return
        insertTraceAfter(path, injected)
      },
      VariableDeclaration(path) {
        if (isInjected(path)) return
        if (!path.parentPath.isBlockStatement() && !path.parentPath.isProgram()) return
        insertTraceAfter(path, injected)
      },
      ReturnStatement(path) {
        if (isInjected(path)) return
        insertTraceAfter(path, injected)
      },
      BreakStatement(path) {
        if (isInjected(path)) return
        insertTraceAfter(path, injected)
      },
      ContinueStatement(path) {
        if (isInjected(path)) return
        insertTraceAfter(path, injected)
      },
      ThrowStatement(path) {
        if (isInjected(path)) return
        insertTraceAfter(path, injected)
      },
      IfStatement(path) {
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
      ForStatement(path) {
        if (isInjected(path)) return
        const headerLine = line0(path.node)
        const body = ensureBlock(path.get('body'))
        insertHeader(body, headerLine, path, injected)
      },
      WhileStatement(path) {
        if (isInjected(path)) return
        const headerLine = line0(path.node)
        const body = ensureBlock(path.get('body'))
        insertHeader(body, headerLine, path, injected)
      },
      DoWhileStatement(path) {
        if (isInjected(path)) return
        const headerLine = line0(path.node)
        const body = ensureBlock(path.get('body'))
        insertHeader(body, headerLine, path, injected)
      },
    },
  }
}

/** Converts a raw sandboxed JS value into a deterministic, address-free display string. */
function toDisplayString(value) {
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
    const json = JSON.stringify(value)
    return typeof json === 'string' ? json : Object.prototype.toString.call(value)
  } catch {
    return Object.prototype.toString.call(value)
  }
}

/**
 * Neutralizes the REAL global `process` object that a `node:vm` escape
 * (e.g. the confirmed `this.constructor.constructor('return process')()`
 * payload) reaches directly — restricting the child's *environment* (see
 * jsTraceGen.ts's `buildChildEnv`) closes the "read the API key out of
 * process.env" path, but `process` itself carries a wide surface of
 * native-internals escape hatches reachable regardless of env contents:
 * `process.binding('fs')`/`process.getBuiltinModule('fs')` can read
 * arbitrary files off disk (e.g. `.env` itself), `process.getBuiltinModule
 * ('child_process')` can execute commands, `process.report` can write
 * files, `process.reallyExit`/direct `process.stdout` access could forge
 * this script's own trace output — all bypassing the "no require" sandbox
 * restriction entirely, none of them needing `process.env` to matter.
 *
 * This is deliberately an ALLOWLIST, not a blocklist: `main()` captures
 * every real-`process` capability THIS script itself still needs (stdin,
 * a bound stdout/stderr write, a bound exit) into local closures BEFORE
 * calling this function, so those keep working after every other own
 * property of `process` is deleted here. A blocklist of "known-dangerous"
 * members was tried first and missed `getBuiltinModule` (added Node 22.3)
 * on the very first adversarial pass that looked past `binding`/`dlopen` —
 * the next Node minor can add hatch #4 just as easily, so naming what's
 * dangerous doesn't hold up; naming what's *needed* does.
 *
 * Still not a full OS-level sandbox (out of scope for OD-2 — see
 * docs/v2-build-plan.md: "this is about the escape and the key", not a
 * general-purpose arbitrary-code containment guarantee): `globalThis`
 * itself (and therefore `fetch`, etc.) is still reachable through the same
 * cross-realm `Function` leak this payload uses, which closing `process`
 * alone cannot fix. Called once, right before either `vm.runInContext`
 * call executes anything (including NONDETERMINISM_GUARD, which is
 * trusted but doesn't need `process` either) — no code path reaches
 * untrusted execution before this has run. Must stay AFTER `transformSync`
 * (babel itself reads `process.env`/`process.cwd()` internally) and BEFORE
 * both `vm.runInContext` calls — moving it earlier can break instrumentation,
 * moving it later reopens the exact gap this function exists to close.
 *
 * `exitCode` is the one property deliberately left alone: it's inert data
 * (a number Node reads once the event loop drains), not a capability — an
 * escaped snippet setting it can't read a file, run a command, or write
 * anything. Leaving it in place lets this script set it via plain
 * assignment and exit through Node's own natural, fully-flushed shutdown,
 * rather than forcing an immediate `process.reallyExit()` (which does not
 * guarantee a large pending stdout write finishes before the process dies
 * — a real risk here, since a trace's JSON payload isn't bounded small).
 */
function neutralizeProcess() {
  for (const key of Reflect.ownKeys(process)) {
    if (key === 'exitCode') continue
    try {
      delete process[key]
    } catch {
      /* non-configurable on this Node build — leave it; everything this
         script itself needs was already captured as a closure in main(). */
    }
  }
}

function generateJsTrace(snippet, maxSteps, timeoutMs) {
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

  const steps = []
  let outputSinceLastTrace = ''

  // First-seen order across the WHOLE trace, not each step's own insertion
  // order — see jsTraceGen.ts's history (P3, docs/v2-phase2-review.md) for
  // why this re-keying happens at snapshot-display time.
  const varOrder = []
  const seenVarNames = new Set()

  function trace(line, rawVars) {
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
    const vars = {}
    for (const name of varOrder) {
      if (name in rawVars) {
        vars[name] = toDisplayString(rawVars[name])
      }
    }
    const step = outputSinceLastTrace ? { line, vars, output: outputSinceLastTrace } : { line, vars }
    steps.push(step)
    outputSinceLastTrace = ''
  }

  const sandboxConsole = {
    log: (...args) => {
      outputSinceLastTrace += (outputSinceLastTrace ? '\n' : '') + args.map(toDisplayString).join(' ')
    },
  }

  // A bare object, not vm.createContext(globalThis) or similar — require,
  // process, fs, and timers are not exposed as globals, so a snippet has no
  // *direct* handle to them. This alone is still not a security boundary
  // (node:vm's isolation explicitly is not one) — the OS-process boundary
  // this script now runs inside of is what actually contains an escape.
  const sandbox = vm.createContext({
    console: sandboxConsole,
    [TRACE_FN]: trace,
  })

  neutralizeProcess()

  vm.runInContext(NONDETERMINISM_GUARD, sandbox, { displayErrors: true })
  vm.runInContext(code, sandbox, { timeout: timeoutMs, displayErrors: true })

  return { steps }
}

function main() {
  // Captured BEFORE any untrusted code can run, so these keep working once
  // neutralizeProcess() (inside generateJsTrace, called below) deletes
  // every other own property of the real `process` object — including
  // `stdout`/`stderr` themselves (the underlying stream objects stay
  // alive via this closure regardless; only the `process.stdout` property
  // that points to them is gone). `process.exitCode` is deliberately NOT
  // captured here — it's excluded from deletion entirely, see
  // neutralizeProcess's doc comment for why plain assignment to it is
  // still used below, instead of an explicit exit call.
  const stdoutWrite = process.stdout.write.bind(process.stdout)
  const stderrWrite = process.stderr.write.bind(process.stderr)

  let raw = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    raw += chunk
  })
  process.stdin.on('end', () => {
    try {
      const payload = JSON.parse(raw)
      // jsTraceGen.ts always resolves maxSteps/timeoutMs against
      // DEFAULT_MAX_TRACE_STEPS/DEFAULT_TIMEOUT_MS (traceGen/types.ts)
      // before sending the payload — no local fallback duplicated here, so
      // the two constants can't drift out of sync with each other.
      const result = generateJsTrace(payload.snippet, payload.maxSteps, payload.timeoutMs)
      stdoutWrite(JSON.stringify(result))
      process.exitCode = 0
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      stderrWrite(message)
      process.exitCode = 1
    }
  })
}

main()
