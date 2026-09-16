import { describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { useCompeteSession } from './useCompeteSession'

// Same wrapped-real-getPuzzleBody convention as
// src/app/challenge/useChallengeSession.test.ts: the default implementation
// is the real one (real bundled puzzle ids below), just wrapped in a vi.fn
// so it's a spyable mock.
vi.mock('../../content', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../content')>()
  return { ...actual, getPuzzleBody: vi.fn(actual.getPuzzleBody) }
})

vi.mock('../../telemetry', () => ({
  trackError: vi.fn(),
}))

describe('useCompeteSession', () => {
  it('starts loading, then reaches playing once bodies resolve', async () => {
    const { result } = renderHook(() => useCompeteSession(['con-005', 'tc-002']))
    expect(result.current.status).toBe('loading')
    await waitFor(() => {
      expect(result.current.status).toBe('playing')
    })
    expect(result.current.totalPuzzles).toBe(2)
    expect(result.current.puzzle?.id).toBe('con-005')
  })

  it('accumulates a result per answered puzzle and reaches done after the last one', async () => {
    const { result } = renderHook(() => useCompeteSession(['con-005', 'tc-002']))
    await waitFor(() => {
      expect(result.current.status).toBe('playing')
    })

    act(() => {
      result.current.handleAnswered({ correct: true, choiceIndex: 0 })
    })
    expect(result.current.results).toHaveLength(1)
    expect(result.current.results[0]).toMatchObject({ puzzleId: 'con-005', correct: true })

    act(() => {
      result.current.handleContinue()
    })
    expect(result.current.puzzleIndex).toBe(1)
    expect(result.current.status).toBe('playing')
    expect(result.current.puzzle?.id).toBe('tc-002')

    act(() => {
      result.current.handleAnswered({ correct: false, choiceIndex: 0 })
    })
    act(() => {
      result.current.handleContinue()
    })
    expect(result.current.status).toBe('done')
    expect(result.current.results).toHaveLength(2)
    expect(result.current.results[1]).toMatchObject({ puzzleId: 'tc-002', correct: false })
  })
})
