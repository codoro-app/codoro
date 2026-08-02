/**
 * Unit tests for synthesizeChoices, the deterministic distractor-synthesis
 * function generateScrubberPuzzles.ts's pipeline uses instead of asking the
 * model for choices (docs/prompts/claude_code_prompt_v2_phase4.md, Item 4).
 * A hand-built trace fixture is appropriate here (unlike UI-facing
 * checkpoint-presentation assertions, which content/README.md requires to
 * run against the real scrubberPool) — this is a pure algorithm over a
 * TraceResult shape, not a claim about what real content contains.
 */
import { describe, expect, it } from 'vitest'
import { synthesizeChoices } from './generateScrubberPuzzles'
import type { TraceResult } from './traceGen/types'

const trace: TraceResult = {
  steps: [
    { line: 0, vars: { count: '0' } },
    { line: 1, vars: { count: '0', v: '1' } },
    { line: 2, vars: { count: '1', v: '1' } },
    { line: 1, vars: { count: '1', v: '2' } },
    { line: 2, vars: { count: '2', v: '2' } },
    { line: 3, vars: { count: '2', v: '2' }, output: '2' },
  ],
}

describe('synthesizeChoices — next-line', () => {
  it("correct choice is the next step's line, as a string", () => {
    const result = synthesizeChoices(trace, { afterStep: 1, question: 'next-line' })
    expect(result).not.toBeNull()
    expect(result?.choices[result.correct]).toBe('2')
  })

  it('distractors are drawn from other lines the trace actually visited', () => {
    const result = synthesizeChoices(trace, { afterStep: 1, question: 'next-line' })
    if (result === null) throw new Error('expected a non-null result')
    const distractors = result.choices.filter((_, i) => i !== result.correct)
    const visitedLines = new Set(trace.steps.map((s) => String(s.line)))
    for (const d of distractors) expect(visitedLines.has(d)).toBe(true)
    expect(distractors).not.toContain('2')
  })

  it('returns null when placed on the final step (no next line)', () => {
    const result = synthesizeChoices(trace, {
      afterStep: trace.steps.length - 1,
      question: 'next-line',
    })
    expect(result).toBeNull()
  })
})

describe('synthesizeChoices — var-value', () => {
  it("correct choice is the target variable's real value at afterStep", () => {
    const result = synthesizeChoices(trace, {
      afterStep: 4,
      question: 'var-value',
      target: 'count',
    })
    expect(result).not.toBeNull()
    expect(result?.choices[result.correct]).toBe('2')
  })

  it('distractors are other values the same variable actually held elsewhere in the trace', () => {
    const result = synthesizeChoices(trace, {
      afterStep: 4,
      question: 'var-value',
      target: 'count',
    })
    if (result === null) throw new Error('expected a non-null result')
    const distractors = result.choices.filter((_, i) => i !== result.correct)
    // count's real history is {0, 1, 2} — distractors must come from {0, 1}, never a value it never held.
    for (const d of distractors) expect(['0', '1']).toContain(d)
  })

  it('returns null when the target never held any other value in the trace', () => {
    const singleValueTrace: TraceResult = {
      steps: [
        { line: 0, vars: { x: '5' } },
        { line: 1, vars: { x: '5' } },
        { line: 2, vars: { x: '5' } },
      ],
    }
    const result = synthesizeChoices(singleValueTrace, {
      afterStep: 1,
      question: 'var-value',
      target: 'x',
    })
    expect(result).toBeNull()
  })

  it('returns null when no target is given', () => {
    const result = synthesizeChoices(trace, { afterStep: 4, question: 'var-value' })
    expect(result).toBeNull()
  })

  it('returns null when the target is not present at afterStep', () => {
    const result = synthesizeChoices(trace, { afterStep: 4, question: 'var-value', target: 'nope' })
    expect(result).toBeNull()
  })
})

describe('synthesizeChoices — output', () => {
  it('correct choice is the real output produced at that step', () => {
    const result = synthesizeChoices(trace, { afterStep: 5, question: 'output' })
    expect(result).not.toBeNull()
    expect(result?.choices[result.correct]).toBe('2')
  })

  it('returns null when the step produced no output', () => {
    const result = synthesizeChoices(trace, { afterStep: 2, question: 'output' })
    expect(result).toBeNull()
  })
})

describe('synthesizeChoices — general contract', () => {
  it('choices are between 2 and 5 (ScrubberCheckpointSchema bounds) and unique', () => {
    const result = synthesizeChoices(trace, {
      afterStep: 4,
      question: 'var-value',
      target: 'count',
    })
    if (result === null) throw new Error('expected a non-null result')
    expect(result.choices.length).toBeGreaterThanOrEqual(2)
    expect(result.choices.length).toBeLessThanOrEqual(5)
    expect(new Set(result.choices).size).toBe(result.choices.length)
  })

  it('is deterministic — the same (trace, placement) always produces the same choices and correct index', () => {
    const placement = { afterStep: 4, question: 'var-value' as const, target: 'count' }
    const first = synthesizeChoices(trace, placement)
    const second = synthesizeChoices(trace, placement)
    expect(second).toEqual(first)
  })

  it('does not always place the correct answer at the same index across different checkpoints (no positional tell)', () => {
    const positions = new Set<number>()
    for (let afterStep = 0; afterStep < trace.steps.length; afterStep++) {
      const result = synthesizeChoices(trace, { afterStep, question: 'next-line' })
      if (result) positions.add(result.correct)
    }
    // Revert check: if synthesizeChoices always put the correct answer at
    // index 0 (e.g. the shuffle step were deleted), this would fail with
    // positions = {0}.
    expect(positions.size).toBeGreaterThan(1)
  })
})
