import { describe, expect, it } from 'vitest'
import { resolveChallengeOutcome } from './challengeOutcome'

describe('resolveChallengeOutcome', () => {
  it('declares a win when the recipient has more correct answers, even if slower', () => {
    expect(
      resolveChallengeOutcome({ correct: 4, totalMs: 63_000 }, { correct: 3, totalMs: 20_000 }),
    ).toBe('won')
  })

  it('declares a loss when the recipient has fewer correct answers, even if faster', () => {
    expect(
      resolveChallengeOutcome({ correct: 2, totalMs: 15_000 }, { correct: 4, totalMs: 60_000 }),
    ).toBe('lost')
  })

  it('uses total time as the tiebreaker when correct counts match — faster wins', () => {
    expect(
      resolveChallengeOutcome({ correct: 4, totalMs: 63_000 }, { correct: 4, totalMs: 48_000 }),
    ).toBe('lost')
    expect(
      resolveChallengeOutcome({ correct: 4, totalMs: 42_000 }, { correct: 4, totalMs: 48_000 }),
    ).toBe('won')
  })

  it('declares a tie only when both correct count and total time match', () => {
    expect(
      resolveChallengeOutcome({ correct: 5, totalMs: 48_000 }, { correct: 5, totalMs: 48_000 }),
    ).toBe('tied')
  })

  it('a perfect run is still lost to a faster perfect run (time beats perfection)', () => {
    expect(
      resolveChallengeOutcome({ correct: 5, totalMs: 61_000 }, { correct: 5, totalMs: 48_000 }),
    ).toBe('lost')
  })
})
