import { describe, expect, it } from 'vitest'
import { buildRushShareText } from './shareText'
import { puzzlePool } from '../../content/pools'

// A real, bundled puzzle id (v2 Phase 1b) — asserted against the real pool
// rather than an arbitrary fixture string.
const REAL_PUZZLE_ID = 'con-005'
if (!puzzlePool.some((puzzle) => puzzle.id === REAL_PUZZLE_ID)) {
  throw new Error(`REAL_PUZZLE_ID "${REAL_PUZZLE_ID}" is no longer in puzzlePool`)
}

describe('buildRushShareText', () => {
  it('matches the build-plan format', () => {
    const text = buildRushShareText({
      solvedCount: 23,
      bestStreakThisRun: 31,
      puzzleId: REAL_PUZZLE_ID,
    })
    expect(text).toBe(
      `Codoro Rush — 23 solved · 🔥 best 31 — getcodoro.com/puzzle/${REAL_PUZZLE_ID}`,
    )
  })

  it('renders a zero-solved run correctly', () => {
    const text = buildRushShareText({
      solvedCount: 0,
      bestStreakThisRun: 0,
      puzzleId: REAL_PUZZLE_ID,
    })
    expect(text).toBe(`Codoro Rush — 0 solved · 🔥 best 0 — getcodoro.com/puzzle/${REAL_PUZZLE_ID}`)
  })

  it('generates a URL that resolves to a real bundled puzzle id', () => {
    const text = buildRushShareText({
      solvedCount: 5,
      bestStreakThisRun: 5,
      puzzleId: REAL_PUZZLE_ID,
    })
    const match = /getcodoro\.com\/puzzle\/([\w-]+)/.exec(text)
    expect(match).not.toBeNull()
    const linkedId = match?.[1]
    expect(puzzlePool.some((puzzle) => puzzle.id === linkedId)).toBe(true)
  })
})
