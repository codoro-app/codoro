import { describe, expect, it } from 'vitest'
import { validateDailyCalendar, validatePuzzleFiles } from './validatePuzzles'
import type { RawPuzzleFile } from './loadPuzzles'
import type { ValidatedPuzzle } from './validatePuzzles'
import type { Puzzle } from '../schema'

function rawMcq(id: string, overrides: Record<string, unknown> = {}): unknown {
  return {
    id,
    pattern: 'off-by-one',
    difficulty_rating: 1000,
    explanation: 'A real explanation.',
    prompt: "What's wrong?",
    language: 'javascript',
    snippet: 'for (let i = 0; i <= n; i++) {}',
    interaction: 'mcq',
    choices: ['right answer', 'wrong answer'],
    correct_choice: 0,
    ...overrides,
  }
}

function rawSwipeBinary(
  id: string,
  correctDirection: 'left' | 'right',
  verdict: 'bug' | 'safe' = 'bug',
  overrides: Record<string, unknown> = {},
): unknown {
  // For a "safe" verdict the correct-side label must be the "Safe" pole, or it
  // fails the label-semantics check. "bug" verdicts keep the plain labels — the
  // semantics check deliberately does not police bug-verdict labels.
  const safeLabels =
    correctDirection === 'left'
      ? { left_label: 'Safe', right_label: 'Buggy' }
      : { left_label: 'Buggy', right_label: 'Safe' }
  return {
    id,
    pattern: 'type-coercion',
    difficulty_rating: 1100,
    explanation: 'A real explanation.',
    prompt: 'Is this safe?',
    language: 'javascript',
    snippet: 'if (value == "0") {\n  return false\n}',
    interaction: 'swipe-binary',
    ...(verdict === 'safe' ? safeLabels : { left_label: 'Safe', right_label: 'Buggy' }),
    correct_direction: correctDirection,
    correct_verdict: verdict,
    ...overrides,
  }
}

/**
 * Builds `count` swipe-binary files, `rightCount` of them "right", the rest
 * "left", with at least 1/3 "safe" verdicts (correct side labeled "Safe") so
 * the pool clears the negative-class floor while the direction split stays
 * whatever the caller asked for.
 */
function swipeBinaryFixture(count: number, rightCount: number): RawPuzzleFile[] {
  const safeCount = Math.max(1, Math.ceil(count / 3))
  return Array.from({ length: count }, (_, i) => ({
    filePath: `swipe-${String(i)}.json`,
    raw: rawSwipeBinary(
      `tc-${String(i).padStart(3, '0')}`,
      i < rightCount ? 'right' : 'left',
      i < safeCount ? 'safe' : 'bug',
    ),
  }))
}

