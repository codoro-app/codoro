import { describe, expect, it } from 'vitest'
import { MAX_DIFFICULTY, MIN_DIFFICULTY, PuzzleSchema } from './schema'

function validMcq(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'oob-001',
    pattern: 'off-by-one',
    difficulty_rating: 1000,
    explanation: '`i <= n` reads one past the end of the array.',
    prompt: "What's wrong with this loop?",
    language: 'javascript',
    snippet: 'for (let i = 0; i <= n; i++) {\n  sum += arr[i]\n}',
    interaction: 'mcq',
    choices: ['Off-by-one in the loop bound', 'Missing return statement', 'Wrong variable name'],
    correct_choice: 0,
    ...overrides,
  }
}

function validSwipeBinary(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'tc-001',
    pattern: 'type-coercion',
    difficulty_rating: 1100,
    explanation: '`==` triggers type coercion; `0 == "0"` is true.',
    prompt: 'Is this comparison safe?',
    language: 'javascript',
    snippet: 'if (value == "0") {\n  return false\n}',
    interaction: 'swipe-binary',
    left_label: 'Safe',
    right_label: 'Buggy',
    correct_direction: 'right',
    ...overrides,
  }
}

function validTapLine(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'mut-001',
    pattern: 'mutable-state',
    difficulty_rating: 1700,
    explanation: 'The default `basket=[]` is shared across every call that omits it.',
    prompt: 'Tap the buggy line.',
    language: 'python',
    snippet: 'def add_item(item, basket=[]):\n    basket.append(item)\n    return basket',
    interaction: 'tap-line',
    correct_line: 0,
    ...overrides,
  }
}

describe('PuzzleSchema — valid puzzles', () => {
  it('accepts a valid mcq puzzle', () => {
    expect(PuzzleSchema.safeParse(validMcq()).success).toBe(true)
  })

  it('accepts a valid swipe-binary puzzle', () => {
    expect(PuzzleSchema.safeParse(validSwipeBinary()).success).toBe(true)
  })

  it('accepts a valid tap-line puzzle', () => {
    expect(PuzzleSchema.safeParse(validTapLine()).success).toBe(true)
  })

  it('accepts difficulty at the min and max bounds', () => {
    expect(PuzzleSchema.safeParse(validMcq({ difficulty_rating: MIN_DIFFICULTY })).success).toBe(
      true,
    )
    expect(PuzzleSchema.safeParse(validMcq({ difficulty_rating: MAX_DIFFICULTY })).success).toBe(
      true,
    )
  })

  it('accepts mcq with the max of 5 choices', () => {
    const result = PuzzleSchema.safeParse(
      validMcq({ choices: ['a', 'b', 'c', 'd', 'e'], correct_choice: 4 }),
    )
    expect(result.success).toBe(true)
  })
})

describe('PuzzleSchema — shared field violations', () => {
  it('rejects an out-of-range difficulty (too low)', () => {
    const result = PuzzleSchema.safeParse(validMcq({ difficulty_rating: MIN_DIFFICULTY - 1 }))
    expect(result.success).toBe(false)
  })

  it('rejects an out-of-range difficulty (too high)', () => {
    const result = PuzzleSchema.safeParse(validMcq({ difficulty_rating: MAX_DIFFICULTY + 1 }))
    expect(result.success).toBe(false)
  })

  it('rejects a missing explanation', () => {
    const result = PuzzleSchema.safeParse(validMcq({ explanation: '' }))
    expect(result.success).toBe(false)
  })

  it('rejects an unknown pattern', () => {
    const result = PuzzleSchema.safeParse(validMcq({ pattern: 'not-a-real-pattern' }))
    expect(result.success).toBe(false)
  })

  it('rejects a non-kebab-case id', () => {
    const result = PuzzleSchema.safeParse(validMcq({ id: 'OOB_001' }))
    expect(result.success).toBe(false)
  })

  it('rejects an unrecognized interaction discriminant', () => {
    const result = PuzzleSchema.safeParse(validMcq({ interaction: 'drag-and-drop' }))
    expect(result.success).toBe(false)
  })
})

