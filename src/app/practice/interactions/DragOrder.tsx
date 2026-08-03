import { useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { InteractionBodyProps } from '../interactionTypes'
import type { DragOrderPuzzle } from '../../../content'
import type { AnswerState } from '../answerState'
import { resolveDragSwap, resolveSlotPitch } from '../dragOrderReorder'

interface DragState {
  /** Identity of the dragged block — a `puzzle.blocks` index, fixed for the whole gesture. Rows render in fixed DOM order by this index (see the component doc comment); only this block's *position* within `order` moves. */
  blockIndex: number
  /** Live pixel offset from the dragged row's current rest position (positive = down). */
  offsetY: number
}

/**
 * Feature-detected pointer capture: every real browser target (including
 * every mobile one) implements it, but jsdom does not — a `typeof` guard
 * (rather than optional chaining, which `@typescript-eslint/no-unnecessary-condition`
 * rejects here since lib.dom types it as always-present) keeps this
 * component testable with plain `fireEvent.pointerDown` rather than
 * requiring every test to polyfill it.
 */
function setPointerCaptureIfSupported(el: HTMLElement, pointerId: number): void {
  if (typeof el.setPointerCapture === 'function') {
    el.setPointerCapture(pointerId)
  }
}

function releasePointerCaptureIfSupported(el: HTMLElement, pointerId: number): void {
  if (typeof el.releasePointerCapture === 'function') {
    el.releasePointerCapture(pointerId)
  }
}

/** `order[position]`, guarding noUncheckedIndexedAccess for a position already bounds-checked by the caller (mirrors schema.ts's requireStep) — every call site here derives `position` from `order.length` itself, so this is defensive only, never expected to actually throw. */
function requirePosition(order: readonly number[], position: number): number {
  const blockIndex = order[position]
  if (blockIndex === undefined) {
    throw new Error(
      `DragOrder: position ${String(position)} out of range for order.length ${String(order.length)}`,
    )
  }
  return blockIndex
}

/** A new array with the block indices at two positions swapped — used by both the drag gesture and the keyboard fallback below. */
function swapPositions(order: readonly number[], a: number, b: number): number[] {
  const next = [...order]
  next[a] = requirePosition(order, b)
  next[b] = requirePosition(order, a)
  return next
}

function identityOrder(length: number): number[] {
  return Array.from({ length }, (_, i) => i)
}

/**
 * Native-Pointer-Events drag-to-reorder list — no gesture library dependency
 * (unlike SwipeBinary's `@use-gesture/react`; drag-order was deliberately
 * scoped to build on Pointer Events alone, see the Phase 5b Item 5 brief).
 * A dedicated `.drag-order__handle` child (>=44px, see practice.css) is the
 * drag hit target, not the whole row — a browser decides whether a touch
 * starts a native scroll or a custom gesture at hit-test time, before any
 * JS handler runs, so `touch-action: none` has to be a STATIC CSS property
 * on that handle rather than something toggled at runtime (too late on a
 * real touchscreen). The rest of the row stays `pan-y` (native scroll).
 * Arrow-key reordering (below) covers players without a pointer.
 *
 * Rows render in FIXED DOM order (by `puzzle.blocks` index, never
 * reordered) and are positioned purely via a `transform: translateY(...)`
 * computed from where that block currently sits in `order` — not by
 * reordering DOM children. That's what makes "a displaced row glides to its
 * new slot" a plain CSS transition (practice.css's
 * `.drag-order__row { transition: transform }`) rather than a FLIP
 * animation: nothing ever discontinuously reflows, only a transform value
 * changes, which the browser already knows how to animate. The actively
 * dragged row gets `transition: none` (practice.css's `--dragging`
 * modifier) so it tracks the pointer 1:1 instead of easing behind it.
 *
 * The pitch used for that transform — and fed to `resolveDragSwap` — is the
 * real top-to-top distance between adjacent rows (`resolveSlotPitch`,
 * dragOrderReorder.ts), NOT `getBoundingClientRect().height` alone: the
 * list has a `gap` between rows (practice.css), so height alone
 * under-measures the real slot spacing and both the rest-position
 * transform and the swap threshold would drift off by the gap's width per
 * displaced slot.
 *
 * `order[i]` is the `puzzle.blocks` index currently occupying position `i`
 * — initialized as the identity permutation (blocks start in their
 * authored/display order, no extra runtime shuffling).
 */
export function DragOrder({ puzzle, committed, onCommit }: InteractionBodyProps<DragOrderPuzzle>) {
  const [order, setOrder] = useState<number[]>(() => identityOrder(puzzle.blocks.length))
  const [dragState, setDragState] = useState<DragState | null>(null)
  // Tracks whether the player has pressed "Check order" — freezes `order`
  // against further drag/keyboard input immediately, without waiting for
  // the `committed` prop to flip (that happens one render later, once the
  // parent — PuzzleCardShell — reacts to onCommit).
  const [submitted, setSubmitted] = useState(false)

  // PuzzleCardShell's own doc comment promises callers don't need
  // `key={puzzle.id}` because the shell self-resets committed state — but
  // that guarantee is worthless if THIS component's own `order`/`dragState`/
  // `submitted` state doesn't also reset when `puzzle.id` changes without a
  // remount. This is the React-docs "adjust state when a prop changes"
  // pattern (comparing against a ref of the last-seen id and calling
  // setState directly during render) rather than a `useEffect`, which would
  // commit one stale (previous puzzle's board) frame first.
  const [puzzleId, setPuzzleId] = useState(puzzle.id)
  if (puzzleId !== puzzle.id) {
    setPuzzleId(puzzle.id)
    setOrder(identityOrder(puzzle.blocks.length))
    setDragState(null)
    setSubmitted(false)
  }

  const rowRefs = useRef<(HTMLDivElement | null)[]>([])
  const startClientYRef = useRef(0)
  const slotPitchRef = useRef(0)

  const locked = committed || submitted

  /** Real top-to-top slot pitch for `blockIndex`'s row, measured against whichever neighbor row exists (below preferred, else above). */
  const measureSlotPitch = (blockIndex: number): number => {
    const rowEl = rowRefs.current[blockIndex]
    if (!rowEl) return 0
    const rect = rowEl.getBoundingClientRect()

    const position = order.indexOf(blockIndex)
    const neighborPosition = position + 1 < order.length ? position + 1 : position - 1
    if (neighborPosition < 0 || neighborPosition >= order.length) {
      return resolveSlotPitch(rect, null)
    }
    const neighborEl = rowRefs.current[requirePosition(order, neighborPosition)]
    if (!neighborEl) return resolveSlotPitch(rect, null)
    return resolveSlotPitch(rect, neighborEl.getBoundingClientRect())
  }

  const handlePointerDown = (blockIndex: number) => (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (locked) return
    setPointerCaptureIfSupported(event.currentTarget, event.pointerId)
    slotPitchRef.current = measureSlotPitch(blockIndex)
    startClientYRef.current = event.clientY
    setDragState({ blockIndex, offsetY: 0 })
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (dragState === null) return

    let offsetY = event.clientY - startClientYRef.current
    let position = order.indexOf(dragState.blockIndex)
    let nextOrder = order

    // Loop rather than a single check: a fast pointermove can in principle
    // cross more than one neighbor's midpoint in a single event, and each
    // resolved swap must adjust offsetY by exactly one slot pitch (see
    // dragOrderReorder.ts's doc comment) before the next check runs.
    for (;;) {
      const target = resolveDragSwap({
        draggingPosition: position,
        offsetY,
        slotPitch: slotPitchRef.current,
        length: nextOrder.length,
      })
      if (target === null) break
      const delta = target - position
      nextOrder = swapPositions(nextOrder, position, target)
      offsetY -= delta * slotPitchRef.current
      position = target
    }

    if (nextOrder !== order) setOrder(nextOrder)
    setDragState({ blockIndex: dragState.blockIndex, offsetY })
  }

  const endDrag = (event: ReactPointerEvent<HTMLSpanElement>) => {
    if (dragState === null) return
    releasePointerCaptureIfSupported(event.currentTarget, event.pointerId)
    // order[] already holds the final arrangement from the live swaps above
    // — ending the drag just clears dragState, which drops the dragged row's
    // live offset back to 0 and (via the CSS transition on the now-plain
    // `.drag-order__row` class) animates it into its rest slot.
    setDragState(null)
  }

  /** Non-pointer fallback: moves `blockIndex`'s row one slot toward `direction`, swapping with whichever neighbor is there. Same swap logic the drag gesture uses, just a single discrete step per keypress instead of a continuous midpoint check. */
  const moveByKeyboard = (blockIndex: number, direction: -1 | 1) => {
    if (locked) return
    const position = order.indexOf(blockIndex)
    const target = position + direction
    if (target < 0 || target >= order.length) return
    setOrder((prev) => swapPositions(prev, position, target))
  }

  const handleRowKeyDown = (blockIndex: number) => (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault()
      moveByKeyboard(blockIndex, -1)
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      moveByKeyboard(blockIndex, 1)
    }
  }

  const handleSubmit = () => {
    if (locked) return
    const correct = order.every(
      (blockIndex, position) => blockIndex === puzzle.correct_order[position],
    )
    setSubmitted(true)
    onCommit({ correct, choiceIndex: null })
  }

  if (committed) {
    return (
      <div className="drag-order">
        <div className="drag-order__list drag-order__list--locked" role="list">
          {order.map((blockIndex, position) => {
            const state: AnswerState =
              puzzle.correct_order[position] === blockIndex ? 'correct' : 'wrong'
            return (
              <div
                key={blockIndex}
                className={`drag-order__row drag-order__row--locked drag-order__row--${state}`}
                role="listitem"
              >
                <span className="drag-order__row-badge" aria-hidden="true">
                  {position + 1}
                </span>
                <span className="drag-order__row-text">{puzzle.blocks[blockIndex]}</span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="drag-order">
      <p className="drag-order__hint">
        Drag the blocks into the correct order (or focus a block and use the up/down arrow keys).
      </p>
      <div className="drag-order__list" role="list">
        {puzzle.blocks.map((text, blockIndex) => {
          const position = order.indexOf(blockIndex)
          const isDragging = dragState?.blockIndex === blockIndex
          const translateY =
            (position - blockIndex) * slotPitchRef.current + (isDragging ? dragState.offsetY : 0)
          return (
            <div
              key={blockIndex}
              ref={(el) => {
                rowRefs.current[blockIndex] = el
              }}
              className={['drag-order__row', isDragging && 'drag-order__row--dragging']
                .filter(Boolean)
                .join(' ')}
              style={{ transform: `translateY(${String(translateY)}px)` }}
              role="listitem"
              tabIndex={0}
              aria-label={`${text}, position ${String(position + 1)} of ${String(puzzle.blocks.length)}. Use the up and down arrow keys to reorder.`}
              onKeyDown={handleRowKeyDown(blockIndex)}
            >
              <span
                className="drag-order__handle"
                aria-hidden="true"
                onPointerDown={handlePointerDown(blockIndex)}
                onPointerMove={handlePointerMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
              >
                {position + 1}
              </span>
              <span className="drag-order__row-text">{text}</span>
            </div>
          )
        })}
      </div>
      <button type="button" className="drag-order__submit" onClick={handleSubmit} disabled={locked}>
        Check order
      </button>
    </div>
  )
}
