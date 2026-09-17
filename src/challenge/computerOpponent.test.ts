import { describe, expect, it } from 'vitest'
import type { Puzzle, Rng } from '../engine'
import { CHALLENGE_PAYLOAD_VERSION, MAX_CHALLENGE_PUZZLES } from './schema'
import {
  COMPUTER_CHALLENGER_NAME,
  TIER_TARGET_RATING,
  buildComputerChallengePayload,
  sampleDistinctIds,
  synthesizeTimeMs,
} from './computerOpponent'

// Deterministic seeded RNG (mulberry32) — same helper as src/engine/selection.test.ts.
function mulberry32(seed: number): Rng {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function fixturePool(): Puzzle[] {
  // 40 puzzles spanning 900-2000 (28-point steps) — well beyond every
  // tier's widened window, and >=10 land within any ±200 band.
  return Array.from({ length: 40 }, (_, i) => ({ id: `fx-${String(i)}`, rating: 900 + i * 28 }))
}

describe('buildComputerChallengePayload', () => {
  it('draws 5 distinct ids within the widened rating window around the tier target', () => {
    const pool = fixturePool()
    const payload = buildComputerChallengePayload('steady', pool, mulberry32(1))
    expect(payload.ids.length).toBe(MAX_CHALLENGE_PUZZLES)
    expect(new Set(payload.ids).size).toBe(payload.ids.length)
    const target = TIER_TARGET_RATING.steady
    for (const id of payload.ids) {
      const puzzle = pool.find((p) => p.id === id)
      expect(puzzle).toBeDefined()
      expect(Math.abs((puzzle?.rating ?? 0) - target)).toBeLessThanOrEqual(200)
    }
  })

  it('totalMs equals the sum of the synthesized per-puzzle time_ms', () => {
    const payload = buildComputerChallengePayload('elite', fixturePool(), mulberry32(7))
    const sum = payload.results.reduce((total, r) => total + r.time_ms, 0)
    expect(payload.totalMs).toBe(sum)
  })

  it('produces a schema-shaped v2 payload with the fixed bot challenger name', () => {
    const payload = buildComputerChallengePayload('novice', fixturePool(), mulberry32(3))
    expect(payload.v).toBe(CHALLENGE_PAYLOAD_VERSION)
    expect(payload.challengerName).toBe(COMPUTER_CHALLENGER_NAME)
    expect(payload.results.length).toBe(payload.ids.length)
  })

  it('correctness rate trends with expectedScore across a large sample at a fixed seed range', () => {
    // Every draw far above the novice target: expectedScore is low, so the
    // synthesized correctness rate should be low too.
    const hardPool: Puzzle[] = Array.from({ length: 20 }, (_, i) => ({
      id: `hard-${String(i)}`,
      rating: TIER_TARGET_RATING.novice + 600 + i,
    }))
    const samples = 200
    let hardCorrect = 0
    for (let seed = 0; seed < samples; seed++) {
      const payload = buildComputerChallengePayload('novice', hardPool, mulberry32(seed))
      hardCorrect += payload.results.filter((r) => r.correct).length
    }
    const hardRate = hardCorrect / (samples * MAX_CHALLENGE_PUZZLES)

    // Every draw exactly on the novice target: expectedScore(target,
    // target) === 0.5, so the rate should land near 0.5.
    const evenPool: Puzzle[] = Array.from({ length: 20 }, (_, i) => ({
      id: `even-${String(i)}`,
      rating: TIER_TARGET_RATING.novice,
    }))
    let evenCorrect = 0
    for (let seed = 0; seed < samples; seed++) {
      const payload = buildComputerChallengePayload('novice', evenPool, mulberry32(seed + 1000))
      evenCorrect += payload.results.filter((r) => r.correct).length
    }
    const evenRate = evenCorrect / (samples * MAX_CHALLENGE_PUZZLES)

    expect(hardRate).toBeLessThan(evenRate)
    expect(evenRate).toBeGreaterThan(0.35)
    expect(evenRate).toBeLessThan(0.65)
  })
})

describe('sampleDistinctIds', () => {
  it('returns fewer than count only when the eligible set itself is smaller', () => {
    const small: Puzzle[] = [
      { id: 'a', rating: 1000 },
      { id: 'b', rating: 1000 },
    ]
    const picked = sampleDistinctIds(small, 5, mulberry32(9))
    expect(picked.length).toBe(2)
    expect(new Set(picked.map((p) => p.id)).size).toBe(2)
  })
})

describe('synthesizeTimeMs', () => {
  it('is deterministic for a given tier/correctness/rng', () => {
    const a = synthesizeTimeMs('sharp', true, mulberry32(5))
    const b = synthesizeTimeMs('sharp', true, mulberry32(5))
    expect(a).toBe(b)
  })

  it('a wrong answer is never faster than the same roll would be if correct', () => {
    const correctTime = synthesizeTimeMs('steady', true, mulberry32(11))
    const wrongTime = synthesizeTimeMs('steady', false, mulberry32(11))
    expect(wrongTime).toBeGreaterThan(correctTime)
  })
})
