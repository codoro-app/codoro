import { describe, expect, it } from 'vitest'
import { resolveStreakPause } from './streakPauseLogic'

describe('resolveStreakPause', () => {
  it('returns null below the first interval', () => {
    expect(resolveStreakPause(0, 0)).toBeNull()
    expect(resolveStreakPause(4, 0)).toBeNull()
  })

  it('fires at exactly the interval', () => {
    expect(resolveStreakPause(5, 0)).toEqual({ streak: 5, isNewBest: true })
  })

  it('fires again at every subsequent multiple, not just once', () => {
    expect(resolveStreakPause(10, 0)).toEqual({ streak: 10, isNewBest: true })
    expect(resolveStreakPause(15, 0)).toEqual({ streak: 15, isNewBest: true })
  })

  it('returns null between multiples', () => {
    expect(resolveStreakPause(6, 0)).toBeNull()
    expect(resolveStreakPause(9, 0)).toBeNull()
    expect(resolveStreakPause(11, 0)).toBeNull()
  })

  it('marks isNewBest true only when the streak exceeds the stored best, not merely equal', () => {
    expect(resolveStreakPause(5, 4)).toEqual({ streak: 5, isNewBest: true })
    expect(resolveStreakPause(5, 5)).toEqual({ streak: 5, isNewBest: false })
    expect(resolveStreakPause(5, 6)).toEqual({ streak: 5, isNewBest: false })
  })
})
