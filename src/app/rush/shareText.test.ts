import { describe, expect, it } from 'vitest'
import { buildRushShareText } from './shareText'

describe('buildRushShareText', () => {
  it('matches the build-plan format', () => {
    const text = buildRushShareText({ solvedCount: 23, bestStreakThisRun: 31 })
    expect(text).toBe('Codoro Rush — 23 solved · 🔥 best 31 — getcodoro.com')
  })

  it('renders a zero-solved run correctly', () => {
    const text = buildRushShareText({ solvedCount: 0, bestStreakThisRun: 0 })
    expect(text).toBe('Codoro Rush — 0 solved · 🔥 best 0 — getcodoro.com')
  })
})
