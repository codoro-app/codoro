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
