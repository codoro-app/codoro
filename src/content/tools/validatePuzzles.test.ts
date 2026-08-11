import { describe, expect, it } from 'vitest'
import {
  validateBossRun,
  validateDailyCalendar,
  validateInteractionMix,
  validateLanguageMix,
  validatePuzzleFiles,
  validateRatingCluster,
} from './validatePuzzles'
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

    it('accepts a "safe" puzzle expressed as "No bug" on the correct side (negation guard)', () => {
      // A negated-defect label is the most natural way to claim "code is
      // fine", but a naive defect-token dictionary would flag it (it
      // contains "bug"). The SAFE regex's `no ?bug` is meant to bless it, so
      // DEFECT must not fire on a bare "bug" preceded by "no ".
      const files: RawPuzzleFile[] = [
        {
          filePath: 'a.json',
          raw: rawSwipeBinary('sb-100', 'left', 'safe', { left_label: 'No bug — runs correctly' }),
        },
        { filePath: 'b.json', raw: rawSwipeBinary('sb-101', 'right', 'bug') },
        { filePath: 'c.json', raw: rawSwipeBinary('sb-102', 'left', 'bug') },
      ]

      const flagged = validatePuzzleFiles(files).errors.filter((e) =>
        e.includes('does not claim the code is fine'),
      )
      expect(flagged).toHaveLength(0)
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

describe('Phase 6 DoD library gates', () => {
  function rated(id: string, rating: number): ValidatedPuzzle {
    return {
      filePath: `${id}.json`,
      puzzle: { id, difficulty_rating: rating } as unknown as Puzzle,
    }
  }

  function quizPuzzle(id: string, language: string, interaction = 'mcq'): ValidatedPuzzle {
    return { filePath: `${id}.json`, puzzle: { id, language, interaction } as unknown as Puzzle }
  }

  function manyQuizPuzzles(
    idPrefix: string,
    count: number,
    interaction: string,
    language = 'python',
  ): ValidatedPuzzle[] {
    return Array.from({ length: count }, (_, i) =>
      quizPuzzle(`${idPrefix}-${String(i).padStart(3, '0')}`, language, interaction),
    )
  }

  describe('validateRatingCluster', () => {
    it('passes when no exact rating exceeds 15% of the pool', () => {
      const files = [1000, 1100, 1200, 1300, 1400, 1500, 1600, 1700].map((rating, i) =>
        rated(`r-${String(i)}`, rating),
      )
      expect(validateRatingCluster(files)).toEqual([])
    })

    it('fails when a single rating anchors more than 15% of the pool', () => {
      const files = Array.from({ length: 10 }, (_, i) => rated(`r-${String(i)}`, 1000))
      const errors = validateRatingCluster(files)
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain('anti-anchoring')
      expect(errors[0]).toContain('1000')
    })
  })

  describe('validateLanguageMix', () => {
    it('passes a quiz pool inside the ±10pt band of 40/25/25/10', () => {
      const files = [
        ...manyQuizPuzzles('js', 4, 'mcq', 'javascript'),
        ...manyQuizPuzzles('py', 3, 'mcq', 'python'),
        ...manyQuizPuzzles('jv', 2, 'mcq', 'java'),
        ...manyQuizPuzzles('c', 1, 'mcq', 'c'),
      ]
      expect(validateLanguageMix(files)).toEqual([])
    })

    it('fails an all-JavaScript quiz pool, naming the language', () => {
      const files = manyQuizPuzzles('js', 10, 'mcq', 'javascript')
      const errors = validateLanguageMix(files)
      expect(errors).toHaveLength(1)
      expect(errors[0]).toContain('language mix')
      expect(errors[0]).toContain('javascript')
    })

    it('ignores scrubber puzzles when computing the quiz mix', () => {
      const files = manyQuizPuzzles('c', 10, 'scrubber', 'c')
      expect(validateLanguageMix(files)).toEqual([])
    })
  })

  describe('validateInteractionMix (new-content delta vs the Phase 5 baseline)', () => {
    // Baseline is the Phase 5 library: 154 total, 111 quiz (42 mcq), 3 drag + 43 scrubber.

    it('passes a realistic addition that respects both new-content rules', () => {
      // 45 mcq + 75 swipe quiz (120 quiz), plus 50 scrubber + 10 drag = 180 total.
      // new quiz = 9, new mcq = 3 (≤⅓); new content = 26, new interactive = 14 (≥⅓).
      const files: ValidatedPuzzle[] = [
        ...Array.from({ length: 45 }, (_, i) =>
          validated(`m-${String(i).padStart(3, '0')}`, 'mcq'),
        ),
        ...Array.from({ length: 75 }, (_, i) =>
          validated(`s-${String(i).padStart(3, '0')}`, 'swipe-binary'),
        ),
        ...Array.from({ length: 50 }, (_, i) =>
          validated(`sb-${String(i).padStart(3, '0')}`, 'scrubber'),
        ),
        ...Array.from({ length: 10 }, (_, i) =>
          validated(`d-${String(i).padStart(3, '0')}`, 'drag-order'),
        ),
      ]
      expect(validateInteractionMix(files)).toEqual([])
    })

    it('fails when new quiz is dominated by plain mcq', () => {
      // 130 mcq + 46 scrubber = 176 total. new quiz = 19, new mcq = 88 → way over ⅓.
      const files: ValidatedPuzzle[] = [
        ...Array.from({ length: 130 }, (_, i) =>
          validated(`m-${String(i).padStart(3, '0')}`, 'mcq'),
        ),
        ...Array.from({ length: 46 }, (_, i) =>
          validated(`sb-${String(i).padStart(3, '0')}`, 'scrubber'),
        ),
      ]
      const errors = validateInteractionMix(files)
      expect(errors.some((e) => e.includes('plain mcq'))).toBe(true)
    })

    it('fails when new content is short of the ≥⅓ interactive floor', () => {
      // 45 mcq + 75 swipe quiz (120 quiz) + 46 scrubber = 166 total.
      // new quiz = 9, new mcq = 3 (ok); new content = 12, new interactive = 0 → below ⅓.
      const files: ValidatedPuzzle[] = [
        ...Array.from({ length: 45 }, (_, i) =>
          validated(`m-${String(i).padStart(3, '0')}`, 'mcq'),
        ),
        ...Array.from({ length: 75 }, (_, i) =>
          validated(`s-${String(i).padStart(3, '0')}`, 'swipe-binary'),
        ),
        ...Array.from({ length: 46 }, (_, i) =>
          validated(`sb-${String(i).padStart(3, '0')}`, 'scrubber'),
        ),
      ]
      const errors = validateInteractionMix(files)
      expect(errors.some((e) => e.includes('interactive'))).toBe(true)
    })
  })
})

function validated(id: string, interaction: string, difficulty_rating = 1000): ValidatedPuzzle {
  return {
    filePath: `${id}.json`,
    puzzle: { id, interaction, difficulty_rating } as unknown as Puzzle,
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

describe('validateBossRun', () => {
  const boss1 = validated('boss-001', 'mcq', 1000)
  const boss2 = validated('boss-002', 'mcq', 1100)
  const boss3 = validated('boss-003', 'mcq', 1050)
  const tenAscending = Array.from({ length: 10 }, (_, i) => `boss-${String(i).padStart(3, '0')}`)
  const tenAscendingValid = tenAscending.map((id, i) => validated(id, 'mcq', 1000 + i * 50))

  it('passes exactly 10 unique, non-scrubber, escalating ids', () => {
    const errors = validateBossRun(tenAscending, tenAscendingValid)
    expect(errors).toEqual([])
  })

  it('flags a run that is not exactly 10 entries long', () => {
    const errors = validateBossRun(['boss-001', 'boss-002'], [boss1, boss2])
    expect(errors.some((e) => e.includes('expected exactly 10 entries'))).toBe(true)
  })

  it('flags a duplicate id, naming its position', () => {
    const firstId = tenAscending[0]
    if (firstId === undefined) throw new Error('unreachable: tenAscending is non-empty')
    const tenWithDup = [...tenAscending.slice(0, 9), firstId]
    const errors = validateBossRun(tenWithDup, tenAscendingValid)
    expect(errors.some((e) => e.includes('duplicate id'))).toBe(true)
  })

  it('flags an entry that does not match any valid puzzle', () => {
    const tenWithMissing = [...tenAscending.slice(0, 9), 'missing-id']
    const errors = validateBossRun(tenWithMissing, tenAscendingValid)
    expect(errors.some((e) => e.includes('missing-id') && e.includes('does not match'))).toBe(true)
  })

  it('rejects a scrubber puzzle id (Boss needs a binary strike outcome)', () => {
    const errors = validateBossRun(
      ['boss-001', 'scr-001'],
      [boss1, validated('scr-001', 'scrubber', 1000)],
    )
    expect(errors.some((e) => e.includes('scrubber puzzle'))).toBe(true)
  })

  it('flags a rating that steps down instead of escalating', () => {
    const errors = validateBossRun(['boss-001', 'boss-002', 'boss-003'], [boss1, boss2, boss3])
    expect(errors.some((e) => e.includes('must escalate'))).toBe(true)
  })
})
