import { describe, expect, it } from 'vitest'
import { buildShareText } from './shareText'
import { puzzlePool } from '../../content'

// A real, bundled puzzle id (v2 Phase 1b) — asserted against the real pool
// rather than an arbitrary fixture string, so the generated URL is
// guaranteed to resolve to a real /puzzle/:id page.
const REAL_PUZZLE_ID = 'con-005'
if (!puzzlePool.some((puzzle) => puzzle.id === REAL_PUZZLE_ID)) {
  throw new Error(`REAL_PUZZLE_ID "${REAL_PUZZLE_ID}" is no longer in puzzlePool`)
}

describe('buildShareText', () => {
  it('matches the exact Wordle-style format from the build plan (first-try success)', () => {
    const text = buildShareText({
      dayNumber: 37,
      correct: true,
      streak: 12,
      puzzleId: REAL_PUZZLE_ID,
    })
    expect(text).toBe(
      `Codoro Daily #37 — ✅ first try — 🔥 12-day streak — getcodoro.com/puzzle/${REAL_PUZZLE_ID}`,
    )
  })

  it('renders a missed first attempt with a distinct icon/copy, still no spoilers', () => {
    const text = buildShareText({
      dayNumber: 5,
      correct: false,
      streak: 1,
      puzzleId: REAL_PUZZLE_ID,
    })
    expect(text).toBe(
      `Codoro Daily #5 — ❌ missed it — 🔥 1-day streak — getcodoro.com/puzzle/${REAL_PUZZLE_ID}`,
    )
  })

  it('renders a zero streak correctly (first-ever Daily completion)', () => {
    const text = buildShareText({
      dayNumber: 1,
      correct: true,
      streak: 0,
      puzzleId: REAL_PUZZLE_ID,
    })
    expect(text).toBe(
      `Codoro Daily #1 — ✅ first try — 🔥 0-day streak — getcodoro.com/puzzle/${REAL_PUZZLE_ID}`,
    )
  })

  it('never includes puzzle-specific content (prompt/explanation) — no spoilers by construction', () => {
    const text = buildShareText({
      dayNumber: 37,
      correct: true,
      streak: 12,
      puzzleId: REAL_PUZZLE_ID,
    })
    expect(text).not.toMatch(/explanation|prompt|snippet/i)
  })

  it('generates a URL that resolves to a real bundled puzzle id', () => {
    const text = buildShareText({
      dayNumber: 1,
      correct: true,
      streak: 0,
      puzzleId: REAL_PUZZLE_ID,
    })
    const match = /getcodoro\.com\/puzzle\/([\w-]+)/.exec(text)
    expect(match).not.toBeNull()
    const linkedId = match?.[1]
    expect(puzzlePool.some((puzzle) => puzzle.id === linkedId)).toBe(true)
  })
})
