import { describe, expect, it } from 'vitest'
import { generateJsTrace } from './jsTraceGen'

describe('generateJsTrace — sequential snippet', () => {
  it('traces one step per executed line, with post-line variable state', () => {
    const snippet = 'let x = 1;\nx = x + 1;\nconsole.log(x);'
    const result = generateJsTrace(snippet)

    expect(result.steps).toEqual([
      { line: 0, vars: { x: '1' } },
      { line: 1, vars: { x: '2' } },
      { line: 2, vars: { x: '2' }, output: '2' },
    ])
  })
})

describe('generateJsTrace — loop state', () => {
  it('traces the loop header once per iteration and the body with accumulating state', () => {
    const snippet = 'let total = 0;\nfor (let i = 0; i < 3; i++) {\n  total += i;\n}'
    const result = generateJsTrace(snippet)

    expect(result.steps).toEqual([
      { line: 0, vars: { total: '0' } },
      { line: 1, vars: { total: '0', i: '0' } },
      { line: 2, vars: { total: '0', i: '0' } },
      { line: 1, vars: { total: '0', i: '1' } },
      { line: 2, vars: { total: '1', i: '1' } },
      { line: 1, vars: { total: '1', i: '2' } },
      { line: 2, vars: { total: '3', i: '2' } },
    ])
  })
})

describe('generateJsTrace — alias mutation', () => {
  it('shows both aliases reflecting a mutation through either reference', () => {
    const snippet = 'let a = [1, 2];\nlet b = a;\nb.push(3);'
    const result = generateJsTrace(snippet)

    expect(result.steps).toEqual([
      { line: 0, vars: { a: '[1,2]' } },
      { line: 1, vars: { a: '[1,2]', b: '[1,2]' } },
      { line: 2, vars: { a: '[1,2,3]', b: '[1,2,3]' } },
    ])
  })
})

describe('generateJsTrace — TDZ / not-yet-declared variables', () => {
  it('omits a let/const binding from vars until its declaration has executed', () => {
    const snippet = 'let a = 1;\nlet b = a + 1;'
    const result = generateJsTrace(snippet)

    expect(result.steps).toEqual([
      { line: 0, vars: { a: '1' } },
      { line: 1, vars: { a: '1', b: '2' } },
    ])
  })
})

describe('generateJsTrace — if/else branching', () => {
  it('traces the taken branch header and body, and skips the untaken branch entirely', () => {
    const snippet = 'let x = 5;\nif (x > 3) {\n  x = x + 1;\n} else {\n  x = x - 1;\n}'
    const result = generateJsTrace(snippet)

    expect(result.steps).toEqual([
      { line: 0, vars: { x: '5' } },
      { line: 1, vars: { x: '5' } },
      { line: 2, vars: { x: '6' } },
    ])
  })
})

describe('generateJsTrace — vars key order stability (P3)', () => {
  it('keeps a variable in the column position it first appeared, even once a nested-scope binding (e.g. a loop counter) enters scope', () => {
    // bindingNamesInScope/getAllBindings() lists the innermost scope's own
    // bindings before its parent's, so without the fix `i` (bound in the
    // for-loop's own nested scope) would jump ahead of sum/arr the moment
    // the loop body is entered — see docs/v2-phase2-review.md (P3). toEqual
    // above doesn't catch this (it ignores key order); this asserts on
    // Object.keys directly.
    const snippet =
      'let sum = 0;\nlet arr = [1, 2];\nfor (let i = 0; i < arr.length; i++) {\n  sum += arr[i];\n}'
    const result = generateJsTrace(snippet)

    for (const step of result.steps) {
      const expectedOrder = ['sum', 'arr', 'i'].filter((name) => name in step.vars)
      expect(Object.keys(step.vars)).toEqual(expectedOrder)
    }
    // Sanity: this snippet does reach a step where all three are present —
    // otherwise the loop above would vacuously pass without ever exercising
    // the reordering scenario the fix targets.
    expect(result.steps.some((step) => Object.keys(step.vars).length === 3)).toBe(true)
  })
})

describe('generateJsTrace — multiple console.log calls between steps (P4)', () => {
  it('joins two separate console.log calls before the same trace point with a newline, not a space', () => {
    // The comma operator packs both calls into one ExpressionStatement, so
    // both console.log side effects run before the single trace call the
    // plugin inserts after it — the exact "two logs, one step" scenario an
    // `output` checkpoint has to render faithfully.
    const snippet = "console.log('a'), console.log('b');\nlet x = 1;"
    const result = generateJsTrace(snippet)
    expect(result.steps[0]?.output).toBe('"a"\n"b"')
  })

  it('still joins multiple arguments within a single console.log call with a space', () => {
    const snippet = "console.log('a', 'b');\nlet x = 1;"
    const result = generateJsTrace(snippet)
    expect(result.steps[0]?.output).toBe('"a" "b"')
  })
})

