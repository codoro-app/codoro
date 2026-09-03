import { describe, expect, it } from 'vitest'
import { buildPracticeShareText } from './shareText'
import { puzzlePool } from '../../content/pools'

// A real, bundled puzzle id (v2 Phase 1b) — asserted against the real pool
// rather than an arbitrary fixture string.
const REAL_PUZZLE_ID = 'con-005'
if (!puzzlePool.some((puzzle) => puzzle.id === REAL_PUZZLE_ID)) {
  throw new Error(`REAL_PUZZLE_ID "${REAL_PUZZLE_ID}" is no longer in puzzlePool`)
}

describe('buildPracticeShareText', () => {
  it('renders a solved puzzle', () => {
    const text = buildPracticeShareText({ puzzleId: REAL_PUZZLE_ID, correct: true })
    expect(text).toBe(`Codoro Practice — ✅ solved it — getcodoro.com/puzzle/${REAL_PUZZLE_ID}`)
  })

  it('renders a missed puzzle with a distinct icon/copy', () => {
    const text = buildPracticeShareText({ puzzleId: REAL_PUZZLE_ID, correct: false })
    expect(text).toBe(`Codoro Practice — ❌ missed it — getcodoro.com/puzzle/${REAL_PUZZLE_ID}`)
  })

  it('never includes puzzle-specific content (prompt/explanation) — no spoilers by construction', () => {
    const text = buildPracticeShareText({ puzzleId: REAL_PUZZLE_ID, correct: true })
    expect(text).not.toMatch(/explanation|prompt|snippet/i)
  })

  it('generates a URL that resolves to a real bundled puzzle id', () => {
    const text = buildPracticeShareText({ puzzleId: REAL_PUZZLE_ID, correct: true })
    const match = /getcodoro\.com\/puzzle\/([\w-]+)/.exec(text)
    expect(match).not.toBeNull()
    const linkedId = match?.[1]
    expect(puzzlePool.some((puzzle) => puzzle.id === linkedId)).toBe(true)
  })
})
