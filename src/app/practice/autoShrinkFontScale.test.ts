import { describe, expect, it } from 'vitest'
import { computeShrinkScale, DEFAULT_MIN_FONT_SCALE } from './autoShrinkFontScale'

describe('computeShrinkScale', () => {
  it('does not shrink when the content already fits', () => {
    const result = computeShrinkScale(300, 400, DEFAULT_MIN_FONT_SCALE)
    expect(result).toEqual({ scale: 1, scrollable: false })
  })

  it('shrinks to the exact ratio needed when it stays above the floor', () => {
    // scrollWidth 360 / clientWidth 300 -> required scale 300/360 = 0.8333...,
    // above the 0.7 floor, so it should shrink to exactly that ratio.
    const result = computeShrinkScale(360, 300, DEFAULT_MIN_FONT_SCALE)
    expect(result.scale).toBeCloseTo(300 / 360, 5)
    expect(result.scrollable).toBe(false)
  })

  it('clamps to the floor and marks scrollable when the required scale is below the floor', () => {
    // scrollWidth 1000 / clientWidth 100 -> required scale 0.1, well under
    // the 0.7 floor.
    const result = computeShrinkScale(1000, 100, DEFAULT_MIN_FONT_SCALE)
    expect(result).toEqual({ scale: DEFAULT_MIN_FONT_SCALE, scrollable: true })
  })
})
