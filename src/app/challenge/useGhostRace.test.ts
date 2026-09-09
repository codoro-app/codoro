import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useGhostRace } from './useGhostRace'
import type { ChallengeAttemptInput } from '../../challenge'

const theirResult: ChallengeAttemptInput = { puzzleId: 'p1', correct: true, time_ms: 3000 }
const theirWrongResult: ChallengeAttemptInput = { puzzleId: 'p1', correct: false, time_ms: 3000 }

afterEach(() => {
  vi.useRealTimers()
})

describe('useGhostRace', () => {
  it('returns null when there is no result for this puzzle (no ghost to show)', () => {
    const { result } = renderHook(() => useGhostRace(undefined, undefined, Date.now()))
    expect(result.current).toBeNull()
  })

  it('returns null when the clock for this puzzle has not started yet (servedAt null)', () => {
    const { result } = renderHook(() => useGhostRace(theirResult, undefined, null))
    expect(result.current).toBeNull()
  })

  it('starts running immediately once servedAt is set, before their time elapses', () => {
    vi.useFakeTimers()
    const servedAt = Date.now()
    const { result } = renderHook(() => useGhostRace(theirResult, undefined, servedAt))
    expect(result.current).toEqual({ status: 'running', theirTimeMs: 3000 })
  })

  it('transitions to finished on its own once their time elapses, if the recipient has not answered', () => {
    vi.useFakeTimers()
    const servedAt = Date.now()
    const { result, rerender } = renderHook(
      ({ yours }: { yours: ChallengeAttemptInput | undefined }) =>
        useGhostRace(theirResult, yours, servedAt),
      { initialProps: { yours: undefined } },
    )
    expect(result.current?.status).toBe('running')
    vi.advanceTimersByTime(3000)
    rerender({ yours: undefined })
    expect(result.current).toEqual({ status: 'finished', theirTimeMs: 3000 })
  })

  it('labels a finished ghost as "missed" via theirResult.correct — the caller reads that, not the hook', () => {
    // The hook itself doesn't know about "missed" copy (that's GhostBar's
    // job) — this just confirms status still reaches 'finished' the same
    // way when the challenger's own answer was wrong.
    vi.useFakeTimers()
    const servedAt = Date.now()
    const { result, rerender } = renderHook(() =>
      useGhostRace(theirWrongResult, undefined, servedAt),
    )
    vi.advanceTimersByTime(3000)
    rerender()
    expect(result.current?.status).toBe('finished')
  })

  it('flips to beaten the instant the recipient answers before their time elapses, freezing the margin', () => {
    vi.useFakeTimers()
    const servedAt = Date.now()
    vi.advanceTimersByTime(1000)
    const yourResult: ChallengeAttemptInput = { puzzleId: 'p1', correct: true, time_ms: 1000 }
    const { result } = renderHook(() => useGhostRace(theirResult, yourResult, servedAt))
    expect(result.current).toEqual({
      status: 'beaten',
      theirTimeMs: 3000,
      marginMs: 2000,
      frozenFraction: 1000 / 3000,
    })
  })

  it('reports finished (not beaten) when the recipient answers slower than the ghost', () => {
    vi.useFakeTimers()
    const servedAt = Date.now()
    const yourResult: ChallengeAttemptInput = { puzzleId: 'p1', correct: true, time_ms: 4000 }
    const { result } = renderHook(() => useGhostRace(theirResult, yourResult, servedAt))
    expect(result.current).toEqual({ status: 'finished', theirTimeMs: 3000 })
  })

  it('never fires a stray finished transition after already beaten (no leftover timer)', () => {
    vi.useFakeTimers()
    const servedAt = Date.now()
    vi.advanceTimersByTime(1000)
    const yourResult: ChallengeAttemptInput = { puzzleId: 'p1', correct: true, time_ms: 1000 }
    const { result, rerender } = renderHook(
      ({ yours }: { yours: ChallengeAttemptInput | undefined }) =>
        useGhostRace(theirResult, yours, servedAt),
      { initialProps: { yours: yourResult } },
    )
    expect(result.current?.status).toBe('beaten')
    vi.advanceTimersByTime(5000)
    rerender({ yours: yourResult })
    expect(result.current?.status).toBe('beaten')
  })
})
