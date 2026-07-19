import { afterEach, describe, expect, it, vi } from 'vitest'
import { HAPTIC_TICK_MS, hapticTick } from './haptics'

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
