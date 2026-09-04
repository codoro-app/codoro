import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useNumberTween } from './useNumberTween'

describe('useNumberTween', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns the target immediately on first mount by default — no animate-from-0', () => {
    const { result } = renderHook(() => useNumberTween(42, 600))
    expect(result.current).toBe(42)
  })

  it('animates from the previous value to a new target when target changes', () => {
    const { result, rerender } = renderHook(({ target }) => useNumberTween(target, 600), {
      initialProps: { target: 1200 },
    })
    expect(result.current).toBe(1200)

    rerender({ target: 1212 })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(result.current).toBeGreaterThanOrEqual(1200)
    expect(result.current).toBeLessThanOrEqual(1212)

    act(() => {
      vi.advanceTimersByTime(400)
    })
    expect(result.current).toBe(1212)
  })

  it('with animateOnMount, starts at 0 and animates up to target on first mount', () => {
    const { result } = renderHook(() => useNumberTween(12, 500, { animateOnMount: true }))
    expect(result.current).toBe(0)
    // A little past the duration, not exactly at it: the tween settles on
    // whichever rAF frame's elapsed time first reaches/exceeds durationMs,
    // which can land a frame after the exact millisecond boundary.
    act(() => {
      vi.advanceTimersByTime(600)
    })
    expect(result.current).toBe(12)
  })
})
