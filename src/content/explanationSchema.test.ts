import { describe, expect, it } from 'vitest'
import { ExplanationEntrySchema, ExplanationSetSchema } from './explanationSchema'

function validEntry(overrides: Record<string, unknown> = {}): unknown {
  return {
    target: 1,
    why_wrong: 'This checks `i <= len` which reads one element past the array bound.',
    misconception: 'off-by-one-inclusive-bound',
    ...overrides,
  }
}

function validMcqSet(overrides: Record<string, unknown> = {}): unknown {
  return {
    puzzle_id: 'oob-001',
    interaction: 'mcq',
    generated_at: '2026-09-19T00:00:00.000Z',
    generator_version: 1,
    entries: [validEntry({ target: 1 }), validEntry({ target: 2 })],
    ...overrides,
  }
}

describe('ExplanationEntrySchema — valid', () => {
  it('accepts a valid entry', () => {
    expect(ExplanationEntrySchema.safeParse(validEntry()).success).toBe(true)
  })

  it('accepts why_wrong at the min length bound (40 chars)', () => {
    const result = ExplanationEntrySchema.safeParse(validEntry({ why_wrong: 'x'.repeat(40) }))
    expect(result.success).toBe(true)
  })

  it('accepts why_wrong at the max length bound (600 chars)', () => {
    const result = ExplanationEntrySchema.safeParse(validEntry({ why_wrong: 'x'.repeat(600) }))
    expect(result.success).toBe(true)
  })
})

describe('ExplanationEntrySchema — violations', () => {
  it('rejects why_wrong below the min length (39 chars)', () => {
    const result = ExplanationEntrySchema.safeParse(validEntry({ why_wrong: 'x'.repeat(39) }))
    expect(result.success).toBe(false)
  })

  it('rejects why_wrong above the max length (601 chars)', () => {
    const result = ExplanationEntrySchema.safeParse(validEntry({ why_wrong: 'x'.repeat(601) }))
    expect(result.success).toBe(false)
  })

  it('rejects a negative target', () => {
    expect(ExplanationEntrySchema.safeParse(validEntry({ target: -1 })).success).toBe(false)
  })

  it('rejects a non-integer target', () => {
    expect(ExplanationEntrySchema.safeParse(validEntry({ target: 1.5 })).success).toBe(false)
  })

  it('rejects an uppercase misconception label', () => {
    expect(
      ExplanationEntrySchema.safeParse(validEntry({ misconception: 'Off-By-One' })).success,
    ).toBe(false)
  })

  it('rejects a misconception label shorter than 3 chars', () => {
    expect(ExplanationEntrySchema.safeParse(validEntry({ misconception: 'ab' })).success).toBe(
      false,
    )
  })

  it.each([
    'You picked option B, which checks the wrong bound.',
    'The first option assumes the list is never empty.',
    'That is the second choice, and it skips the base case.',
    'The one above only handles positive numbers.',
    'The one below never resets the accumulator.',
  ])('rejects an ordinal/positional reference in why_wrong: %s', (why_wrong) => {
    // Pad past the 40-char floor without affecting the phrase under test.
    const padded = why_wrong.length >= 40 ? why_wrong : `${why_wrong} This is the actual reason.`
    expect(ExplanationEntrySchema.safeParse(validEntry({ why_wrong: padded })).success).toBe(false)
  })

  it('accepts prose that mentions "second" or "above" outside the banned phrasing', () => {
    const why_wrong =
      'This runs a second pass over the array above the loop bound, double-processing the last element.'
    expect(ExplanationEntrySchema.safeParse(validEntry({ why_wrong })).success).toBe(true)
  })
})

describe('ExplanationSetSchema — valid', () => {
  it('accepts a valid mcq set', () => {
    expect(ExplanationSetSchema.safeParse(validMcqSet()).success).toBe(true)
  })

  it('accepts a valid tap-line set', () => {
    const result = ExplanationSetSchema.safeParse(
      validMcqSet({
        puzzle_id: 'mut-001',
        interaction: 'tap-line',
        entries: [validEntry({ target: 0 }), validEntry({ target: 1 })],
      }),
    )
    expect(result.success).toBe(true)
  })

  it('accepts a valid swipe-binary set (exactly one entry, target 0)', () => {
    const result = ExplanationSetSchema.safeParse(
      validMcqSet({
        puzzle_id: 'tc-001',
        interaction: 'swipe-binary',
        entries: [validEntry({ target: 0 })],
      }),
    )
    expect(result.success).toBe(true)
  })
})

describe('ExplanationSetSchema — violations', () => {
  it('rejects a non-kebab-case puzzle_id', () => {
    expect(ExplanationSetSchema.safeParse(validMcqSet({ puzzle_id: 'OOB_001' })).success).toBe(
      false,
    )
  })

  it('rejects an unrecognized interaction', () => {
    expect(ExplanationSetSchema.safeParse(validMcqSet({ interaction: 'drag-order' })).success).toBe(
      false,
    )
  })

  it('rejects a non-ISO generated_at', () => {
    expect(
      ExplanationSetSchema.safeParse(validMcqSet({ generated_at: '2026-09-19' })).success,
    ).toBe(false)
  })

  it('rejects an empty entries array', () => {
    expect(ExplanationSetSchema.safeParse(validMcqSet({ entries: [] })).success).toBe(false)
  })

  it('rejects duplicate targets within a set', () => {
    const result = ExplanationSetSchema.safeParse(
      validMcqSet({ entries: [validEntry({ target: 1 }), validEntry({ target: 1 })] }),
    )
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.message.includes('duplicate target'))).toBe(
        true,
      )
    }
  })

  it('rejects a swipe-binary set with more than one entry', () => {
    const result = ExplanationSetSchema.safeParse(
      validMcqSet({
        interaction: 'swipe-binary',
        entries: [validEntry({ target: 0 }), validEntry({ target: 1 })],
      }),
    )
    expect(result.success).toBe(false)
  })

  it('rejects a swipe-binary set whose single entry targets anything but 0', () => {
    const result = ExplanationSetSchema.safeParse(
      validMcqSet({ interaction: 'swipe-binary', entries: [validEntry({ target: 1 })] }),
    )
    expect(result.success).toBe(false)
  })
})
