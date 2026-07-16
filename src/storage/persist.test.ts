import { afterEach, describe, expect, it, vi } from 'vitest'
import { requestPersistentStorage } from './persist'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('requestPersistentStorage', () => {
  it('resolves true when the browser grants persistence', async () => {
    vi.stubGlobal('navigator', { storage: { persist: vi.fn().mockResolvedValue(true) } })
    await expect(requestPersistentStorage()).resolves.toBe(true)
  })

  it('resolves false when the browser denies persistence', async () => {
    vi.stubGlobal('navigator', { storage: { persist: vi.fn().mockResolvedValue(false) } })
    await expect(requestPersistentStorage()).resolves.toBe(false)
  })

  it('returns null when navigator.storage is not available', async () => {
    vi.stubGlobal('navigator', {})
    await expect(requestPersistentStorage()).resolves.toBeNull()
  })

  it('returns null when navigator.storage.persist is missing', async () => {
    vi.stubGlobal('navigator', { storage: {} })
    await expect(requestPersistentStorage()).resolves.toBeNull()
  })

  it('returns null when persist() throws', async () => {
    vi.stubGlobal('navigator', {
      storage: { persist: vi.fn().mockRejectedValue(new Error('boom')) },
    })
    await expect(requestPersistentStorage()).resolves.toBeNull()
  })
})
