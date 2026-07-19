import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useUpdatePrompt } from './useUpdatePrompt'

const { mockState, updateServiceWorker, registrationUpdate, useRegisterSW } = vi.hoisted(() => {
  const mockState = { needRefresh: false }
  const updateServiceWorker = vi.fn(() => Promise.resolve())
  const registrationUpdate = vi.fn(() => Promise.resolve())
  const useRegisterSW = vi.fn(
    (options?: { onRegisteredSW?: (swUrl: string, registration: unknown) => void }) => {
      options?.onRegisteredSW?.('/sw.js', { update: registrationUpdate })
      return {
        needRefresh: [
          mockState.needRefresh,
          (value: boolean) => {
            mockState.needRefresh = value
          },
        ] as const,
        updateServiceWorker,
      }
    },
  )
  return { mockState, updateServiceWorker, registrationUpdate, useRegisterSW }
})

vi.mock('virtual:pwa-register/react', () => ({ useRegisterSW }))

describe('useUpdatePrompt', () => {
  afterEach(() => {
    mockState.needRefresh = false
    updateServiceWorker.mockClear()
    registrationUpdate.mockClear()
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

  it('checks for an update immediately on registration', () => {
    renderHook(() => useUpdatePrompt())

    expect(registrationUpdate).toHaveBeenCalledTimes(1)
  })

  it('checks for an update on pageshow when the page was restored from bfcache (iOS resume)', () => {
    // Captures this render's own `pageshow` listener directly rather than
    // dispatching a real global event — `window` persists across tests in
    // this file, so a real dispatch would also trigger listeners left
    // behind by every earlier test's renderHook() mount.
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    renderHook(() => useUpdatePrompt())
    registrationUpdate.mockClear()

    const pageshowCall = addEventListenerSpy.mock.calls.find(([type]) => type === 'pageshow')
    const listener = pageshowCall?.[1] as unknown as (event: { persisted: boolean }) => void

    act(() => {
      listener({ persisted: true })
    })

    expect(registrationUpdate).toHaveBeenCalledTimes(1)
    addEventListenerSpy.mockRestore()
  })

  it('does not re-check on a non-persisted pageshow (a normal, non-restored load)', () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    renderHook(() => useUpdatePrompt())
    registrationUpdate.mockClear()

    const pageshowCall = addEventListenerSpy.mock.calls.find(([type]) => type === 'pageshow')
    const listener = pageshowCall?.[1] as unknown as (event: { persisted: boolean }) => void

    act(() => {
      listener({ persisted: false })
    })

    expect(registrationUpdate).not.toHaveBeenCalled()
    addEventListenerSpy.mockRestore()
  })
})
