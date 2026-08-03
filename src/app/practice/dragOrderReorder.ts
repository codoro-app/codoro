/**
 * Pure "should the dragged row swap with a neighbor" math for DragOrder's
 * pointer-driven reorder gesture. Zero React/DOM dependency by design, the
 * same split gestureThreshold.ts makes for SwipeBinary's own pure commit
 * math — jsdom doesn't do real layout, so this needs to be testable without
 * a rendered, measured DOM (see DragOrder.test.tsx, which mocks
 * getBoundingClientRect only for the handful of assertions that need it).
 *
 * Model: rows sit in a vertical list of uniform height `rowHeight`, at rest
 * position `position * rowHeight` (top edge). A drag reports its live pixel
 * offset from that rest position (`offsetY`, positive = down). A swap fires
 * once the dragged row's own visual center crosses the vertical midpoint of
 * the neighbor it's moving toward — center-crossing, not mere overlap — the
 * usual "hovering past halfway" feel most drag-reorder lists use. Since
 * center-to-center distance between adjacent rows is exactly `rowHeight`,
 * crossing a neighbor's center always requires `|offsetY| > rowHeight`
 * exactly (not `>= rowHeight / 2`), regardless of how many rows exist.
 */

export interface DragSwapInput {
  /** The dragged row's current position (index into the order array), before this check. */
  readonly draggingPosition: number
  /** Live pixel offset of the dragged row from its rest position (positive = down). */
  readonly offsetY: number
  /** Row height in px — rows are treated as uniform height. */
  readonly rowHeight: number
  /** Total number of rows in the list. */
  readonly length: number
}

/**
 * The neighbor position to swap with, or `null` if the dragged row hasn't
 * crossed either neighbor's midpoint (including when there is no such
 * neighbor — the dragged row is already at the top/bottom of the list).
 */
export function resolveDragSwap({
  draggingPosition,
  offsetY,
  rowHeight,
  length,
}: DragSwapInput): number | null {
  if (rowHeight <= 0) return null

  const draggedCenter = draggingPosition * rowHeight + rowHeight / 2 + offsetY

  if (draggingPosition > 0) {
    const aboveCenter = (draggingPosition - 1) * rowHeight + rowHeight / 2
    if (draggedCenter < aboveCenter) return draggingPosition - 1
  }

  if (draggingPosition < length - 1) {
    const belowCenter = (draggingPosition + 1) * rowHeight + rowHeight / 2
    if (draggedCenter > belowCenter) return draggingPosition + 1
  }

  return null
}
