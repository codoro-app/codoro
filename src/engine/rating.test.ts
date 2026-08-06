import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  expectedScore,
  getK,
  updateRating,
  roundForDisplay,
  shouldRateAttempt,
  RATING_FLOOR,
} from './rating'

// Tolerance rationale: the logistic is exact real-number math evaluated in IEEE
// 754 doubles, so the only error is floating-point rounding (~1e-15). We assert
// to 3 decimals (toBeCloseTo threshold 5e-4) — far looser than the actual error,
// but it documents the textbook Elo values (1/(1+10^1) = 0.0909…) as the intent.
const EXPECTED_SCORE_DIGITS = 3

describe('expectedScore', () => {
  it('is exactly 0.5 for equal ratings', () => {
    expect(expectedScore(1500, 1500)).toBe(0.5)
  })

  it('is ~0.0909 when the puzzle is 400 points above the user', () => {
    expect(expectedScore(1200, 1600)).toBeCloseTo(0.0909, EXPECTED_SCORE_DIGITS)
  })

  it('is ~0.9091 when the puzzle is 400 points below the user', () => {
    expect(expectedScore(1600, 1200)).toBeCloseTo(0.9091, EXPECTED_SCORE_DIGITS)
  })
})

describe('getK', () => {
  it('is 32 for the first 20 rated attempts (counts 0..19)', () => {
    expect(getK(0)).toBe(32)
    expect(getK(19)).toBe(32)
  })

  it('is 24 from the 21st rated attempt onward (counts >= 20)', () => {
    expect(getK(20)).toBe(24)
    expect(getK(21)).toBe(24)
    expect(getK(1000)).toBe(24)
  })
})

describe('updateRating', () => {
  it('adds exactly +K/2 (+16) for a correct answer at equal ratings, K=32 tier', () => {
    expect(updateRating(1200, 1200, true, 0)).toBe(1216)
  })

  it('subtracts exactly K/2 (-16) for a wrong answer at equal ratings, K=32 tier', () => {
    expect(updateRating(1200, 1200, false, 0)).toBe(1184)
  })

  it('adds exactly +12 for a correct answer at equal ratings, K=24 tier', () => {
    expect(updateRating(1200, 1200, true, 20)).toBe(1212)
  })

  it('subtracts exactly 12 for a wrong answer at equal ratings, K=24 tier', () => {
    expect(updateRating(1200, 1200, false, 20)).toBe(1188)
  })

  describe('fractional actual score (Trace per-checkpoint partial credit)', () => {
    it('treats a fractional actual identically to a boolean at the same value (1 === true, 0 === false)', () => {
      expect(updateRating(1200, 1200, 1, 0)).toBe(updateRating(1200, 1200, true, 0))
      expect(updateRating(1200, 1200, 0, 0)).toBe(updateRating(1200, 1200, false, 0))
    })

    it('a 0.5 actual at equal ratings (expected 0.5) produces no change', () => {
      expect(updateRating(1200, 1200, 0.5, 0)).toBe(1200)
    })

    it('a 0.75 actual earns a smaller positive delta than a full correct at equal ratings', () => {
      const partial = updateRating(1200, 1200, 0.75, 0)
      const full = updateRating(1200, 1200, true, 0)
      expect(partial).toBeGreaterThan(1200)
      expect(partial).toBeLessThan(full)
    })
  })

  describe('kMultiplier', () => {
    it('defaults to 1 — omitting it matches passing 1 explicitly', () => {
      expect(updateRating(1200, 1200, true, 0)).toBe(updateRating(1200, 1200, true, 0, 1))
    })

    it('scales the delta proportionally (1.5x multiplier over the K=32 tier: +16 -> +24)', () => {
      expect(updateRating(1200, 1200, true, 0, 1.5)).toBe(1224)
    })
  })

  describe('floor', () => {
    // Spec note (interpretation flagged in report): a rating near the floor
    // "facing a much higher puzzle" and answering wrong does NOT actually clamp
    // — the expected score against a much-higher puzzle is ~0, so the penalty is
    // ~0 and the result stays put (still >= 400). The clamp only fires on a large
    // penalty, i.e. an upset loss against an equal/lower puzzle. We test both.
    it('clamps to exactly 400 when a near-floor upset loss would go below it', () => {
      // 410 - 16 (equal-rating wrong, K=32) = 394 -> clamped to 400.
      expect(updateRating(410, 410, false, 0)).toBe(RATING_FLOOR)
    })

    it('stays at or above 400 for a near-floor user facing a much higher puzzle (wrong)', () => {
      expect(updateRating(401, 3000, false, 0)).toBeGreaterThanOrEqual(RATING_FLOOR)
    })

    it('never dips below 400 when already at the floor and losing', () => {
      expect(updateRating(400, 100, false, 0)).toBe(RATING_FLOOR)
    })
  })

  describe('input validation (fail loud, never persist a corrupt rating)', () => {
    it('throws on a non-finite userRating', () => {
      expect(() => updateRating(NaN, 1200, true, 0)).toThrow(/finite/)
      expect(() => updateRating(Infinity, 1200, true, 0)).toThrow(/finite/)
    })

    it('throws on a non-finite puzzleRating', () => {
      expect(() => updateRating(1200, NaN, true, 0)).toThrow(/finite/)
    })

    it('throws on a fractional correct outside [0, 1]', () => {
      expect(() => updateRating(1200, 1200, 1.5, 0)).toThrow(/\[0, 1\]/)
      expect(() => updateRating(1200, 1200, -0.1, 0)).toThrow(/\[0, 1\]/)
      expect(() => updateRating(1200, 1200, NaN, 0)).toThrow(/\[0, 1\]/)
    })

    it('accepts the boundary fractional values 0 and 1', () => {
      expect(() => updateRating(1200, 1200, 0, 0)).not.toThrow()
      expect(() => updateRating(1200, 1200, 1, 0)).not.toThrow()
    })
  })
})

