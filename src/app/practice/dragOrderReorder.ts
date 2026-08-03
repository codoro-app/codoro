/**
 * Pure "should the dragged row swap with a neighbor" math for DragOrder's
 * pointer-driven reorder gesture, plus the pitch measurement that feeds it.
 * Zero React/DOM dependency by design, the same split gestureThreshold.ts
 * makes for SwipeBinary's own pure commit math — jsdom doesn't do real
 * layout, so this needs to be testable without a rendered, measured DOM
 * (see DragOrder.test.tsx, which mocks getBoundingClientRect only for the
 * handful of assertions that need it).
 *
 * Model: rows sit in a vertical list at a uniform "slot pitch" — the
 * top-to-top distance between adjacent rows, i.e. row height PLUS the
 * list's inter-row `gap` (practice.css's `.drag-order__list { gap }`), not
 * height alone. A drag reports its live pixel offset from its rest
 * position (`offsetY`, positive = down). A swap fires once the dragged
 * row's own visual center crosses the vertical midpoint of the neighbor
 * it's moving toward — center-crossing, not mere overlap — the usual
 * "hovering past halfway" feel most drag-reorder lists use. Since
 * center-to-center distance between adjacent rows is exactly one slot
 * pitch, crossing a neighbor's center always requires `|offsetY| >
 * slotPitch` exactly (not `>= slotPitch / 2`), regardless of how many rows
 * exist.
 */

export interface DragSwapInput {
  /** The dragged row's current position (index into the order array), before this check. */
  readonly draggingPosition: number
  /** Live pixel offset of the dragged row from its rest position (positive = down). */
  readonly offsetY: number
  /** Top-to-top distance (px) between adjacent rows — row height + gap, not height alone. See resolveSlotPitch. */
  readonly slotPitch: number
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
  slotPitch,
  length,
}: DragSwapInput): number | null {
  if (slotPitch <= 0) return null

  const draggedCenter = draggingPosition * slotPitch + slotPitch / 2 + offsetY

  if (draggingPosition > 0) {
    const aboveCenter = (draggingPosition - 1) * slotPitch + slotPitch / 2
    if (draggedCenter < aboveCenter) return draggingPosition - 1
  }

  if (draggingPosition < length - 1) {
    const belowCenter = (draggingPosition + 1) * slotPitch + slotPitch / 2
    if (draggedCenter > belowCenter) return draggingPosition + 1
  }

  return null
}

/** A row's position, as measured off its own `getBoundingClientRect()` (or an equivalent). */
export interface RowRect {
  readonly top: number
  readonly height: number
}

/**
 * The real slot pitch (px) between a row and an adjacent one, measured
 * top-to-top — this is what makes the pitch fed to `resolveDragSwap` (and
 * to the rest-position transform math) include the list's `gap`, not just
 * `height`. Falls back to the row's own height (no gap) when there's no
 * second row to measure against — a defensive-only case, since
 * `DragOrderSchema` requires >=3 blocks, but cheap to handle correctly
 * regardless of which side the neighbor is measured from (`Math.abs`
 * means it doesn't matter whether `neighbor` is the row above or below).
 */
export function resolveSlotPitch(current: RowRect, neighbor: RowRect | null): number {
  if (neighbor === null) return current.height
  return Math.abs(neighbor.top - current.top)
}
