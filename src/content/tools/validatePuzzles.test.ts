import { describe, expect, it } from 'vitest'
import { validatePuzzleFiles } from './validatePuzzles'
import type { RawPuzzleFile } from './loadPuzzles'

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
  overrides: Record<string, unknown> = {},
): unknown {
  return {
    id,
    pattern: 'type-coercion',
    difficulty_rating: 1100,
    explanation: 'A real explanation.',
    prompt: 'Is this safe?',
    language: 'javascript',
    snippet: 'if (value == "0") {\n  return false\n}',
    interaction: 'swipe-binary',
    left_label: 'Safe',
    right_label: 'Buggy',
    correct_direction: correctDirection,
    ...overrides,
  }
}

/** Builds `count` swipe-binary files, `rightCount` of them "right", the rest "left". */
function swipeBinaryFixture(count: number, rightCount: number): RawPuzzleFile[] {
  return Array.from({ length: count }, (_, i) => ({
    filePath: `swipe-${String(i)}.json`,
    raw: rawSwipeBinary(`tc-${String(i).padStart(3, '0')}`, i < rightCount ? 'right' : 'left'),
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
})
