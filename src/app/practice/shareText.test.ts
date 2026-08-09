import { describe, expect, it } from 'vitest'
import { buildPracticeShareText, buildPracticeChallengeText } from './shareText'
import { decodeChallengePayload, MAX_CHALLENGE_PUZZLES } from '../../challenge'
import type { ChallengeAttemptInput } from '../../challenge'
import { puzzlePool } from '../../content'

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

describe('buildPracticeChallengeText', () => {
  it("encodes the live streak's correct answers into a playable /challenge link", () => {
    const attempts: ChallengeAttemptInput[] = [
      { puzzleId: REAL_PUZZLE_ID, correct: true, time_ms: 900 },
      { puzzleId: 'tc-009', correct: true, time_ms: 1100 },
      { puzzleId: REAL_PUZZLE_ID, correct: true, time_ms: 700 },
    ]
    const text = buildPracticeChallengeText({ attempts })
    expect(text).toMatch(
      /^Beat my Codoro Practice streak — 3 in a row — getcodoro\.com\/challenge#/,
    )
    const decoded = decodeChallengePayload(text.split('#')[1] ?? '')
    expect(decoded).not.toBeNull()
    expect(decoded?.ids).toHaveLength(3)
    expect(decoded?.results).toHaveLength(3)
    expect(decoded?.results.every((result) => result.correct)).toBe(true)
  })

  it('headline counts what is encoded, not the raw streak (truncation)', () => {
    const attempts: ChallengeAttemptInput[] = Array.from({ length: 8 }, (_, i) => ({
      puzzleId: i % 2 === 0 ? REAL_PUZZLE_ID : 'tc-009',
      correct: true,
      time_ms: 500,
    }))
    const text = buildPracticeChallengeText({ attempts })
    expect(text).toMatch(/^Beat my Codoro Practice streak — 5 in a row — /)
    const decoded = decodeChallengePayload(text.split('#')[1] ?? '')
    expect(decoded).not.toBeNull()
    expect(decoded?.ids).toHaveLength(MAX_CHALLENGE_PUZZLES)
  })
})
