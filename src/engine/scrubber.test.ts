import { describe, expect, it } from 'vitest'
import { scoreScrubberAttempt } from './scrubber'
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
