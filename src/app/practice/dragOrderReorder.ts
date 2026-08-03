/**
 * Pure reorder-layout math for DragOrder's pointer- and keyboard-driven
 * reorder gesture. Zero React/DOM dependency by design, the same split
 * gestureThreshold.ts makes for SwipeBinary's own pure commit math — jsdom
 * doesn't do real layout, so this needs to be testable without a rendered,
 * measured DOM (see DragOrder.test.tsx, which mocks getBoundingClientRect
 * only for the handful of assertions that need it).
 *
 * Model: rows do NOT share a uniform height. `blocks` are prose (a printed
 * line, an execution-order sentence), `white-space: pre-wrap` on
 * `.drag-order__row-text` lets any block wrap to two or more lines on a
 * narrow phone width, and real content already has blocks that differ by
 * 15+ characters (e.g. rec-009.json's blocks range ~31–47 chars) — a single
 * scalar "row height" (this module's first version) drifts the moment any
 * two rows differ in wrapped height, which is exactly what real puzzle
 * content does, not an edge case. So every row's own height is measured
 * (`RowLayout.heights`, indexed by `blocks` index) and a row's rest
 * position is the cumulative sum of every row ahead of it in the current
 * order, each contributing its own height plus the list's uniform `gap`
 * (`RowLayout.gap`, `.drag-order__list`'s CSS `gap`) — never a multiple of
 * one constant.
 *
 * A swap fires once the dragged row's own visual center crosses the
 * vertical center of the neighbor it's moving toward — center-crossing,
 * not mere overlap, the usual "hovering past halfway" feel most
 * drag-reorder lists use. `liveCenter` is the dragged row's absolute
 * pixel center (its rest center at gesture start, plus total pointer
 * movement since) — tracking an absolute value rather than adjusting a
 * relative offset after each swap avoids compounding a per-swap
 * correction across rows of different heights.
 */

/** Each block's own measured height (px, indexed by `blocks`/`correct_order` index) and the list's uniform inter-row gap (px). */
export interface RowLayout {
  readonly heights: readonly number[]
  readonly gap: number
}

function requireEntry(values: readonly number[], index: number): number {
  const value = values[index]
  if (value === undefined) {
    throw new Error(
      `dragOrderReorder: index ${String(index)} out of range for length ${String(values.length)}`,
    )
  }
  return value
}

/** The identity permutation `[0, 1, ..., length - 1]` — blocks in their authored/display order, before any reordering. */
export function identityOrder(length: number): number[] {
  return Array.from({ length }, (_, i) => i)
}

/**
 * Cumulative top offset (px) for each SLOT in `order` (`order[i]` is the
 * block occupying slot `i`) — slot 0 is always 0, each following slot adds
 * the previous slot's own block height plus `gap`.
 */
export function computeRestTops(order: readonly number[], layout: RowLayout): number[] {
  const tops: number[] = []
  let acc = 0
  for (const blockIndex of order) {
    tops.push(acc)
    acc += requireEntry(layout.heights, blockIndex) + layout.gap
  }
  return tops
}

/** The absolute rest-position vertical center (px) of whichever block currently occupies `position` in `order`. */
export function restCenterAt(
  order: readonly number[],
  layout: RowLayout,
  position: number,
): number {
  const tops = computeRestTops(order, layout)
  const blockIndex = requireEntry(order, position)
  return requireEntry(tops, position) + requireEntry(layout.heights, blockIndex) / 2
}

/**
 * `translateY` (px) to apply to each block's row, indexed by block index —
 * rows render in FIXED DOM order (by block index, never reordered; see
 * DragOrder.tsx's own doc comment), so a block's own natural (untransformed)
 * rest top is its cumulative position under the identity order, and its
 * transform is the delta from that natural top to wherever `order`
 * currently places it.
 */
export function computeTranslateYs(order: readonly number[], layout: RowLayout): number[] {
  const restTops = computeRestTops(order, layout)
  const naturalTops = computeRestTops(identityOrder(order.length), layout)
  const translateYs = new Array<number>(order.length).fill(0)
  order.forEach((blockIndex, position) => {
    translateYs[blockIndex] =
      requireEntry(restTops, position) - requireEntry(naturalTops, blockIndex)
  })
  return translateYs
}

export interface DragSwapInput {
  /** Current slot→block mapping, before this check. */
  readonly order: readonly number[]
  /** The dragged block's current slot (index into `order`), before this check. */
  readonly draggingPosition: number
  /** The dragged row's live absolute vertical center (px) — its rest center at gesture start, plus total pointer movement since. */
  readonly liveCenter: number
  readonly layout: RowLayout
}

/**
 * The neighbor slot to swap with, or `null` if the dragged row hasn't
 * crossed either neighbor's center (including when there is no such
 * neighbor — the dragged row is already at the top/bottom of the list).
 */
export function resolveDragSwap({
  order,
  draggingPosition,
  liveCenter,
  layout,
}: DragSwapInput): number | null {
  if (draggingPosition > 0) {
    const aboveCenter = restCenterAt(order, layout, draggingPosition - 1)
    if (liveCenter < aboveCenter) return draggingPosition - 1
  }

  if (draggingPosition < order.length - 1) {
    const belowCenter = restCenterAt(order, layout, draggingPosition + 1)
    if (liveCenter > belowCenter) return draggingPosition + 1
  }

  return null
}
