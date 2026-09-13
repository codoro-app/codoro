import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  clearQueue,
  isQueueEntryStale,
  QUEUE_STORAGE_KEY,
  readQueueEntry,
  recordQueueFailure,
} from './queue'

describe('queue', () => {
  beforeEach(() => {
    localStorage.clear()
  })
  afterEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  describe('readQueueEntry', () => {
    it('returns null when nothing has ever been queued', () => {
      expect(readQueueEntry()).toBeNull()
    })

    it('returns null (not a throw) when the stored value is corrupt JSON', () => {
      localStorage.setItem(QUEUE_STORAGE_KEY, '{not valid json')
      expect(readQueueEntry()).toBeNull()
    })

    it('returns null (not a throw) when the stored value is valid JSON but the wrong shape', () => {
      localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify({ userId: 'user_a' }))
      expect(readQueueEntry()).toBeNull()
    })
  })

  describe('recordQueueFailure', () => {
    it('creates a fresh entry with attempts=1 when nothing was queued', () => {
      const entry = recordQueueFailure('user_a', 13, 1_000_000)
      expect(entry).toEqual({
        userId: 'user_a',
        schemaVersion: 13,
        queuedAt: 1_000_000,
        attempts: 1,
      })
      expect(readQueueEntry()).toEqual(entry)
    })

    it('persists across a simulated reload (no in-memory cache — a fresh read sees the write)', () => {
      recordQueueFailure('user_a', 13, 1_000_000)
      // Nothing in this module holds state in memory; re-reading is exactly
      // what a fresh page load does.
      expect(readQueueEntry()).toEqual({
        userId: 'user_a',
        schemaVersion: 13,
        queuedAt: 1_000_000,
        attempts: 1,
      })
    })

    it('increments attempts on a repeated failure for the same user', () => {
      recordQueueFailure('user_a', 13, 1_000_000)
      const second = recordQueueFailure('user_a', 13, 1_020_000)
      expect(second.attempts).toBe(2)
    })

    it('starts a fresh entry (attempts=1) rather than merging counters when the existing entry belongs to a different user', () => {
      recordQueueFailure('user_a', 13, 1_000_000)
      recordQueueFailure('user_a', 13, 1_010_000) // attempts=2 for user_a
      const forB = recordQueueFailure('user_b', 13, 1_020_000)
      expect(forB).toEqual({
        userId: 'user_b',
        schemaVersion: 13,
        queuedAt: 1_020_000,
        attempts: 1,
      })
    })

    it('does not throw when localStorage.setItem throws (e.g. Safari private browsing)', () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('QuotaExceededError')
      })
      expect(() => recordQueueFailure('user_a', 13, 1_000_000)).not.toThrow()
    })
  })

  describe('clearQueue', () => {
    it('removes a stored entry so a later read returns null', () => {
      recordQueueFailure('user_a', 13, 1_000_000)
      clearQueue()
      expect(readQueueEntry()).toBeNull()
    })

    it('is a harmless no-op when nothing was queued', () => {
      expect(() => {
        clearQueue()
      }).not.toThrow()
      expect(readQueueEntry()).toBeNull()
    })
  })

  describe('isQueueEntryStale', () => {
    it('is false when the entry matches the current schema version', () => {
      const entry = recordQueueFailure('user_a', 13, 1_000_000)
      expect(isQueueEntryStale(entry, 13)).toBe(false)
    })

    it('is true when the entry was built against an older schema version', () => {
      const entry = recordQueueFailure('user_a', 12, 1_000_000)
      expect(isQueueEntryStale(entry, 13)).toBe(true)
    })
  })
})
