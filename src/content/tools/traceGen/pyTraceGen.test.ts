import { describe, expect, it } from 'vitest'
import { generatePyTrace } from './pyTraceGen'

describe('generatePyTrace — sequential snippet', () => {
  it('traces one step per executed line, with post-line variable state', async () => {
    const snippet = 'x = 1\nx = x + 1\nprint(x)\n'
    const result = await generatePyTrace(snippet)

    expect(result.steps).toEqual([
      { line: 0, vars: { x: '1' } },
      { line: 1, vars: { x: '2' } },
      { line: 2, vars: { x: '2' }, output: '2' },
    ])
  })
})

describe('generatePyTrace — if/else', () => {
  it('traces the taken branch and skips the untaken branch entirely', async () => {
    const snippet = 'x = 5\nif x > 3:\n    x = x + 1\nelse:\n    x = x - 1\n'
    const result = await generatePyTrace(snippet)

    expect(result.steps).toEqual([
      { line: 0, vars: { x: '5' } },
      { line: 1, vars: { x: '5' } },
      { line: 2, vars: { x: '6' } },
    ])
  })
})

describe('generatePyTrace — function call', () => {
  it('traces into the called function and back, one step per frame per line', async () => {
    const snippet = 'def add_one(n):\n    return n + 1\n\nresult = add_one(4)\n'
    const result = await generatePyTrace(snippet)

    expect(result.steps).toEqual([
      { line: 0, vars: { add_one: '<function>' } },
      { line: 1, vars: { n: '4' } },
      { line: 3, vars: { add_one: '<function>', result: '5' } },
    ])
  })
})

describe('generatePyTrace — loop state', () => {
  it('traces the loop header once per iteration attempt (including the final failing check) and the body with accumulating state', async () => {
    const snippet = 'total = 0\nfor i in range(3):\n    total += i\n'
    const result = await generatePyTrace(snippet)

    expect(result.steps).toEqual([
      { line: 0, vars: { total: '0' } },
      { line: 1, vars: { total: '0', i: '0' } },
      { line: 2, vars: { total: '0', i: '0' } },
      { line: 1, vars: { total: '0', i: '1' } },
      { line: 2, vars: { total: '1', i: '1' } },
      { line: 1, vars: { total: '1', i: '2' } },
      { line: 2, vars: { total: '3', i: '2' } },
      // The loop's 4th check (range exhausted) still fires a line event for
      // the `for` line itself before silently exiting — a real difference
      // from the JS backend's babel-instrumented header (which only fires
      // on a successful iteration), not a bug: this is CPython's actual
      // sys.settrace behavior, empirically confirmed, not approximated.
      { line: 1, vars: { total: '3', i: '2' } },
    ])
  })
})

describe('generatePyTrace — alias mutation', () => {
  it('shows both aliases reflecting a mutation through either reference', async () => {
    const snippet = 'a = [1, 2]\nb = a\nb.append(3)\n'
    const result = await generatePyTrace(snippet)

    expect(result.steps).toEqual([
      { line: 0, vars: { a: '[1, 2]' } },
      { line: 1, vars: { a: '[1, 2]', b: '[1, 2]' } },
      { line: 2, vars: { a: '[1, 2, 3]', b: '[1, 2, 3]' } },
    ])
  })
})

describe('generatePyTrace — determinism', () => {
  it('produces deep-equal traces across two independent subprocess invocations', async () => {
    const snippet = 'total = 0\nfor i in range(5):\n    total += i\n'
    const first = await generatePyTrace(snippet)
    const second = await generatePyTrace(snippet)
    expect(second).toEqual(first)
  })

  it('produces a deterministic set repr across two independent subprocess invocations (PYTHONHASHSEED)', async () => {
    const snippet = "s = {'banana', 'apple', 'cherry', 'date', 'elderberry'}\n"
    const first = await generatePyTrace(snippet)
    const second = await generatePyTrace(snippet)
    expect(second).toEqual(first)
    // Sanity: this is exercising real hash-order-sensitive repr, not a
    // trivially-true assertion — a set's repr order depends on string
    // hashing, which is randomized per-process unless PYTHONHASHSEED is
    // fixed.
    expect(first.steps[0]?.vars.s).toMatch(/^\{.*\}$/)
  })
})

describe('generatePyTrace — step budget', () => {
  it('throws a clear error naming the budget when a snippet runs away', async () => {
    const snippet = 'x = 0\nwhile True:\n    x = x + 1\n'
    await expect(generatePyTrace(snippet, { maxSteps: 25 })).rejects.toThrow(/25/)
  })
})

describe('generatePyTrace — sandbox isolation', () => {
  it('has no access to open() (no filesystem I/O reachable from a snippet)', async () => {
    const snippet = "f = open('/etc/passwd')\n"
    await expect(generatePyTrace(snippet)).rejects.toThrow(/open/)
  })

  it('has no access to import (no module I/O reachable from a snippet)', async () => {
    const snippet = 'import os\n'
    await expect(generatePyTrace(snippet)).rejects.toThrow(/import/)
  })
})