describe('generateJsTrace — determinism', () => {
  it('produces byte-identical (deep-equal) traces on repeated runs of the same snippet', () => {
    const snippet = 'let total = 0;\nfor (let i = 0; i < 5; i++) {\n  total += i;\n}'
    const first = generateJsTrace(snippet)
    const second = generateJsTrace(snippet)
    expect(second).toEqual(first)
  })

  // P2, docs/v2-phase2-review.md: the JS backend used to have no enforcement
  // at all here — Math.random()/Date.now()/new Date() were all reachable and
  // a snippet using any of them would trace differently on every run, with
  // nothing to catch it (the old version of this exact test could not fail,
  // regardless of whether the guarantee held). These assert the enforcement
  // mechanism directly: an authoring error, not a silently-varying trace.
  it('throws a clear authoring error for Math.random(), naming the API', () => {
    const snippet = 'let x = Math.random();'
    expect(() => generateJsTrace(snippet)).toThrow(/Math\.random/)
  })

  it('throws a clear authoring error for Date.now(), naming the API', () => {
    const snippet = 'let x = Date.now();'
    expect(() => generateJsTrace(snippet)).toThrow(/Date\.now/)
  })

  it('throws a clear authoring error for new Date() with no arguments', () => {
    const snippet = 'let x = new Date();'
    expect(() => generateJsTrace(snippet)).toThrow(/new Date\(\)/)
  })

  it('throws a clear authoring error for Date() called without new', () => {
    const snippet = 'let x = Date();'
    expect(() => generateJsTrace(snippet)).toThrow(/Date\(\)/)
  })

  it('allows new Date(...) with explicit arguments and traces it deterministically', () => {
    const snippet = 'let x = new Date(2024, 0, 1).getFullYear();'
    const first = generateJsTrace(snippet)
    const second = generateJsTrace(snippet)
    expect(second).toEqual(first)
    expect(first.steps[0]?.vars.x).toBe('2024')
  })
})

describe('generateJsTrace — step budget', () => {
  it('throws a clear error naming the budget when a snippet runs away', () => {
    const snippet = 'let x = 0;\nwhile (true) {\n  x = x + 1;\n}'
    expect(() => generateJsTrace(snippet, { maxSteps: 25 })).toThrow(/25/)
  })
})

describe('generateJsTrace — sandbox isolation', () => {
  it('has no access to require (no I/O reachable from a snippet)', () => {
    const snippet = "const fs = require('node:fs');"
    expect(() => generateJsTrace(snippet)).toThrow(/require/)
  })

  it('has no access to setTimeout (no timers reachable from a snippet)', () => {
    const snippet = 'setTimeout(() => {}, 0);'
    expect(() => generateJsTrace(snippet)).toThrow(/setTimeout/)
  })
})

describe('generateJsTrace — OD-2: node:vm escape cannot reach the host process', () => {
  // node:vm's isolation is not a security boundary — this exact payload
  // (docs/v2-build-plan.md, OD-2) is confirmed to escape vm.runInContext
  // and resolve a real `process` object via Function's constructor, which
  // is still reachable because it's part of the JS realm itself, not
  // something the sandbox adds. The fix is not "block the payload" (it
  // can't be, short of disabling Function entirely) — it's that whatever
  // `process` it resolves now belongs to a disposable child OS process,
  // never this test's own (the one that would hold an API key in a real
  // generatePuzzles.ts run).
  const ESCAPE = "this.constructor.constructor('return process')()"

  // Whole-surface, not a suspect list: a blocklist of "known-dangerous"
  // members was tried first (process.binding/dlopen), then a wider but
  // still-named list, and each missed something on the very next
  // adversarial pass (process.getBuiltinModule, Node 22.3+, was the
  // second miss). Enumerating every OWN key actually left on the escaped
  // process object and asserting it's a subset of a small, explicitly-named
  // allowlist closes that class of gap for good — a future Node release
  // adding hatch #4 fails this test by construction, without needing
  // anyone to have already thought of the new property's name.
  // `features`/`argv0` are the two non-configurable residues confirmed on
  // this Node build (`delete` on them is a no-op) — neither is a
  // capability (a version-flags object and this Node binary's own launch
  // path), unlike everything neutralizeProcess successfully removes.
  const ALLOWED_RESIDUAL_KEYS = ['exitCode', 'features', 'argv0', 'Symbol(Symbol.toStringTag)']

  it('the escaped process object retains no own keys beyond a small, explicitly-named, non-configurable residue', () => {
    const snippet = `
const escaped = ${ESCAPE};
const allowed = new Set(${JSON.stringify(ALLOWED_RESIDUAL_KEYS)});
const keys = Reflect.ownKeys(escaped).map(String);
const unexpected = keys.filter((k) => !allowed.has(k));
console.log(JSON.stringify(unexpected));
`
    const result = generateJsTrace(snippet)
    expect(result.steps.at(-1)?.output).toBe('"[]"')
  })

  it('keeps exactly one deliberate exception (exitCode, inert data) present on the escaped process object', () => {
    // Positive control for the test above: confirms neutralizeProcess's one
    // intentional carve-out is real (not that the whole mechanism silently
    // no-ops and everything just happens to read as absent).
    const snippet = `
const escaped = ${ESCAPE};
console.log(JSON.stringify(Reflect.has(escaped, 'exitCode')));
`
    const result = generateJsTrace(snippet)
    expect(result.steps.at(-1)?.output).toBe('"true"')
  })
})
