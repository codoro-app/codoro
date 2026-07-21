import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMediaQuery } from './useMediaQuery'

type Listener = (e: MediaQueryListEvent) => void

function mockMatchMedia(initialMatches: boolean) {
  let listener: Listener | null = null
  let matches = initialMatches
  const mql = {
    get matches() {
      return matches
    },
    media: '(min-width: 1024px)',
    addEventListener: (_: 'change', cb: Listener) => {
      listener = cb
    },
    removeEventListener: () => {
      listener = null
    },
  }
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => mql as unknown as MediaQueryList),
  )
  return {
    fireChange: (next: boolean) => {
      matches = next
      act(() => {
        listener?.({ matches: next } as MediaQueryListEvent)
      })
    },
  }
}

describe('useMediaQuery', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns the initial match state on mount', () => {
    mockMatchMedia(true)
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'))
    expect(result.current).toBe(true)
  })

  it('updates when the media query match state changes', () => {
    const { fireChange } = mockMatchMedia(false)
    const { result } = renderHook(() => useMediaQuery('(min-width: 1024px)'))
    expect(result.current).toBe(false)

    fireChange(true)
    expect(result.current).toBe(true)
  })
})
