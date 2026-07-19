import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useUpdatePrompt } from './useUpdatePrompt'

const { mockState, updateServiceWorker, useRegisterSW } = vi.hoisted(() => {
  const mockState = { needRefresh: false }
  const updateServiceWorker = vi.fn(() => Promise.resolve())
  const useRegisterSW = vi.fn(() => ({
    needRefresh: [
      mockState.needRefresh,
      (value: boolean) => {
        mockState.needRefresh = value
      },
    ] as const,
    updateServiceWorker,
  }))
  return { mockState, updateServiceWorker, useRegisterSW }
})

vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW }))

describe('useUpdatePrompt', () => {
  afterEach(() => {
    mockState.needRefresh = false
    updateServiceWorker.mockClear()
  })

  it('starts idle when no update is waiting', () => {
    const { result } = renderHook(() => useUpdatePrompt())

    expect(result.current.state).toBe('idle')
  })

  it('shows needs-refresh once the service worker reports a waiting update', () => {
    mockState.needRefresh = true

    const { result } = renderHook(() => useUpdatePrompt())

    expect(result.current.state).toBe('needs-refresh')
  })

  it('moves to refreshing and calls updateServiceWorker(true) on refresh()', () => {
    mockState.needRefresh = true
    const { result } = renderHook(() => useUpdatePrompt())

    act(() => {
      result.current.refresh()
    })

    expect(result.current.state).toBe('refreshing')
    expect(updateServiceWorker).toHaveBeenCalledWith(true)
  })

  it('dismiss() returns to idle without discarding the waiting worker', () => {
    mockState.needRefresh = true
    const { result } = renderHook(() => useUpdatePrompt())

    act(() => {
      result.current.dismiss()
    })

    expect(result.current.state).toBe('idle')
    expect(updateServiceWorker).not.toHaveBeenCalled()
  })

  it('re-shows the prompt if a fresh update arrives after a dismiss', () => {
    mockState.needRefresh = true
    const { result, rerender } = renderHook(() => useUpdatePrompt())

    act(() => {
      result.current.dismiss()
    })
    expect(result.current.state).toBe('idle')

    // Simulate the SW's needRefresh flag cycling (a second deploy detected).
    act(() => {
      mockState.needRefresh = false
    })
    rerender()
    act(() => {
      mockState.needRefresh = true
    })
    rerender()

    expect(result.current.state).toBe('needs-refresh')
  })
})
