import { describe, expect, it } from 'vitest'
import { resolveDragSwap, resolveSlotPitch } from './dragOrderReorder'

const SLOT_PITCH = 50
const LENGTH = 4

describe('resolveDragSwap', () => {
  it('does not swap when the dragged row has not moved', () => {
    expect(
      resolveDragSwap({ draggingPosition: 1, offsetY: 0, slotPitch: SLOT_PITCH, length: LENGTH }),
    ).toBeNull()
  })

  it('does not swap for a small offset that stays short of the neighbor midpoint', () => {
    expect(
      resolveDragSwap({
        draggingPosition: 1,
        offsetY: SLOT_PITCH - 1,
        slotPitch: SLOT_PITCH,
        length: LENGTH,
      }),
    ).toBeNull()
    expect(
      resolveDragSwap({
        draggingPosition: 1,
        offsetY: -(SLOT_PITCH - 1),
        slotPitch: SLOT_PITCH,
        length: LENGTH,
      }),
    ).toBeNull()
  })

  it('swaps downward once the dragged center crosses the next row midpoint', () => {
    expect(
      resolveDragSwap({
        draggingPosition: 1,
        offsetY: SLOT_PITCH + 1,
        slotPitch: SLOT_PITCH,
        length: LENGTH,
      }),
    ).toBe(2)
  })

  it('swaps upward once the dragged center crosses the previous row midpoint', () => {
    expect(
      resolveDragSwap({
        draggingPosition: 1,
        offsetY: -(SLOT_PITCH + 1),
        slotPitch: SLOT_PITCH,
        length: LENGTH,
      }),
    ).toBe(0)
  })

  it('does not swap exactly at the boundary (crossing requires a strict inequality)', () => {
    expect(
      resolveDragSwap({
        draggingPosition: 1,
        offsetY: SLOT_PITCH,
        slotPitch: SLOT_PITCH,
        length: LENGTH,
      }),
    ).toBeNull()
  })

  it('never swaps past the top of the list', () => {
    expect(
      resolveDragSwap({
        draggingPosition: 0,
        offsetY: -1000,
        slotPitch: SLOT_PITCH,
        length: LENGTH,
      }),
    ).toBeNull()
  })

  it('never swaps past the bottom of the list', () => {
    expect(
      resolveDragSwap({
        draggingPosition: LENGTH - 1,
        offsetY: 1000,
        slotPitch: SLOT_PITCH,
        length: LENGTH,
      }),
    ).toBeNull()
  })

  it('returns null for a non-positive slotPitch (defensive, e.g. an unmeasured row)', () => {
    expect(
      resolveDragSwap({ draggingPosition: 1, offsetY: 1000, slotPitch: 0, length: LENGTH }),
    ).toBeNull()
  })
})

describe('resolveSlotPitch', () => {
  it('measures top-to-top distance to a neighbor below, not just row height', () => {
    // 44px row height + 8px list gap (practice.css's --space-2) = 52px
    // top-to-top pitch, distinct from either row's own height alone.
    const current = { top: 0, height: 44 }
    const neighborBelow = { top: 52, height: 44 }
    expect(resolveSlotPitch(current, neighborBelow)).toBe(52)
  })

  it('measures the same pitch regardless of whether the neighbor is above or below (Math.abs)', () => {
    const current = { top: 52, height: 44 }
    const neighborAbove = { top: 0, height: 44 }
    expect(resolveSlotPitch(current, neighborAbove)).toBe(52)
  })

  it("falls back to the row's own height when there is no neighbor to measure against", () => {
    const current = { top: 0, height: 44 }
    expect(resolveSlotPitch(current, null)).toBe(44)
  })
})
