import { afterEach, describe, expect, it } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useFeedbackNudge } from './useFeedbackNudge'

afterEach(() => {
  localStorage.clear()
})

describe('useFeedbackNudge', () => {
  it('starts not dismissed when nothing is stored', () => {
    const { result } = renderHook(() => useFeedbackNudge())
    expect(result.current.dismissed).toBe(false)
  })

  it('dismiss() marks it dismissed and persists the choice to localStorage', () => {
    const { result } = renderHook(() => useFeedbackNudge())
    act(() => {
      result.current.dismiss()
    })
    expect(result.current.dismissed).toBe(true)
    expect(localStorage.getItem('codoro:feedback-nudge-dismissed')).toBe('1')
  })

  it('a fresh hook instance reads a prior dismissal back from localStorage', () => {
    localStorage.setItem('codoro:feedback-nudge-dismissed', '1')
    const { result } = renderHook(() => useFeedbackNudge())
    expect(result.current.dismissed).toBe(true)
  })
})
