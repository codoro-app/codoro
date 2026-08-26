import { describe, expect, it } from 'vitest'
import { buildRushShareText, buildRushChallengeText } from './shareText'
import { decodeChallengePayload, MAX_CHALLENGE_PUZZLES } from '../../challenge'
import type { ChallengeAttemptInput } from '../../challenge'
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

describe('buildRushChallengeText', () => {
  it("encodes the run's attempts into a playable /challenge link with the run headline", () => {
    const attempts: ChallengeAttemptInput[] = [
      { puzzleId: REAL_PUZZLE_ID, correct: true, time_ms: 1200 },
      { puzzleId: 'tc-009', correct: false, time_ms: 800 },
    ]
    const text = buildRushChallengeText({ solvedCount: 1, bestStreakThisRun: 1, attempts })
    expect(text).toMatch(/^Beat my Codoro Rush — 1 solved · 🔥 best 1 — getcodoro\.com\/challenge#/)
    const decoded = decodeChallengePayload(text.split('#')[1] ?? '')
    expect(decoded).not.toBeNull()
    expect(decoded?.ids).toEqual([REAL_PUZZLE_ID, 'tc-009'])
    expect(decoded?.results).toEqual([
      { correct: true, time_ms: 1200 },
      { correct: false, time_ms: 800 },
    ])
  })

  it('truncates a longer run to the last MAX_CHALLENGE_PUZZLES', () => {
    const attempts: ChallengeAttemptInput[] = Array.from({ length: 7 }, (_, i) => ({
      puzzleId: i % 2 === 0 ? REAL_PUZZLE_ID : 'tc-009',
      correct: true,
      time_ms: 1000 + i,
    }))
    const text = buildRushChallengeText({ solvedCount: 7, bestStreakThisRun: 3, attempts })
    const decoded = decodeChallengePayload(text.split('#')[1] ?? '')
    expect(decoded).not.toBeNull()
    expect(decoded?.ids).toHaveLength(MAX_CHALLENGE_PUZZLES)
  })
})
