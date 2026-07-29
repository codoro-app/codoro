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
