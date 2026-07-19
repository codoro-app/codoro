import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { shuffledIndices } from './shuffleChoices'

describe('shuffledIndices', () => {
  it('is always a permutation of [0, count) for any count and any rng', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.array(fc.float({ min: 0, max: Math.fround(0.999), noNaN: true }), { minLength: 40 }),
        (count, randomValues) => {
          let cursor = 0
          const rng = () => {
            const value = randomValues[cursor % randomValues.length]
            cursor += 1
            return value ?? 0
          }
          const result = shuffledIndices(count, rng)
          expect(result).toHaveLength(count)
          expect([...result].sort((a, b) => a - b)).toEqual(
            Array.from({ length: count }, (_, i) => i),
          )
        },
      ),
    )
  })

  it('is deterministic for a fixed rng', () => {
    const rng = () => 0
    expect(shuffledIndices(4, rng)).toEqual(shuffledIndices(4, rng))
  })

  it('does not always place index 0 first when the rng varies', () => {
    // A regression guard for the reported bug: with a rng that isn't
    // degenerate, the shuffle must actually move index 0 out of the first
    // slot sometimes, not just return the identity permutation.
    const values = [0.9, 0.1, 0.5, 0.2]
    let cursor = 0
    const rng = () => {
      const value = values[cursor % values.length]
      cursor += 1
      return value ?? 0
    }
    const result = shuffledIndices(4, rng)
    expect(result[0]).not.toBe(0)
  })

  it('returns an empty array for count 0', () => {
    expect(shuffledIndices(0)).toEqual([])
  })

  it('returns [0] for count 1', () => {
    expect(shuffledIndices(1)).toEqual([0])
  })
})
