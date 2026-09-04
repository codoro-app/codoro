import { describe, expect, it } from 'vitest'
import {
  comboStep,
  impactLevel,
  impactVariant,
  isSurge,
  ratingTier,
  resolveOutcome,
  shieldCap,
} from './feel'

describe('ratingTier', () => {
  it('classifies the tier boundaries exactly', () => {
    expect(ratingTier(1299)).toBe('novice')
    expect(ratingTier(1300)).toBe('steady')
    expect(ratingTier(1499)).toBe('steady')
    expect(ratingTier(1500)).toBe('sharp')
    expect(ratingTier(1699)).toBe('sharp')
    expect(ratingTier(1700)).toBe('elite')
  })

  it('puts a brand-new profile (INITIAL_RATING 1200) in novice', () => {
    expect(ratingTier(1200)).toBe('novice')
  })
})

describe('comboStep / shieldCap', () => {
  it('rises with tier for comboStep, falls with tier for shieldCap', () => {
    expect(comboStep('novice')).toBe(3)
    expect(comboStep('steady')).toBe(4)
    expect(comboStep('sharp')).toBe(5)
    expect(comboStep('elite')).toBe(6)
    expect(shieldCap('novice')).toBe(2)
    expect(shieldCap('steady')).toBe(2)
    expect(shieldCap('sharp')).toBe(1)
    expect(shieldCap('elite')).toBe(1)
  })
})

describe('isSurge', () => {
  it('is true only on positive multiples of the tier step', () => {
    expect(isSurge(0, 'novice')).toBe(false)
    expect(isSurge(1, 'novice')).toBe(false)
    expect(isSurge(3, 'novice')).toBe(true)
    expect(isSurge(6, 'novice')).toBe(true)
    expect(isSurge(4, 'novice')).toBe(false)
    expect(isSurge(5, 'sharp')).toBe(true)
  })
})

describe('impactLevel', () => {
  it('saturates at 3 and floors between steps', () => {
    expect(impactLevel(0, 'novice')).toBe(0)
    expect(impactLevel(2, 'novice')).toBe(0)
    expect(impactLevel(3, 'novice')).toBe(1)
    expect(impactLevel(5, 'novice')).toBe(1)
    expect(impactLevel(6, 'novice')).toBe(2)
    expect(impactLevel(9, 'novice')).toBe(3)
    expect(impactLevel(30, 'novice')).toBe(3) // saturates
  })
})

describe('resolveOutcome', () => {
  it('a correct answer increments combo and reports the impact level', () => {
    const outcome = resolveOutcome({ correct: true, combo: 1, shields: 0, rating: 1200 })
    expect(outcome).toEqual({
      kind: 'correct',
      level: 0,
      newCombo: 2,
      newShields: 0,
      surge: false,
      tier: 'novice',
    })
  })

  it('a correct answer that crosses a surge threshold banks a shield', () => {
    const outcome = resolveOutcome({ correct: true, combo: 2, shields: 0, rating: 1200 })
    expect(outcome).toEqual({
      kind: 'correct',
      level: 1,
      newCombo: 3,
      newShields: 1,
      surge: true,
      tier: 'novice',
    })
  })

  it('banking clamps to the tier shield cap', () => {
    const outcome = resolveOutcome({ correct: true, combo: 5, shields: 2, rating: 1200 })
    // novice cap is 2 — combo 5->6 is a surge (step 3) but shields stay at 2
    expect(outcome.kind).toBe('correct')
    expect(outcome).toMatchObject({ newShields: 2, surge: true })
  })

  it('a wrong answer with a banked shield is shielded: combo holds, one shield is consumed', () => {
    const outcome = resolveOutcome({ correct: false, combo: 4, shields: 2, rating: 1200 })
    expect(outcome).toEqual({ kind: 'shielded', newCombo: 4, newShields: 1, tier: 'novice' })
  })

  it('a wrong answer with no shield resets both combo and shields', () => {
    const outcome = resolveOutcome({ correct: false, combo: 4, shields: 0, rating: 1200 })
    expect(outcome).toEqual({ kind: 'wrong', newCombo: 0, newShields: 0, tier: 'novice' })
  })

  it('tier is derived from the rating passed in, independent of combo/shields', () => {
    const outcome = resolveOutcome({ correct: true, combo: 0, shields: 0, rating: 1650 })
    expect(outcome.tier).toBe('sharp')
  })
})

describe('impactVariant', () => {
  it('maps correct levels 0 and 1 to the same "correct-1" CSS variant', () => {
    expect(
      impactVariant(resolveOutcome({ correct: true, combo: 0, shields: 0, rating: 1200 })),
    ).toBe('correct-1')
    expect(
      impactVariant(resolveOutcome({ correct: true, combo: 2, shields: 0, rating: 1200 })),
    ).toBe('correct-1')
  })

  it('maps correct levels 2 and 3 to their own variants', () => {
    expect(
      impactVariant(resolveOutcome({ correct: true, combo: 5, shields: 0, rating: 1200 })),
    ).toBe('correct-2')
    expect(
      impactVariant(resolveOutcome({ correct: true, combo: 8, shields: 0, rating: 1200 })),
    ).toBe('correct-3')
  })

  it('maps shielded and wrong to their own variants', () => {
    expect(
      impactVariant(resolveOutcome({ correct: false, combo: 4, shields: 1, rating: 1200 })),
    ).toBe('shielded')
    expect(
      impactVariant(resolveOutcome({ correct: false, combo: 4, shields: 0, rating: 1200 })),
    ).toBe('wrong')
  })
})