describe('validatePuzzleFiles', () => {
  it('returns all puzzles as valid when every file passes the schema', () => {
    const files: RawPuzzleFile[] = [
      { filePath: 'a.json', raw: rawMcq('a-001') },
      { filePath: 'b.json', raw: rawMcq('b-001') },
    ]

    const { valid, errors } = validatePuzzleFiles(files)
    expect(errors).toEqual([])
    expect(valid.map((v) => v.puzzle.id)).toEqual(['a-001', 'b-001'])
  })

  it('collects a schema error per invalid file without stopping at the first one', () => {
    const files: RawPuzzleFile[] = [
      { filePath: 'good.json', raw: rawMcq('good-001') },
      { filePath: 'bad-difficulty.json', raw: rawMcq('bad-001', { difficulty_rating: 99999 }) },
      { filePath: 'bad-explanation.json', raw: rawMcq('bad-002', { explanation: '' }) },
    ]

    const { valid, errors } = validatePuzzleFiles(files)
    expect(valid.map((v) => v.puzzle.id)).toEqual(['good-001'])
    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain('bad-difficulty.json')
    expect(errors[1]).toContain('bad-explanation.json')
  })

  it('flags a duplicate id across two otherwise-valid files, naming both', () => {
    const files: RawPuzzleFile[] = [
      { filePath: 'first.json', raw: rawMcq('dup-001') },
      { filePath: 'second.json', raw: rawMcq('dup-001') },
    ]

    const { valid, errors } = validatePuzzleFiles(files)
    expect(valid.map((v) => v.puzzle.id)).toEqual(['dup-001'])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('second.json')
    expect(errors[0]).toContain('duplicate id "dup-001"')
    expect(errors[0]).toContain('first.json')
  })

  it('returns no valid puzzles and no errors for an empty pool', () => {
    const { valid, errors } = validatePuzzleFiles([])
    expect(valid).toEqual([])
    expect(errors).toEqual([])
  })

  describe('swipe-binary direction balance', () => {
    it('fails on a deliberately-skewed fixture, naming the current split', () => {
      // Mirrors the real-world defect this rule exists to catch: all 39
      // puzzles anchored to "right", zero "left" — see docs/v2-build-plan.md
      // Phase 0.
      const files = swipeBinaryFixture(10, 10)

      const { valid, errors } = validatePuzzleFiles(files)
      expect(valid).toHaveLength(10)
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain('skewed')
      expect(errors[0]).toContain('right=10')
      expect(errors[0]).toContain('left=0')
    })

    it('fails when skewed toward "left" past the bound too, naming "left" as the dominant side', () => {
      const files = swipeBinaryFixture(10, 1) // 1 right, 9 left — 90% left

      const { errors } = validatePuzzleFiles(files)
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain('"left"')
      expect(errors[0]).toContain('right=1')
      expect(errors[0]).toContain('left=9')
    })

    it('passes a library within the 65/35 bound', () => {
      const files = swipeBinaryFixture(10, 6) // 60/40 — inside the bound

      const { errors } = validatePuzzleFiles(files)
      expect(errors).toEqual([])
    })

    it('passes exactly at the 65/35 boundary (not "past" it)', () => {
      const files = swipeBinaryFixture(20, 13) // exactly 65/35

      const { errors } = validatePuzzleFiles(files)
      expect(errors).toEqual([])
    })

    it('does not fire when there are no swipe-binary puzzles at all', () => {
      const files: RawPuzzleFile[] = [{ filePath: 'a.json', raw: rawMcq('a-001') }]

      const { errors } = validatePuzzleFiles(files)
      expect(errors).toEqual([])
    })
  })

  describe('swipe-binary correct_verdict semantics', () => {
    it('fails when the pool is below the ≥1/3 "safe" floor (all buggy)', () => {
      // Mirrors the shipped state before this feature: every real swipe puzzle
      // has correct_verdict:'bug'. A bug-seeking-by-prior player wins for free
      // on that library, so this gate must be a hard failure, not a warning.
      const files: RawPuzzleFile[] = Array.from({ length: 10 }, (_, i) => ({
        filePath: `swipe-${String(i)}.json`,
        raw: rawSwipeBinary(
          `tc-${String(i).padStart(3, '0')}`,
          i % 2 === 0 ? 'left' : 'right',
          'bug',
        ),
      }))

      const gate = validatePuzzleFiles(files).errors.filter((e) => e.includes('negative class'))
      expect(gate).toHaveLength(1)
      expect(gate[0]).toContain('0/10')
    })

    it('passes a pool at exactly the ≥1/3 "safe" floor', () => {
      const files: RawPuzzleFile[] = Array.from({ length: 12 }, (_, i) => ({
        filePath: `swipe-${String(i)}.json`,
        raw: rawSwipeBinary(
          `tc-${String(i).padStart(3, '0')}`,
          i % 2 === 0 ? 'left' : 'right',
          i < 4 ? 'safe' : 'bug',
        ),
      }))

      const gate = validatePuzzleFiles(files).errors.filter((e) => e.includes('negative class'))
      expect(gate).toHaveLength(0)
    })

    it('flags a "safe" puzzle whose correct-side label names a bug', () => {
      // 2 safe (one bad label, one good) + 4 bug = 6 files → safe share is
      // exactly 1/3 (clears the pool gate), direction is 3/3 (clears the skew
      // gate), so the ONLY error is the incoherent safe label.
      const files: RawPuzzleFile[] = [
        {
          filePath: 'bad-safe.json',
          raw: rawSwipeBinary('sb-001', 'right', 'safe', { right_label: 'Race condition' }),
        },
        { filePath: 'good-safe.json', raw: rawSwipeBinary('sb-002', 'left', 'safe') },
        { filePath: 'b0.json', raw: rawSwipeBinary('b-000', 'right', 'bug') },
        { filePath: 'b1.json', raw: rawSwipeBinary('b-001', 'left', 'bug') },
        { filePath: 'b2.json', raw: rawSwipeBinary('b-002', 'right', 'bug') },
        { filePath: 'b3.json', raw: rawSwipeBinary('b-003', 'left', 'bug') },
      ]

      const flagged = validatePuzzleFiles(files).errors.filter((e) =>
        e.includes('does not claim the code is fine'),
      )
      expect(flagged).toHaveLength(1)
      expect(flagged[0]).toContain('sb-001')
    })
  })
})

function validated(id: string, interaction: string): ValidatedPuzzle {
  return {
    filePath: `${id}.json`,
    puzzle: { id, interaction } as unknown as Puzzle,
  }
}

describe('validateDailyCalendar', () => {
  const quiz1 = validated('quiz-001', 'mcq')
  const quiz2 = validated('quiz-002', 'swipe-binary')
  const scrubber1 = validated('scr-001', 'scrubber')

  it('passes a calendar of unique ids that all resolve to non-scrubber puzzles', () => {
    const errors = validateDailyCalendar(['quiz-001', 'quiz-002'], [quiz1, quiz2, scrubber1])
    expect(errors).toEqual([])
  })

  it('flags a calendar entry that does not match any valid puzzle', () => {
    const errors = validateDailyCalendar(['quiz-001', 'missing-id'], [quiz1, quiz2])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('missing-id')
    expect(errors[0]).toContain('does not match any valid puzzle')
  })

  it('flags a duplicate id within the calendar, naming its position', () => {
    const errors = validateDailyCalendar(['quiz-001', 'quiz-001'], [quiz1])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('duplicate id "quiz-001"')
    expect(errors[0]).toContain('position 1')
  })

  it('rejects a scrubber puzzle id by rule, not by accident (P0)', () => {
    // Daily's own curated list happening not to contain a scrubber id today
    // is not the guarantee — see docs/v2-phase2-review.md, P0 ("Daily is
    // safe by accident, not design"). This asserts the rule itself: any
    // scrubber id in the calendar is a hard validation failure.
    const errors = validateDailyCalendar(['quiz-001', 'scr-001'], [quiz1, quiz2, scrubber1])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('scr-001')
    expect(errors[0]).toContain('is a scrubber puzzle')
  })

  it('flags both the scrubber id (first occurrence) and the duplicate (second occurrence) independently', () => {
    const errors = validateDailyCalendar(['scr-001', 'scr-001'], [scrubber1])
    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain('is a scrubber puzzle')
    expect(errors[1]).toContain('duplicate id "scr-001"')
  })
})
