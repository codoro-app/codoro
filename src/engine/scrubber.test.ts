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
  it('is 1 when every checkpoint is correct', () => {
    expect(scrubberActualScore([result(true), result(true), result(true)])).toBe(1)
  })

  it('is 0 when every checkpoint is missed', () => {
    expect(scrubberActualScore([result(false), result(false)])).toBe(0)
  })

  it('is the exact fraction correct for a mixed result (1 of 2)', () => {
    expect(scrubberActualScore([result(true), result(false)])).toBe(0.5)
  })

  it('is the exact fraction correct for a mixed result (3 of 4)', () => {
    expect(scrubberActualScore([result(true), result(true), result(true), result(false)])).toBe(
      0.75,
    )
  })

  it('is 0 (not NaN) on an empty result set', () => {
    expect(scrubberActualScore([])).toBe(0)
  })

  it('does not care about choiceIndex, only correct', () => {
    expect(scrubberActualScore([result(true, 3), result(false, 0)])).toBe(0.5)
  })
})
