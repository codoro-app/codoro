import { describe, expect, it } from 'vitest'
import { scoreScrubberAttempt, scrubberActualScore } from './scrubber'
import type { CheckpointResult } from './scrubber'

function result(correct: boolean, choiceIndex = 0): CheckpointResult {
  return { correct, choiceIndex }
}

describe('scoreScrubberAttempt', () => {
  it('solves when every checkpoint is correct', () => {
    expect(scoreScrubberAttempt([result(true), result(true), result(true)])).toBe(true)
  })

  it('fails when the only checkpoint is missed', () => {
    expect(scoreScrubberAttempt([result(false)])).toBe(false)
  })

  it('fails when the first checkpoint is correct but a later one is missed', () => {
    expect(scoreScrubberAttempt([result(true), result(true), result(false)])).toBe(false)
  })

  it('fails when the first checkpoint is missed even if every later one is correct', () => {
    expect(scoreScrubberAttempt([result(false), result(true), result(true)])).toBe(false)
  })

  it('fails on an empty result set (no checkpoints answered is not a solve)', () => {
    expect(scoreScrubberAttempt([])).toBe(false)
  })

  it('solves with the minimum of two checkpoints, both correct', () => {
    expect(scoreScrubberAttempt([result(true), result(true)])).toBe(true)
  })
})

describe('scrubberActualScore', () => {
  it('is 1 when every checkpoint is correct, regardless of choice count', () => {
    expect(scrubberActualScore([result(true), result(true), result(true)], [2, 3, 5])).toBe(1)
  })

  it('is 0 when every checkpoint is missed', () => {
    expect(scrubberActualScore([result(false), result(false)], [2, 2])).toBe(0)
  })

  it('is 0 (not the raw 0.5) for a mixed result exactly at the guess floor (1 of 2, both 2-choice checkpoints)', () => {
    // This is the whole point of the guess-floor correction: 1-of-2 correct
    // on binary checkpoints is exactly what pure guessing would produce on
    // average, so it must read as zero skill signal, not partial credit.
    expect(scrubberActualScore([result(true), result(false)], [2, 2])).toBe(0)
  })

  it('rescales a mixed result above the guess floor (3 of 4, all 2-choice checkpoints)', () => {
    // raw = 0.75, floor = 0.5 (mean of 1/2 four times) →
    // (0.75 - 0.5) / (1 - 0.5) = 0.5, not the raw 0.75.
    expect(
      scrubberActualScore([result(true), result(true), result(true), result(false)], [2, 2, 2, 2]),
    ).toBe(0.5)
  })

  it('accounts for a higher per-checkpoint choice count lowering the guess floor', () => {
    // Both attempts have raw correct-fraction 0.5, but one pool has a much
    // lower guess floor (5-choice checkpoints) than the other (2-choice) —
    // the 5-choice attempt must rescale higher, since getting half right on
    // a 1-in-5 checkpoint is much less explainable by luck than getting
    // half right on a coin flip.
    const twoChoiceScore = scrubberActualScore([result(true), result(false)], [2, 2])
    const fiveChoiceScore = scrubberActualScore([result(true), result(false)], [5, 5])
    expect(fiveChoiceScore).toBeGreaterThan(twoChoiceScore)
    // raw = 0.5, floor = 0.2 → (0.5 - 0.2) / (1 - 0.2) = 0.375
    expect(fiveChoiceScore).toBeCloseTo(0.375, 10)
  })

  it('clamps an unlucky sub-floor raw score to 0, not negative', () => {
    // raw = 0, floor = mean(1/2, 1/5) = 0.35 → (0 - 0.35) / (1 - 0.35) is
    // negative before clamping.
    expect(scrubberActualScore([result(false), result(false)], [2, 5])).toBe(0)
  })

  it('is 0 (not NaN) on an empty result set', () => {
    expect(scrubberActualScore([], [])).toBe(0)
  })

  it('does not care about choiceIndex, only correct', () => {
    expect(scrubberActualScore([result(true, 3), result(false, 0)], [5, 5])).toBe(
      scrubberActualScore([result(true, 0), result(false, 1)], [5, 5]),
    )
  })
})
