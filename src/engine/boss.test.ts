import { describe, expect, it } from 'vitest'
import { BOSS_STRIKE_LIMIT } from './boss'

describe('BOSS_STRIKE_LIMIT', () => {
  it('is 3, matching the settled design decision (docs/v3-build-plan.md Phase 1)', () => {
    expect(BOSS_STRIKE_LIMIT).toBe(3)
  })
})
