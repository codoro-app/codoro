import { beforeEach, describe, expect, it, vi } from 'vitest'
import { clearHasAccountHint, readHasAccountHint, writeHasAccountHint } from './accountHint'

describe('accountHint', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('reads false when nothing has ever been written', () => {
    expect(readHasAccountHint()).toBe(false)
  })

  it('reads true after writeHasAccountHint()', () => {
    writeHasAccountHint()
    expect(readHasAccountHint()).toBe(true)
  })

  it('reads false again after clearHasAccountHint()', () => {
    writeHasAccountHint()
    clearHasAccountHint()
    expect(readHasAccountHint()).toBe(false)
  })

  it('reads false (not a throw) for a corrupt/unexpected stored value', () => {
    localStorage.setItem('codoro:has-account', 'not-a-1')
    expect(readHasAccountHint()).toBe(false)
  })

  it('never throws when localStorage.getItem/setItem/removeItem throw (e.g. Safari private browsing)', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new DOMException('SecurityError')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('QuotaExceededError')
    })
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new DOMException('SecurityError')
    })

    expect(() => {
      writeHasAccountHint()
    }).not.toThrow()
    expect(readHasAccountHint()).toBe(false) // the safe, zero-Clerk-cost default
    expect(() => {
      clearHasAccountHint()
    }).not.toThrow()

    vi.restoreAllMocks()
  })
})
