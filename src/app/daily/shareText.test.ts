import { describe, expect, it } from 'vitest'
import { buildShareText } from './shareText'

describe('buildShareText', () => {
  it('matches the exact Wordle-style format from the build plan (first-try success)', () => {
    const text = buildShareText({ dayNumber: 37, correct: true, streak: 12 })
    expect(text).toBe('Codoro Daily #37 — ✅ first try — 🔥 12-day streak — getcodoro.com')
  })

  it('renders a missed first attempt with a distinct icon/copy, still no spoilers', () => {
    const text = buildShareText({ dayNumber: 5, correct: false, streak: 1 })
    expect(text).toBe('Codoro Daily #5 — ❌ missed it — 🔥 1-day streak — getcodoro.com')
  })

  it('renders a zero streak correctly (first-ever Daily completion)', () => {
    const text = buildShareText({ dayNumber: 1, correct: true, streak: 0 })
    expect(text).toBe('Codoro Daily #1 — ✅ first try — 🔥 0-day streak — getcodoro.com')
  })

  it('never includes puzzle-specific content (prompt/explanation) — no spoilers by construction', () => {
    const text = buildShareText({ dayNumber: 37, correct: true, streak: 12 })
    expect(text).not.toMatch(/explanation|prompt|snippet/i)
  })
})
