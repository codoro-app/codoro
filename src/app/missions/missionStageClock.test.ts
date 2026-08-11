import { describe, expect, it } from 'vitest'
import { MISSION_STAGE_DURATION_MS, hasStageClockExpired } from './missionStageClock'

describe('hasStageClockExpired', () => {
  it('is false before the deadline', () => {
    expect(hasStageClockExpired(10_000, 9_999)).toBe(false)
  })

  it('is true exactly at the deadline', () => {
    expect(hasStageClockExpired(10_000, 10_000)).toBe(true)
  })

  it('is true after the deadline', () => {
    expect(hasStageClockExpired(10_000, 10_001)).toBe(true)
  })

  it('works against a realistic mission-stage deadline', () => {
    const startedAt = 1_723_400_000_000
    const deadline = startedAt + MISSION_STAGE_DURATION_MS
    expect(hasStageClockExpired(deadline, startedAt + 30_000)).toBe(false)
    expect(hasStageClockExpired(deadline, startedAt + 60_000)).toBe(true)
    expect(hasStageClockExpired(deadline, startedAt + 60_001)).toBe(true)
  })
})