describe('roundForDisplay', () => {
  it('rounds a float rating to the nearest integer', () => {
    expect(roundForDisplay(1215.6)).toBe(1216)
    expect(roundForDisplay(1215.4)).toBe(1215)
    expect(roundForDisplay(400)).toBe(400)
  })
})

describe('shouldRateAttempt', () => {
  it('always rates practice attempts', () => {
    expect(shouldRateAttempt('practice', true)).toBe(true)
    expect(shouldRateAttempt('practice', false)).toBe(true)
  })

  it('rates daily attempts only on the first attempt of the day', () => {
    expect(shouldRateAttempt('daily', true)).toBe(true)
    expect(shouldRateAttempt('daily', false)).toBe(false)
  })

  it('never rates rush attempts', () => {
    expect(shouldRateAttempt('rush', true)).toBe(false)
    expect(shouldRateAttempt('rush', false)).toBe(false)
  })
})

// Domain rationale: user/puzzle ratings are drawn from [0, 3000], comfortably
// covering the real operating range (floor 400, puzzle difficulty 800..2400) plus
// headroom. The gap is capped at 3000, so 10**(±gap/400) stays within [1e-8, 1e8]
// — far from double-precision underflow, meaning 1 + 10**(gap/400) never rounds to
// exactly 1 and the score stays *strictly* inside (0, 1). A wider gap (e.g. 8000)
// would let 10**(-gap/400) fall below machine epsilon, making the score round to 1.
const ratingArb = fc.integer({ min: 0, max: 3000 })
// For update-magnitude / monotonicity properties we constrain the user rating to
// [400, 3000] (at or above the floor) so clamping never inflates the delta.
const atOrAboveFloorArb = fc.integer({ min: 400, max: 3000 })
const countArb = fc.integer({ min: 0, max: 200 })

describe('properties', () => {
  it('expectedScore is strictly within (0, 1)', () => {
    fc.assert(
      fc.property(ratingArb, ratingArb, (user, puzzle) => {
        const score = expectedScore(user, puzzle)
        return score > 0 && score < 1
      }),
    )
  })

  it('a correct answer never decreases the rating', () => {
    fc.assert(
      fc.property(atOrAboveFloorArb, ratingArb, countArb, (user, puzzle, count) => {
        return updateRating(user, puzzle, true, count) >= user
      }),
    )
  })

  it('a wrong answer never increases the rating', () => {
    fc.assert(
      fc.property(atOrAboveFloorArb, ratingArb, countArb, (user, puzzle, count) => {
        return updateRating(user, puzzle, false, count) <= user
      }),
    )
  })

  it('the rating is never below the floor, even starting at the floor', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 6000 }),
        ratingArb,
        fc.boolean(),
        countArb,
        (user, puzzle, correct, count) => {
          return updateRating(user, puzzle, correct, count) >= RATING_FLOOR
        },
      ),
    )
  })

  it('the update magnitude never exceeds the active K', () => {
    fc.assert(
      fc.property(
        atOrAboveFloorArb,
        ratingArb,
        fc.boolean(),
        countArb,
        (user, puzzle, correct, count) => {
          const delta = Math.abs(updateRating(user, puzzle, correct, count) - user)
          return delta <= getK(count)
        },
      ),
    )
  })

  it('never rates a rush attempt regardless of isFirstAttemptOfDay', () => {
    fc.assert(
      fc.property(fc.boolean(), (isFirstAttemptOfDay) => {
        return !shouldRateAttempt('rush', isFirstAttemptOfDay)
      }),
    )
  })
})