describe('PuzzleSchema — mcq-specific', () => {
  it('rejects fewer than 2 choices', () => {
    const result = PuzzleSchema.safeParse(validMcq({ choices: ['only one'], correct_choice: 0 }))
    expect(result.success).toBe(false)
  })

  it('rejects more than 5 choices', () => {
    const result = PuzzleSchema.safeParse(
      validMcq({ choices: ['a', 'b', 'c', 'd', 'e', 'f'], correct_choice: 0 }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects correct_choice out of range for the given choices', () => {
    const result = PuzzleSchema.safeParse(validMcq({ correct_choice: 5 }))
    expect(result.success).toBe(false)
  })

  it('rejects correct_choice equal to choices.length (off-by-one at the boundary)', () => {
    const result = PuzzleSchema.safeParse(validMcq({ choices: ['a', 'b', 'c'], correct_choice: 3 }))
    expect(result.success).toBe(false)
  })
})

describe('PuzzleSchema — swipe-binary-specific', () => {
  it('rejects an invalid correct_direction', () => {
    const result = PuzzleSchema.safeParse(validSwipeBinary({ correct_direction: 'up' }))
    expect(result.success).toBe(false)
  })

  it('rejects a missing left_label', () => {
    const result = PuzzleSchema.safeParse(validSwipeBinary({ left_label: '' }))
    expect(result.success).toBe(false)
  })
})

describe('PuzzleSchema — tap-line-specific', () => {
  it('rejects correct_line out of range for the snippet', () => {
    // snippet has 3 lines (indices 0-2); index 3 is out of range.
    const result = PuzzleSchema.safeParse(validTapLine({ correct_line: 3 }))
    expect(result.success).toBe(false)
  })

  it('accepts correct_line at the last valid index', () => {
    const result = PuzzleSchema.safeParse(validTapLine({ correct_line: 2 }))
    expect(result.success).toBe(true)
  })

  it('rejects a negative correct_line', () => {
    const result = PuzzleSchema.safeParse(validTapLine({ correct_line: -1 }))
    expect(result.success).toBe(false)
  })
})

// snippet is 3 lines (indices 0-2):
//   0: let x = 1;
//   1: x = x + 1;
//   2: console.log(x);
// steps[] is the executed-line trace for that snippet, run once straight through.
function validScrubber(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'scr-001',
    pattern: 'mutable-state',
    difficulty_rating: 1200,
    explanation: '`x` is reassigned on line 1 before being logged on line 2.',
    prompt: 'Step through this snippet and predict what happens next.',
    language: 'javascript',
    snippet: 'let x = 1;\nx = x + 1;\nconsole.log(x);',
    interaction: 'scrubber',
    steps: [
      { line: 0, vars: { x: '1' } },
      { line: 1, vars: { x: '2' } },
      { line: 2, vars: { x: '2' }, output: '2' },
    ],
    checkpoints: [
      {
        afterStep: 0,
        question: 'next-line',
        choices: ['0', '1', '2'],
        correct: 1,
      },
      {
        afterStep: 2,
        question: 'var-value',
        target: 'x',
        choices: ['1', '2', '3'],
        correct: 1,
      },
    ],
    ...overrides,
  }
}

describe('PuzzleSchema — scrubber-specific', () => {
  it('accepts a valid scrubber puzzle', () => {
    const result = PuzzleSchema.safeParse(validScrubber())
    expect(result.success).toBe(true)
  })

  it('accepts an output checkpoint whose choices[correct] matches the trace output at that step', () => {
    const result = PuzzleSchema.safeParse(
      validScrubber({
        checkpoints: [
          { afterStep: 0, question: 'next-line', choices: ['0', '1', '2'], correct: 1 },
          {
            afterStep: 2,
            question: 'output',
            choices: ['1', '2', '3'],
            correct: 1,
          },
        ],
      }),
    )
    expect(result.success).toBe(true)
  })

  it('rejects an afterStep past the end of steps', () => {
    const result = PuzzleSchema.safeParse(
      validScrubber({
        checkpoints: [
          { afterStep: 0, question: 'next-line', choices: ['0', '1', '2'], correct: 1 },
          { afterStep: 3, question: 'var-value', target: 'x', choices: ['1', '2'], correct: 1 },
        ],
      }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects checkpoints that are not strictly ordered by afterStep (duplicate)', () => {
    const result = PuzzleSchema.safeParse(
      validScrubber({
        checkpoints: [
          { afterStep: 0, question: 'next-line', choices: ['0', '1', '2'], correct: 1 },
          { afterStep: 0, question: 'var-value', target: 'x', choices: ['1', '2'], correct: 0 },
        ],
      }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects checkpoints that are not strictly ordered by afterStep (out of order)', () => {
    const result = PuzzleSchema.safeParse(
      validScrubber({
        checkpoints: [
          { afterStep: 2, question: 'var-value', target: 'x', choices: ['1', '2'], correct: 1 },
          { afterStep: 0, question: 'next-line', choices: ['0', '1', '2'], correct: 1 },
        ],
      }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects a correct index out of range for choices', () => {
    const result = PuzzleSchema.safeParse(
      validScrubber({
        checkpoints: [
          { afterStep: 0, question: 'next-line', choices: ['0', '1', '2'], correct: 3 },
          { afterStep: 2, question: 'var-value', target: 'x', choices: ['1', '2'], correct: 1 },
        ],
      }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects duplicate choices within a checkpoint', () => {
    const result = PuzzleSchema.safeParse(
      validScrubber({
        checkpoints: [
          { afterStep: 0, question: 'next-line', choices: ['1', '1', '2'], correct: 0 },
          { afterStep: 2, question: 'var-value', target: 'x', choices: ['1', '2'], correct: 1 },
        ],
      }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects a var-value target not present in the trace at that step', () => {
    const result = PuzzleSchema.safeParse(
      validScrubber({
        checkpoints: [
          { afterStep: 0, question: 'next-line', choices: ['0', '1', '2'], correct: 1 },
          {
            afterStep: 2,
            question: 'var-value',
            target: 'notAVariable',
            choices: ['1', '2'],
            correct: 1,
          },
        ],
      }),
    )
    expect(result.success).toBe(false)
  })

  it("rejects a var-value checkpoint whose choices[correct] doesn't match the trace's value", () => {
    const result = PuzzleSchema.safeParse(
      validScrubber({
        checkpoints: [
          { afterStep: 0, question: 'next-line', choices: ['0', '1', '2'], correct: 1 },
          {
            // step 2's x is '2'; claiming '1' is correct is a wrong trace.
            afterStep: 2,
            question: 'var-value',
            target: 'x',
            choices: ['1', '2'],
            correct: 0,
          },
        ],
      }),
    )
    expect(result.success).toBe(false)
  })

  it("rejects a next-line checkpoint whose choices[correct] doesn't match steps[afterStep + 1].line", () => {
    const result = PuzzleSchema.safeParse(
      validScrubber({
        checkpoints: [
          // steps[1].line is 1; claiming 2 is the next line is a wrong trace.
          { afterStep: 0, question: 'next-line', choices: ['0', '1', '2'], correct: 2 },
          { afterStep: 2, question: 'var-value', target: 'x', choices: ['1', '2'], correct: 1 },
        ],
      }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects a next-line checkpoint sitting on the final step', () => {
    const result = PuzzleSchema.safeParse(
      validScrubber({
        checkpoints: [
          { afterStep: 0, question: 'var-value', target: 'x', choices: ['1', '2'], correct: 0 },
          { afterStep: 2, question: 'next-line', choices: ['0', '1', '2'], correct: 1 },
        ],
      }),
    )
    expect(result.success).toBe(false)
  })

  it("rejects an output checkpoint whose choices[correct] doesn't match the output actually produced", () => {
    const result = PuzzleSchema.safeParse(
      validScrubber({
        checkpoints: [
          { afterStep: 0, question: 'next-line', choices: ['0', '1', '2'], correct: 1 },
          {
            // step 2's output is '2'; claiming '3' is a wrong trace.
            afterStep: 2,
            question: 'output',
            choices: ['2', '3'],
            correct: 1,
          },
        ],
      }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects a step.line out of range for the snippet', () => {
    const result = PuzzleSchema.safeParse(
      validScrubber({
        steps: [
          { line: 0, vars: { x: '1' } },
          { line: 1, vars: { x: '2' } },
          // snippet has 3 lines (indices 0-2); index 3 is out of range.
          { line: 3, vars: { x: '2' }, output: '2' },
        ],
      }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects fewer than 2 checkpoints', () => {
    const result = PuzzleSchema.safeParse(
      validScrubber({
        checkpoints: [{ afterStep: 0, question: 'next-line', choices: ['0', '1'], correct: 1 }],
      }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects more than 4 checkpoints', () => {
    const result = PuzzleSchema.safeParse(
      validScrubber({
        steps: [
          { line: 0, vars: { x: '1' } },
          { line: 1, vars: { x: '2' } },
          { line: 1, vars: { x: '3' } },
          { line: 1, vars: { x: '4' } },
          { line: 1, vars: { x: '5' } },
          { line: 2, vars: { x: '5' }, output: '5' },
        ],
        checkpoints: [
          { afterStep: 0, question: 'var-value', target: 'x', choices: ['1', '2'], correct: 0 },
          { afterStep: 1, question: 'var-value', target: 'x', choices: ['2', '3'], correct: 0 },
          { afterStep: 2, question: 'var-value', target: 'x', choices: ['3', '4'], correct: 0 },
          { afterStep: 3, question: 'var-value', target: 'x', choices: ['4', '5'], correct: 0 },
          { afterStep: 4, question: 'var-value', target: 'x', choices: ['5', '6'], correct: 0 },
        ],
      }),
    )
    expect(result.success).toBe(false)
  })
})
