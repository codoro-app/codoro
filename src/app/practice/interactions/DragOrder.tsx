import { useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { InteractionBodyProps } from '../interactionTypes'
import type { DragOrderPuzzle } from '../../../content'
import type { AnswerState } from '../answerState'
import { resolveDragSwap } from '../dragOrderReorder'

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

/**
 * Native-Pointer-Events drag-to-reorder list — no gesture library dependency
 * (unlike SwipeBinary's `@use-gesture/react`; drag-order was deliberately
 * scoped to build on Pointer Events alone, see the Phase 5b Item 5 brief).
 * Every row is the full drag handle: there's no other tap target on a block
 * row, so the whole row maximizes the hit area ("thumb-sized hit targets").
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
 * modifier) so it tracks the pointer 1:1 instead of easing behind it, and
 * `touch-action: none` — applied ONLY to that one row, not the list or
 * rows at rest — so a real drag never fights native vertical page scroll
 * except while a row is actually being dragged.
 *
 * `order[i]` is the `puzzle.blocks` index currently occupying position `i`
 * — initialized as the identity permutation (blocks start in their
 * authored/display order, no extra runtime shuffling). `resolveDragSwap`
 * (dragOrderReorder.ts) is the pure "has the dragged row crossed a
 * neighbor's midpoint" check; this component owns only the pointer
 * plumbing and DOM measurement around it.
 */
export function DragOrder({ puzzle, committed, onCommit }: InteractionBodyProps<DragOrderPuzzle>) {
  const [order, setOrder] = useState<number[]>(() => puzzle.blocks.map((_, i) => i))
  const [dragState, setDragState] = useState<DragState | null>(null)
  // Captured once, at the moment "Check order" is pressed — committedPayload
  // can't carry the final arrangement (choiceIndex is null for drag-order:
  // correctness is holistic across the whole order, not a single index, see
  // CommitPayload's doc comment), so this is the local bookkeeping the
  // locked view below reads from, filling the role committedPayload.choiceIndex
  // plays for TapLine/Mcq.
  const [finalOrder, setFinalOrder] = useState<number[] | null>(null)

  const startClientYRef = useRef(0)
  const rowHeightRef = useRef(0)

  const locked = committed || finalOrder !== null

  const handlePointerDown = (blockIndex: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (locked) return
    setPointerCaptureIfSupported(event.currentTarget, event.pointerId)
    rowHeightRef.current = event.currentTarget.getBoundingClientRect().height
    startClientYRef.current = event.clientY
    setDragState({ blockIndex, offsetY: 0 })
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragState === null) return

    let offsetY = event.clientY - startClientYRef.current
    let position = order.indexOf(dragState.blockIndex)
    const nextOrder = [...order]

    // Loop rather than a single check: a fast pointermove can in principle
    // cross more than one neighbor's midpoint in a single event, and each
    // resolved swap must adjust offsetY by exactly one row-height (see
    // dragOrderReorder.ts's doc comment) before the next check runs.
    for (;;) {
      const target = resolveDragSwap({
        draggingPosition: position,
        offsetY,
        rowHeight: rowHeightRef.current,
        length: nextOrder.length,
      })
      if (target === null) break
      const delta = target - position
      const a = nextOrder[position]
      const b = nextOrder[target]
      if (a === undefined || b === undefined) break
      nextOrder[position] = b
      nextOrder[target] = a
      offsetY -= delta * rowHeightRef.current
      position = target
    }

    setOrder(nextOrder)
    setDragState({ blockIndex: dragState.blockIndex, offsetY })
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragState === null) return
    releasePointerCaptureIfSupported(event.currentTarget, event.pointerId)
    // order[] already holds the final arrangement from the live swaps above
    // — ending the drag just clears dragState, which drops the dragged row's
    // live offset back to 0 and (via the CSS transition on the now-plain
    // `.drag-order__row` class) animates it into its rest slot.
    setDragState(null)
  }

  const handleSubmit = () => {
    if (locked) return
    const correct = order.every(
      (blockIndex, position) => blockIndex === puzzle.correct_order[position],
    )
    setFinalOrder(order)
    onCommit({ correct, choiceIndex: null })
  }

  if (committed) {
    const resolvedOrder = finalOrder ?? order
    return (
      <div className="drag-order">
        <div className="drag-order__list drag-order__list--locked">
          {resolvedOrder.map((blockIndex, position) => {
            const state: AnswerState =
              puzzle.correct_order[position] === blockIndex ? 'correct' : 'wrong'
            return (
              <div
                key={blockIndex}
                className={`drag-order__row drag-order__row--locked drag-order__row--${state}`}
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
      <p className="drag-order__hint">Drag the blocks into the correct order.</p>
      <div className="drag-order__list">
        {puzzle.blocks.map((text, blockIndex) => {
          const position = order.indexOf(blockIndex)
          const isDragging = dragState?.blockIndex === blockIndex
          const translateY =
            (position - blockIndex) * rowHeightRef.current + (isDragging ? dragState.offsetY : 0)
          return (
            <div
              key={blockIndex}
              className={['drag-order__row', isDragging && 'drag-order__row--dragging']
                .filter(Boolean)
                .join(' ')}
              style={{
                transform: `translateY(${String(translateY)}px)`,
                touchAction: isDragging ? 'none' : undefined,
              }}
              onPointerDown={handlePointerDown(blockIndex)}
              onPointerMove={handlePointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
            >
              <span className="drag-order__row-badge" aria-hidden="true">
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
