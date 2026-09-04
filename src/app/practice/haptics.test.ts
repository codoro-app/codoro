import { afterEach, describe, expect, it, vi } from 'vitest'
import { HAPTIC_TICK_MS, hapticImpact, hapticTick } from './haptics'

describe('hapticTick', () => {
  // jsdom does not implement navigator.vibrate at all by default, so there is
  // no original descriptor to preserve — each test defines exactly the
  // shape it needs and this restores that clean (absent) baseline after.
  const originalDescriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'vibrate')

  afterEach(() => {
    delete (navigator as { vibrate?: unknown }).vibrate
    if (originalDescriptor) {
      Object.defineProperty(Navigator.prototype, 'vibrate', originalDescriptor)
    }
  })

  it('calls navigator.vibrate with a short duration when available', () => {
    const vibrate = vi.fn()
    Object.defineProperty(navigator, 'vibrate', {
      value: vibrate,
      configurable: true,
      writable: true,
    })

    hapticTick()

    expect(vibrate).toHaveBeenCalledWith(HAPTIC_TICK_MS)
  })

  it('does not throw when navigator.vibrate is absent (e.g. iOS Safari)', () => {
    delete (navigator as { vibrate?: unknown }).vibrate

    expect(() => {
      hapticTick()
    }).not.toThrow()
  })

  it('degrades silently when navigator.vibrate throws', () => {
    Object.defineProperty(navigator, 'vibrate', {
      value: () => {
        throw new Error('permission policy denied vibrate')
      },
      configurable: true,
      writable: true,
    })

    expect(() => {
      hapticTick()
    }).not.toThrow()
  })
})

describe('hapticImpact', () => {
  const originalDescriptor = Object.getOwnPropertyDescriptor(Navigator.prototype, 'vibrate')

  afterEach(() => {
    delete (navigator as { vibrate?: unknown }).vibrate
    if (originalDescriptor) {
      Object.defineProperty(Navigator.prototype, 'vibrate', originalDescriptor)
    }
  })

  function stubVibrate() {
    const vibrate = vi.fn()
    Object.defineProperty(navigator, 'vibrate', {
      value: vibrate,
      configurable: true,
      writable: true,
    })
    return vibrate
  }

  it('correct level 0-1 uses the unchanged 15ms tick', () => {
    const vibrate = stubVibrate()
    hapticImpact({
      kind: 'correct',
      level: 0,
      newCombo: 1,
      newShields: 0,
      surge: false,
      tier: 'novice',
    })
    expect(vibrate).toHaveBeenCalledWith(HAPTIC_TICK_MS)
    hapticImpact({
      kind: 'correct',
      level: 1,
      newCombo: 3,
      newShields: 1,
      surge: true,
      tier: 'novice',
    })
    expect(vibrate).toHaveBeenLastCalledWith(HAPTIC_TICK_MS)
  })

  it('correct level 2 uses the three-beat pattern', () => {
    const vibrate = stubVibrate()
    hapticImpact({
      kind: 'correct',
      level: 2,
      newCombo: 6,
      newShields: 1,
      surge: true,
      tier: 'novice',
    })
    expect(vibrate).toHaveBeenCalledWith([12, 40, 18])
  })

  it('correct level 3 uses the five-beat pattern', () => {
    const vibrate = stubVibrate()
    hapticImpact({
      kind: 'correct',
      level: 3,
      newCombo: 9,
      newShields: 2,
      surge: true,
      tier: 'novice',
    })
    expect(vibrate).toHaveBeenCalledWith([12, 30, 18, 30, 26])
  })

  it('shielded uses its own three-beat pattern', () => {
    const vibrate = stubVibrate()
    hapticImpact({ kind: 'shielded', newCombo: 4, newShields: 1, tier: 'novice' })
    expect(vibrate).toHaveBeenCalledWith([10, 60, 10])
  })

  it('wrong uses a single 40ms buzz', () => {
    const vibrate = stubVibrate()
    hapticImpact({ kind: 'wrong', newCombo: 0, newShields: 0, tier: 'novice' })
    expect(vibrate).toHaveBeenCalledWith(40)
  })

  it('does not throw when navigator.vibrate is absent', () => {
    delete (navigator as { vibrate?: unknown }).vibrate
    expect(() => {
      hapticImpact({ kind: 'wrong', newCombo: 0, newShields: 0, tier: 'novice' })
    }).not.toThrow()
  })
})
