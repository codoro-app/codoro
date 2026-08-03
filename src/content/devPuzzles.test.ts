import { describe, expect, it } from 'vitest'
import { PuzzleSchema } from './schema'
import { DEV_STUB_PUZZLES } from './devPuzzles'

describe('DEV_STUB_PUZZLES', () => {
  it('is non-empty', () => {
    expect(DEV_STUB_PUZZLES.length).toBeGreaterThan(0)
  })

  it('every entry is schema-valid', () => {
    for (const puzzle of DEV_STUB_PUZZLES) {
      const result = PuzzleSchema.safeParse(puzzle)
      expect(result.success, JSON.stringify(result.success ? null : result.error.issues)).toBe(true)
    }
  })

  it('has unique ids', () => {
    const ids = DEV_STUB_PUZZLES.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('the "correct" side is always unambiguously correct', () => {
    for (const puzzle of DEV_STUB_PUZZLES) {
      if (puzzle.interaction === 'mcq') {
        expect(puzzle.choices[puzzle.correct_choice]).toBe('Correct answer')
      }
      if (puzzle.interaction === 'swipe-binary') {
        expect(puzzle.correct_direction === 'right' ? puzzle.right_label : puzzle.left_label).toBe(
          'Correct',
        )
      }
      if (puzzle.interaction === 'tap-line') {
        expect(puzzle.correct_line).toBe(0)
      }
      if (puzzle.interaction === 'drag-order') {
        // Each block literally names its own correct position ("Correct
        // order: N") — unambiguous to solve by reading alone, without the
        // display order itself being the answer (PuzzleSchema rejects an
        // identity correct_order).
        expect(puzzle.correct_order.map((index) => puzzle.blocks[index])).toEqual(
          puzzle.blocks.map((_, position) => `Correct order: ${String(position + 1)}`),
        )
      }
    }
  })

  it('spans multiple difficulty bands, for Rush ramp / Practice windowing', () => {
    const ratings = new Set(DEV_STUB_PUZZLES.map((p) => p.difficulty_rating))
    expect(ratings.size).toBeGreaterThanOrEqual(3)
  })
})
