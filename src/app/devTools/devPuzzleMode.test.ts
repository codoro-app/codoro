import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isDevPuzzleModeEnabled,
  resolveDailyStubPuzzle,
  resolvePool,
  setDevPuzzleMode,
} from './devPuzzleMode'
import { DEV_STUB_PUZZLES } from '../../content/devPuzzles'

describe('devPuzzleMode', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
    vi.unstubAllEnvs()
  })

  it('defaults to disabled', () => {
    expect(isDevPuzzleModeEnabled()).toBe(false)
  })

  it('setDevPuzzleMode(true) flips isDevPuzzleModeEnabled (DEV test environment)', () => {
    setDevPuzzleMode(true)
    expect(isDevPuzzleModeEnabled()).toBe(true)
    setDevPuzzleMode(false)
    expect(isDevPuzzleModeEnabled()).toBe(false)
  })

  it('is hard-gated off outside DEV, even with the flag already set', () => {
    setDevPuzzleMode(true)
    expect(isDevPuzzleModeEnabled()).toBe(true)

    vi.stubEnv('DEV', false)
    expect(isDevPuzzleModeEnabled()).toBe(false)
  })

  it('setDevPuzzleMode is a no-op outside DEV', () => {
    vi.stubEnv('DEV', false)
    setDevPuzzleMode(true)
    vi.unstubAllEnvs()
    expect(isDevPuzzleModeEnabled()).toBe(false)
  })

  it('resolvePool returns the real pool when disabled, stub pool when enabled', () => {
    const realPool = [{ id: 'real-1', pattern: 'off-by-one' }] as never
    expect(resolvePool(realPool)).toBe(realPool)

    setDevPuzzleMode(true)
    expect(resolvePool(realPool)).toBe(DEV_STUB_PUZZLES)
  })

  it('resolveDailyStubPuzzle cycles deterministically through the stub pool', () => {
    const n = DEV_STUB_PUZZLES.length
    expect(resolveDailyStubPuzzle(0)).toBe(DEV_STUB_PUZZLES[0])
    expect(resolveDailyStubPuzzle(n)).toBe(DEV_STUB_PUZZLES[0])
    expect(resolveDailyStubPuzzle(n + 1)).toBe(DEV_STUB_PUZZLES[1])
  })
})
