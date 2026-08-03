import { describe, expect, it } from 'vitest'
import {
  computeRestTops,
  computeTranslateYs,
  identityOrder,
  resolveDragSwap,
  restCenterAt,
} from './dragOrderReorder'
import type { RowLayout } from './dragOrderReorder'

const UNIFORM: RowLayout = { heights: [50, 50, 50, 50], gap: 0 }
const LENGTH = 4

describe('identityOrder', () => {
  it('returns [0, 1, ..., length - 1]', () => {
    expect(identityOrder(4)).toEqual([0, 1, 2, 3])
  })
})

describe('computeRestTops', () => {
  it('returns cumulative offsets for uniform-height rows with no gap', () => {
    expect(computeRestTops([0, 1, 2, 3], UNIFORM)).toEqual([0, 50, 100, 150])
  })

  it('accounts for the list gap between every row', () => {
    const layout: RowLayout = { heights: [50, 50, 50], gap: 8 }
    expect(computeRestTops([0, 1, 2], layout)).toEqual([0, 58, 116])
  })

  it('accounts for each row contributing its OWN height, not a shared constant — the actual real-device bug', () => {
    // Block 0 wraps to two lines (100px), blocks 1 and 2 stay one line
    // (40px) — a uniform "row height" model (this module's first version)
    // would space every slot by the same pitch regardless of which block
    // occupies it; the real top-to-top distance depends on which block
    // came before, which is exactly what real puzzle content triggers
    // (rec-009.json's blocks range ~31–47 characters under `pre-wrap`).
    const layout: RowLayout = { heights: [100, 40, 40], gap: 10 }
    expect(computeRestTops([0, 1, 2], layout)).toEqual([0, 110, 160])
    // Reordering so the tall block is last changes every following slot's
    // top — proof the math is genuinely per-row, not position-indexed.
    expect(computeRestTops([1, 2, 0], layout)).toEqual([0, 50, 100])
  })
})

describe('restCenterAt', () => {
  it("is a slot's rest top plus half of whichever block currently occupies it", () => {
    const layout: RowLayout = { heights: [100, 40, 40], gap: 10 }
    const order = [0, 1, 2]
    expect(restCenterAt(order, layout, 0)).toBe(50) // 0 + 100/2
    expect(restCenterAt(order, layout, 1)).toBe(130) // 110 + 40/2
    expect(restCenterAt(order, layout, 2)).toBe(180) // 160 + 40/2
  })
})

describe('computeTranslateYs', () => {
  it('is all zero for the identity order (no reordering yet)', () => {
    expect(computeTranslateYs([0, 1, 2, 3], UNIFORM)).toEqual([0, 0, 0, 0])
  })

  it("is the delta from a block's natural (identity-order) top to its current slot's top, per block, with non-uniform heights", () => {
    const layout: RowLayout = { heights: [100, 40, 40], gap: 10 }
    // Natural tops (identity order [0, 1, 2]): [0, 110, 160].
    // Reordered to [1, 2, 0] (tall block last): rest tops [0, 50, 100].
    // Block 1 moves from natural top 110 to rest top 0 → -110.
    // Block 2 moves from natural top 160 to rest top 50 → -110.
    // Block 0 moves from natural top 0 to rest top 100 → +100.
    expect(computeTranslateYs([1, 2, 0], layout)).toEqual([100, -110, -110])
  })
})

describe('resolveDragSwap', () => {
  it('does not swap when the dragged row has not moved', () => {
    const order = identityOrder(LENGTH)
    expect(
      resolveDragSwap({
        order,
        draggingPosition: 1,
        liveCenter: restCenterAt(order, UNIFORM, 1),
        layout: UNIFORM,
      }),
    ).toBeNull()
  })

  it("does not swap short of a neighbor's center", () => {
    const order = identityOrder(LENGTH)
    const belowCenter = restCenterAt(order, UNIFORM, 2)
    expect(
      resolveDragSwap({ order, draggingPosition: 1, liveCenter: belowCenter - 1, layout: UNIFORM }),
    ).toBeNull()
    const aboveCenter = restCenterAt(order, UNIFORM, 0)
    expect(
      resolveDragSwap({ order, draggingPosition: 1, liveCenter: aboveCenter + 1, layout: UNIFORM }),
    ).toBeNull()
  })

  it("swaps down past the next neighbor's center", () => {
    const order = identityOrder(LENGTH)
    const belowCenter = restCenterAt(order, UNIFORM, 2)
    expect(
      resolveDragSwap({ order, draggingPosition: 1, liveCenter: belowCenter + 1, layout: UNIFORM }),
    ).toBe(2)
  })

  it("swaps up past the previous neighbor's center", () => {
    const order = identityOrder(LENGTH)
    const aboveCenter = restCenterAt(order, UNIFORM, 0)
    expect(
      resolveDragSwap({ order, draggingPosition: 1, liveCenter: aboveCenter - 1, layout: UNIFORM }),
    ).toBe(0)
  })

  it('never swaps past the top or bottom of the list', () => {
    const order = identityOrder(LENGTH)
    expect(
      resolveDragSwap({ order, draggingPosition: 0, liveCenter: -1000, layout: UNIFORM }),
    ).toBeNull()
    expect(
      resolveDragSwap({ order, draggingPosition: LENGTH - 1, liveCenter: 1000, layout: UNIFORM }),
    ).toBeNull()
  })

  it("uses each neighbor's OWN height for its center, not a shared pitch — a tall block above takes less upward travel to cross than a uniform-pitch model would predict", () => {
    // Block 0 is tall (100px), blocks 1/2/3 are short (40px), no gap.
    const layout: RowLayout = { heights: [100, 40, 40, 40], gap: 0 }
    const order = identityOrder(4)
    // Block 1 (short, at position 1) dragging up toward block 0 (tall, at
    // position 0): block 0's center is at 50 (0 + 100/2), well short of
    // where a uniform 40px-pitch model would have placed it (20). Just
    // short of 50 should not swap; just past it should.
    expect(resolveDragSwap({ order, draggingPosition: 1, liveCenter: 51, layout })).toBeNull()
    expect(resolveDragSwap({ order, draggingPosition: 1, liveCenter: 49, layout })).toBe(0)
  })
})
