import { describe, expect, it } from 'vitest'
import { computeMastery, MASTERY_WINDOW, MIN_ATTEMPTS_FOR_MASTERY } from './mastery'
import type { Attempt } from '../../storage'
import type { Puzzle } from '../../content'

function makeAttempt(
  overrides: Partial<Attempt> & { puzzleId: string; correct: boolean },
): Attempt {
  return {
    id: `attempt-${Math.random().toString(36).slice(2)}`,
    puzzleRating: 1200,
    mode: 'practice',
    time_ms: 1000,
    choice_index: null,
    userRatingBefore: 1200,
    userRatingAfter: 1200,
    localDateString: '2026-07-17',
    createdAt: '2026-07-17T00:00:00.000Z',
    ...overrides,
  }
}

function makePuzzle(id: string, pattern: Puzzle['pattern']): Puzzle {
  return {
    id,
    pattern,
    difficulty_rating: 1200,
    explanation: 'because',
    prompt: 'what is wrong',
    language: 'javascript',
    snippet: 'const x = 1',
    interaction: 'mcq',
    choices: ['a', 'b'],
    correct_choice: 0,
  }
}

describe('computeMastery', () => {
  it('returns one entry per pattern slug, even with zero attempts', () => {
    const result = computeMastery([], [])
    expect(result.length).toBeGreaterThan(0)
    for (const entry of result) {
      expect(entry.attemptCount).toBe(0)
      expect(entry.accuracy).toBeNull()
    }
  })

  it('reports null accuracy below the minimum-attempts threshold', () => {
    const pool = [makePuzzle('p1', 'off-by-one')]
    const attempts = Array.from({ length: MIN_ATTEMPTS_FOR_MASTERY - 1 }, () =>
      makeAttempt({ puzzleId: 'p1', correct: true }),
    )
    const result = computeMastery(attempts, pool)
    const offByOne = result.find((entry) => entry.pattern === 'off-by-one')
    expect(offByOne?.attemptCount).toBe(MIN_ATTEMPTS_FOR_MASTERY - 1)
    expect(offByOne?.accuracy).toBeNull()
  })

  it('computes accuracy once the minimum threshold is met', () => {
    const pool = [makePuzzle('p1', 'off-by-one')]
    const attempts = [
      ...Array.from({ length: 3 }, () => makeAttempt({ puzzleId: 'p1', correct: true })),
      ...Array.from({ length: 2 }, () => makeAttempt({ puzzleId: 'p1', correct: false })),
    ]
    const result = computeMastery(attempts, pool)
    const offByOne = result.find((entry) => entry.pattern === 'off-by-one')
    expect(offByOne?.attemptCount).toBe(5)
    expect(offByOne?.accuracy).toBeCloseTo(0.6)
  })

  it('separates attempts by pattern via the puzzle-id lookup', () => {
    const pool = [makePuzzle('p1', 'off-by-one'), makePuzzle('p2', 'null-undefined')]
    const attempts = [
      ...Array.from({ length: 5 }, () => makeAttempt({ puzzleId: 'p1', correct: true })),
      ...Array.from({ length: 5 }, () => makeAttempt({ puzzleId: 'p2', correct: false })),
    ]
    const result = computeMastery(attempts, pool)
    expect(result.find((entry) => entry.pattern === 'off-by-one')?.accuracy).toBe(1)
    expect(result.find((entry) => entry.pattern === 'null-undefined')?.accuracy).toBe(0)
  })

  it('applies the last-20 (MASTERY_WINDOW) window, dropping older attempts', () => {
    const pool = [makePuzzle('p1', 'off-by-one')]
    // 25 oldest-first attempts: first 5 wrong, last 20 correct. Only the
    // window (last 20, all correct) should count.
    const attempts = [
      ...Array.from({ length: 5 }, () => makeAttempt({ puzzleId: 'p1', correct: false })),
      ...Array.from({ length: MASTERY_WINDOW }, () =>
        makeAttempt({ puzzleId: 'p1', correct: true }),
      ),
    ]
    expect(attempts.length).toBe(25)
    const result = computeMastery(attempts, pool)
    const offByOne = result.find((entry) => entry.pattern === 'off-by-one')
    expect(offByOne?.attemptCount).toBe(MASTERY_WINDOW)
    expect(offByOne?.accuracy).toBe(1)
  })

  it('skips attempts whose puzzleId no longer resolves to a pool entry', () => {
    const pool = [makePuzzle('p1', 'off-by-one')]
    const attempts = [
      ...Array.from({ length: 5 }, () => makeAttempt({ puzzleId: 'p1', correct: true })),
      makeAttempt({ puzzleId: 'stale-removed-puzzle', correct: false }),
    ]
    const result = computeMastery(attempts, pool)
    const offByOne = result.find((entry) => entry.pattern === 'off-by-one')
    expect(offByOne?.attemptCount).toBe(5)
    expect(offByOne?.accuracy).toBe(1)
  })
})
