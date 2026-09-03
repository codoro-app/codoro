import { describe, expect, it, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useChallengerName } from './useChallengerName'
import { createDefaultProfile } from '../storage'
import type { UserProfile } from '../storage'

describe('useChallengerName', () => {
  it('reads the initial name off the passed-in profile', () => {
    const profile: UserProfile = { ...createDefaultProfile(), challengerName: 'Joe' }
    const { result } = renderHook(() => useChallengerName(profile, vi.fn()))
    expect(result.current.name).toBe('Joe')
  })

  it('returns null when the profile has never set a name', () => {
    const profile = createDefaultProfile()
    const { result } = renderHook(() => useChallengerName(profile, vi.fn()))
    expect(result.current.name).toBeNull()
  })

  it('returns null when no profile has loaded yet', () => {
    const { result } = renderHook(() => useChallengerName(null, vi.fn()))
    expect(result.current.name).toBeNull()
  })

  it('setName persists via the passed-in onProfileChange callback — no storage access of its own', async () => {
    const profile = createDefaultProfile()
    const onProfileChange = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useChallengerName(profile, onProfileChange))

    await act(async () => {
      await result.current.setName('Joe')
    })

    expect(onProfileChange).toHaveBeenCalledTimes(1)
    expect(onProfileChange).toHaveBeenCalledWith({ ...profile, challengerName: 'Joe' })
    // The hook itself never imports/calls storage's saveProfile — the only
    // storage-touching call is the one made through onProfileChange above,
    // which this test's own caller (not the hook) owns.
  })

  it("setName reflects the just-saved name immediately, even before the caller's own profile prop updates", async () => {
    const profile = createDefaultProfile()
    const onProfileChange = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useChallengerName(profile, onProfileChange))

    await act(async () => {
      await result.current.setName('Joe')
    })

    expect(result.current.name).toBe('Joe')
  })

  it('trims whitespace before persisting', async () => {
    const profile = createDefaultProfile()
    const onProfileChange = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useChallengerName(profile, onProfileChange))

    await act(async () => {
      await result.current.setName('  Joe  ')
    })

    expect(onProfileChange).toHaveBeenCalledWith({ ...profile, challengerName: 'Joe' })
  })

  it('is a silent no-op for a blank/whitespace-only name', async () => {
    const profile = createDefaultProfile()
    const onProfileChange = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useChallengerName(profile, onProfileChange))

    await act(async () => {
      await result.current.setName('   ')
    })

    expect(onProfileChange).not.toHaveBeenCalled()
    expect(result.current.name).toBeNull()
  })

  it('is a silent no-op when no profile has loaded yet', async () => {
    const onProfileChange = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useChallengerName(null, onProfileChange))

    await act(async () => {
      await result.current.setName('Joe')
    })

    expect(onProfileChange).not.toHaveBeenCalled()
  })
})
