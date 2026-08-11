import { describe, expect, it } from 'vitest'
import { buildBossGhostPaceText } from './ghostPace'

describe('buildBossGhostPaceText', () => {
  it('formats a comparison when this run was faster to the same position', () => {
    const text = buildBossGhostPaceText({
      depthReached: 7,
      splits: [10_000, 20_000, 35_000, 50_000, 70_000, 90_000, 118_000],
      previousBestSplits: [12_000, 25_000, 40_000, 60_000, 85_000, 110_000, 134_000],
    })
    expect(text).toBe('You reached puzzle 7 in 1:58 — your best run got there in 2:14.')
  })

  it('formats a comparison when this run was slower to the same position (the reverse case)', () => {
    const text = buildBossGhostPaceText({
      depthReached: 4,
      splits: [15_000, 35_000, 55_000, 80_000],
      previousBestSplits: [10_000, 22_000, 40_000, 58_000],
    })
    expect(text).toBe('You reached puzzle 4 in 1:20 — your best run got there in 0:58.')
  })

  it('returns null when there is no prior best-depth run at all (first-ever run, or a legacy bestDepth predating split tracking)', () => {
    const text = buildBossGhostPaceText({
      depthReached: 3,
      splits: [1000, 2000, 3000],
      previousBestSplits: null,
    })
    expect(text).toBeNull()
  })

  it('returns null when the prior best run never reached this depth — nothing honest to compare at that position', () => {
    const text = buildBossGhostPaceText({
      depthReached: 8,
      splits: [1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000],
      previousBestSplits: [900, 1800, 2700, 3600, 4500], // only reached depth 5
    })
    expect(text).toBeNull()
  })

  it('handles depthReached: 1 correctly (index 0)', () => {
    const text = buildBossGhostPaceText({
      depthReached: 1,
      splits: [5000],
      previousBestSplits: [4000],
    })
    expect(text).toBe('You reached puzzle 1 in 0:05 — your best run got there in 0:04.')
  })

  it('rounds seconds to the nearest whole second rather than truncating', () => {
    const text = buildBossGhostPaceText({
      depthReached: 1,
      splits: [59_600], // rounds up to 1:00, not 0:59
      previousBestSplits: [59_400], // rounds down to 0:59
    })
    expect(text).toBe('You reached puzzle 1 in 1:00 — your best run got there in 0:59.')
  })
})
