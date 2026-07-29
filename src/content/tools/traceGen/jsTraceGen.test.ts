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
