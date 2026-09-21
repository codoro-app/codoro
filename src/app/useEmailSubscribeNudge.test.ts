import { afterEach, describe, expect, it } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useEmailSubscribeNudge } from './useEmailSubscribeNudge'

afterEach(() => {
  localStorage.clear()
})

describe('useEmailSubscribeNudge', () => {
  it('starts not dismissed when nothing is stored', () => {
    const { result } = renderHook(() => useEmailSubscribeNudge())
    expect(result.current.dismissed).toBe(false)
  })

  it('dismiss() marks it dismissed and persists the choice to localStorage', () => {
    const { result } = renderHook(() => useEmailSubscribeNudge())
    act(() => {
      result.current.dismiss()
    })
    expect(result.current.dismissed).toBe(true)
    expect(localStorage.getItem('codoro:email-subscribe-dismissed')).toBe('1')
  })

  it('a fresh hook instance reads a prior dismissal back from localStorage', () => {
    localStorage.setItem('codoro:email-subscribe-dismissed', '1')
    const { result } = renderHook(() => useEmailSubscribeNudge())
    expect(result.current.dismissed).toBe(true)
  })
})
