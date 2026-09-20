import { describe, expect, it } from 'vitest'
import {
  WEEKLY_COACH_LIMIT,
  coachMeterRemaining,
  consumeCoachMeterUse,
  currentUtcWeekStart,
} from './coachMeter'

describe('currentUtcWeekStart', () => {
  it('returns the Monday for a mid-week Wednesday', () => {
    expect(currentUtcWeekStart(new Date('2026-09-16T12:00:00.000Z'))).toBe('2026-09-14')
  })

  it('returns the same Monday for a Sunday (end of that week)', () => {
    expect(currentUtcWeekStart(new Date('2026-09-20T23:59:59.000Z'))).toBe('2026-09-14')
  })

  it('returns itself for a Monday', () => {
    expect(currentUtcWeekStart(new Date('2026-09-14T00:00:00.000Z'))).toBe('2026-09-14')
  })

  it('rolls across a month boundary', () => {
    expect(currentUtcWeekStart(new Date('2026-10-01T00:00:00.000Z'))).toBe('2026-09-28')
  })
})

describe('coachMeterRemaining', () => {
  const now = new Date('2026-09-16T12:00:00.000Z')

  it('returns the full limit for the never-used sentinel meter', () => {
    expect(coachMeterRemaining({ weekStart: '', used: 0 }, now)).toBe(WEEKLY_COACH_LIMIT)
  })

  it('subtracts used from the limit within the current week', () => {
    expect(coachMeterRemaining({ weekStart: '2026-09-14', used: 2 }, now)).toBe(1)
  })

  it('floors at 0, never negative', () => {
    expect(coachMeterRemaining({ weekStart: '2026-09-14', used: 5 }, now)).toBe(0)
  })

  it('ignores used from a stale (prior) week', () => {
    expect(coachMeterRemaining({ weekStart: '2026-09-07', used: 3 }, now)).toBe(WEEKLY_COACH_LIMIT)
  })
})

describe('consumeCoachMeterUse', () => {
  const now = new Date('2026-09-16T12:00:00.000Z')

  it('increments used within the current week', () => {
    expect(consumeCoachMeterUse({ weekStart: '2026-09-14', used: 1 }, now)).toEqual({
      weekStart: '2026-09-14',
      used: 2,
    })
  })

  it('rolls a stale week onto the current one, starting at 1', () => {
    expect(consumeCoachMeterUse({ weekStart: '2026-09-07', used: 3 }, now)).toEqual({
      weekStart: '2026-09-14',
      used: 1,
    })
  })

  it('rolls the never-used sentinel onto the current week, starting at 1', () => {
    expect(consumeCoachMeterUse({ weekStart: '', used: 0 }, now)).toEqual({
      weekStart: '2026-09-14',
      used: 1,
    })
  })
})
