import { describe, expect, it } from 'vitest'
import { resolveDragSwap } from './dragOrderReorder'

const ROW_HEIGHT = 50
const LENGTH = 4

describe('resolveDragSwap', () => {
  it('does not swap when the dragged row has not moved', () => {
    expect(
      resolveDragSwap({ draggingPosition: 1, offsetY: 0, rowHeight: ROW_HEIGHT, length: LENGTH }),
    ).toBeNull()
  })

  it('does not swap for a small offset that stays short of the neighbor midpoint', () => {
    expect(
      resolveDragSwap({
        draggingPosition: 1,
        offsetY: ROW_HEIGHT - 1,
        rowHeight: ROW_HEIGHT,
        length: LENGTH,
      }),
    ).toBeNull()
    expect(
      resolveDragSwap({
        draggingPosition: 1,
        offsetY: -(ROW_HEIGHT - 1),
        rowHeight: ROW_HEIGHT,
        length: LENGTH,
      }),
    ).toBeNull()
  })

  it('swaps downward once the dragged center crosses the next row midpoint', () => {
    expect(
      resolveDragSwap({
        draggingPosition: 1,
        offsetY: ROW_HEIGHT + 1,
        rowHeight: ROW_HEIGHT,
        length: LENGTH,
      }),
    ).toBe(2)
  })

  it('swaps upward once the dragged center crosses the previous row midpoint', () => {
    expect(
      resolveDragSwap({
        draggingPosition: 1,
        offsetY: -(ROW_HEIGHT + 1),
        rowHeight: ROW_HEIGHT,
        length: LENGTH,
      }),
    ).toBe(0)
  })

  it('does not swap exactly at the boundary (crossing requires a strict inequality)', () => {
    expect(
      resolveDragSwap({
        draggingPosition: 1,
        offsetY: ROW_HEIGHT,
        rowHeight: ROW_HEIGHT,
        length: LENGTH,
      }),
    ).toBeNull()
  })

  it('never swaps past the top of the list', () => {
    expect(
      resolveDragSwap({
        draggingPosition: 0,
        offsetY: -1000,
        rowHeight: ROW_HEIGHT,
        length: LENGTH,
      }),
    ).toBeNull()
  })

  it('never swaps past the bottom of the list', () => {
    expect(
      resolveDragSwap({
        draggingPosition: LENGTH - 1,
        offsetY: 1000,
        rowHeight: ROW_HEIGHT,
        length: LENGTH,
      }),
    ).toBeNull()
  })

  it('returns null for a non-positive rowHeight (defensive, e.g. an unmeasured row)', () => {
    expect(
      resolveDragSwap({ draggingPosition: 1, offsetY: 1000, rowHeight: 0, length: LENGTH }),
    ).toBeNull()
  })
})
