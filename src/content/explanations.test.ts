import { describe, expect, it } from 'vitest'
import { getExplanationSet } from './explanations'

// Mirrors index.test.ts's getPuzzleBody tests — same lazy-loader contract
// (undefined for a missing id, real validated data for a known one).
describe('getExplanationSet', () => {
  it('resolves a real, schema-valid explanation set for a known id', async () => {
    const set = await getExplanationSet('oob-001')
    expect(set?.puzzle_id).toBe('oob-001')
    expect(set?.interaction).toBe('mcq')
    expect(set?.entries.length).toBeGreaterThan(0)
  })

  it('resolves undefined for a puzzle with no explanation file yet', async () => {
    const set = await getExplanationSet('nonexistent-id-xyz')
    expect(set).toBeUndefined()
  })
})
