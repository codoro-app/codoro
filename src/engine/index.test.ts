import { describe, expect, it } from 'vitest'
import { clamp } from './index'

describe('clamp', () => {
  it('returns the value when within range', () => {
    expect(clamp(5, 0, 10)).toBe(5)
  })

  it('clamps to the floor', () => {
    expect(clamp(-5, 0, 10)).toBe(0)
  })

  it('clamps to the ceiling', () => {
    expect(clamp(15, 0, 10)).toBe(10)
  })

  it('throws when min > max', () => {
    expect(() => clamp(5, 10, 0)).toThrow()
  })
})
