import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { InteractionBodyProps } from '../interactionTypes'
import type { DragOrderPuzzle } from '../../../content'
import type { AnswerState } from '../answerState'
import { GripIcon } from '../../Icons'
import {
  computeTranslateYs,
  identityOrder,
  resolveDragSwap,
  restCenterAt,
} from '../dragOrderReorder'
import type { RowLayout } from '../dragOrderReorder'
import { computeShrinkScale, DEFAULT_MIN_FONT_SCALE } from '../autoShrinkFontScale'

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
 * True when a pointerdown's actual target sits inside the row's
 * `.drag-order__handle` child — used to gate touch drags to the handle only
 * (see the component doc comment's two-layer hit-target model) while mouse
 * and pen can grab the row anywhere.
 */
function pointerDownIsOnHandle(event: ReactPointerEvent<HTMLDivElement>): boolean {
  return (
    event.currentTarget.querySelector('.drag-order__handle')?.contains(event.target as Node) ??
    false
  )
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

/**
 * Measures every row's own height (independent of its current position —
 * a row's height depends only on its own text and the row's fixed width,
 * never on where it sits in the list) plus the list's inter-row gap, read
 * straight from computed style rather than derived from two rows'
 * positions — robust regardless of any transform already applied to those
 * rows (a mid-reorder remeasure can't accidentally read a displaced row's
 * transformed position as if it were natural flow).
 */
function measureLayout(
  rowRefs: readonly (HTMLDivElement | null)[],
  listEl: HTMLDivElement | null,
): RowLayout {
  const heights = rowRefs.map((el) => el?.getBoundingClientRect().height ?? 0)
  const gap = listEl ? Number.parseFloat(getComputedStyle(listEl).rowGap) || 0 : 0
  return { heights, gap }
}

interface RowFontInfo {
  /** Shared across every row (`Math.min` of each row's own required scale) so all rows shrink together instead of drifting to different sizes — same shrink-to-fit behavior CodeSnippet.tsx/Scrubber.tsx use, applied per-row here since drag-order has no single container to measure. */
  scale: number
  /** Block indices whose own text still overflows at `scale` (i.e. their own required scale was below the shared floor) — only these rows get the scroll-fade affordance, not every row. */
  scrollableBlockIndices: ReadonlySet<number>
}

const DEFAULT_ROW_FONT_INFO: RowFontInfo = { scale: 1, scrollableBlockIndices: new Set() }

/**
 * Measures every row's own text width against its available width (mirrors
 * CodeSnippet.tsx's shrink-to-fit, generalized to N independent rows sharing
 * one font-size instead of one container). A row whose own required scale
 * would need MORE shrink than the group's floor allows keeps its own
 * scroll-fade affordance rather than forcing every other row to shrink past
 * what it needs.
 */
function measureRowFontScale(textRefs: readonly (HTMLSpanElement | null)[]): RowFontInfo {
  let scale = 1
  const scrollableBlockIndices = new Set<number>()
  textRefs.forEach((el, blockIndex) => {
    if (!el) return
    const result = computeShrinkScale(el.scrollWidth, el.clientWidth, DEFAULT_MIN_FONT_SCALE)
    scale = Math.min(scale, result.scale)
    if (result.scrollable) scrollableBlockIndices.add(blockIndex)
  })
  return { scale, scrollableBlockIndices }
}

/**
 * Native-Pointer-Events drag-to-reorder list — no gesture library dependency
 * (unlike SwipeBinary's `@use-gesture/react`; drag-order was deliberately
 * scoped to build on Pointer Events alone, see the Phase 5b Item 5 brief).
 *
 * Two-layer hit-target model: pointer handlers live on the row itself (so a
 * mouse or pen can grab the card anywhere), but a touch pointer only starts
 * a drag when it lands inside the `.drag-order__handle` child (>=44px, see
 * practice.css; gated in JS via `pointerDownIsOnHandle`, above) — touching
 * the rest of the row is left as native `pan-y` scroll. A browser decides
 * whether a touch starts a native scroll or a custom gesture at hit-test
 * time, before any JS handler runs, so the handle's `touch-action: none`
 * has to be a STATIC CSS property (never toggled at runtime — too late on a
 * real touchscreen) even though the JS gesture gate now also checks target.
 * Arrow-key reordering (below) covers players without a pointer; clicking,
 * tapping, or focusing a row also highlights it (`selected` state) so there
 * is always a visible cue for which block is about to move.
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
 * Rows are NOT uniform height (dragOrderReorder.ts's own doc comment) — a
 * `RowLayout` (each row's own measured height, plus the list's CSS gap) is
 * measured once per puzzle via a mount effect (`layoutRef`, below) rather
 * than lazily on first interaction, so it's already populated before any
 * pointer or keyboard input is even possible, and every transform/swap
 * calculation (`dragOrderReorder.ts`) works off real per-row heights
 * instead of a single shared constant.
 *
 * `order[i]` is the `puzzle.blocks` index currently occupying position `i`
 * — initialized as the identity permutation (blocks start in their
 * authored/display order, no extra runtime shuffling).
 */
export function DragOrder({ puzzle, committed, onCommit }: InteractionBodyProps<DragOrderPuzzle>) {
  const [order, setOrder] = useState<number[]>(() => identityOrder(puzzle.blocks.length))
  const [dragState, setDragState] = useState<DragState | null>(null)
  // The block last clicked, tapped, or focused — a persistent highlight,
  // since `:focus-visible` alone (browsers deliberately suppress it for
  // mouse/touch clicks) leaves pointer users with no selection cue at all.
  const [selected, setSelected] = useState<number | null>(null)
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
    setSelected(null)
  }

  const listRef = useRef<HTMLDivElement | null>(null)
  const rowRefs = useRef<(HTMLDivElement | null)[]>([])
  const textRefs = useRef<(HTMLSpanElement | null)[]>([])
  const [rowFontInfo, setRowFontInfo] = useState<RowFontInfo>(DEFAULT_ROW_FONT_INFO)
  const startClientYRef = useRef(0)
  const startCenterRef = useRef(0)
  const layoutRef = useRef<RowLayout | null>(null)
  // The pointerId of the single gesture currently owning `dragState`, or
  // null between drags — a second finger touching down mid-drag must not
  // hijack or interleave with the first's move/up events (a bare
  // `dragState === null` check alone can't tell the two pointers apart).
  const activePointerIdRef = useRef<number | null>(null)

  // Measured once per puzzle (blocks are static per id — no reason to
  // remeasure on every render), after the puzzle's own rows have painted,
  // so it's ready before a human could possibly drag or press a key. Writing
  // a ref during render (rather than here) trips react-hooks/refs, so the
  // active-gesture ref is also reset in this effect, not the render-phase
  // puzzle-id-change block above.
  useEffect(() => {
    layoutRef.current = measureLayout(rowRefs.current, listRef.current)
    activePointerIdRef.current = null
  }, [puzzle.id])

  // Separate from the layout effect above: re-measured on `committed` too,
  // not just `puzzle.id` — the locked view (below) renders a different set
  // of row-text spans (a numbered badge instead of the drag handle to their
  // left), which can leave a different amount of width for the text, so the
  // shared scale computed for the interactive view isn't guaranteed to still
  // be correct once the locked view mounts. Re-measures on resize too (same
  // ResizeObserver-guarded-for-jsdom pattern as useAutoShrinkFontScale),
  // since drag-order doesn't route through that shared hook (one scale
  // spans N independent row elements here, not one container).
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return

    const measure = () => {
      // Reset to the unscaled baseline before measuring, imperatively —
      // the CSS var lives on `el` (the list) and cascades down to every
      // `.drag-order__row-text` span being measured, so without this a
      // re-measure (e.g. on resize) would read scrollWidth against
      // already-shrunk text and compound the previous shrink instead of
      // computing a fresh scale from the real content width every time.
      // Same reasoning as useAutoShrinkFontScale's own reset-before-measure
      // step; done imperatively here (not just via the state set below)
      // because the state update that would otherwise reset it hasn't
      // committed to the DOM yet at the point this function reads
      // scrollWidth.
      el.style.setProperty('--drag-order-font-scale', '1')
      const info = measureRowFontScale(textRefs.current)
      el.style.setProperty('--drag-order-font-scale', String(info.scale))
      setRowFontInfo(info)
    }

    measure()

    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => {
      observer.disconnect()
    }
  }, [puzzle.id, committed])

  const locked = committed || submitted

  const handlePointerDown = (blockIndex: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (locked) return
    // Selecting happens before either guard below, so a touch tap on the
    // row body still highlights the block even though it won't start a
    // drag (see the component doc comment's two-layer hit-target model).
    setSelected(blockIndex)
    if (activePointerIdRef.current !== null) return
    if (event.pointerType === 'touch' && !pointerDownIsOnHandle(event)) return

    // Remeasured fresh at drag start (not just once on mount) so a stale
    // font-load/resize measurement can never corrupt a drag that starts
    // later — cheap, and transforms don't affect layout height.
    const layout = measureLayout(rowRefs.current, listRef.current)
    layoutRef.current = layout

    activePointerIdRef.current = event.pointerId
    setPointerCaptureIfSupported(event.currentTarget, event.pointerId)
    const position = order.indexOf(blockIndex)
    startCenterRef.current = restCenterAt(order, layout, position)
    startClientYRef.current = event.clientY
    setDragState({ blockIndex, offsetY: 0 })
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragState === null || event.pointerId !== activePointerIdRef.current) return
    const layout = layoutRef.current
    if (!layout) return

    // Track the dragged row's live absolute center directly (its rest
    // center at gesture start, plus total pointer movement since) rather
    // than adjusting a relative offset after each swap — with non-uniform
    // row heights, "subtract one row-height per swap" (this module's first
    // version) doesn't generalize, since each neighbor can contribute a
    // different height.
    const liveCenter = startCenterRef.current + (event.clientY - startClientYRef.current)
    let position = order.indexOf(dragState.blockIndex)
    let nextOrder = order

    // Loop rather than a single check: a fast pointermove can in principle
    // cross more than one neighbor's center in a single event.
    for (;;) {
      const target = resolveDragSwap({
        order: nextOrder,
        draggingPosition: position,
        liveCenter,
        layout,
      })
      if (target === null) break
      nextOrder = swapPositions(nextOrder, position, target)
      position = target
    }

    if (nextOrder !== order) setOrder(nextOrder)
    const restCenter = restCenterAt(nextOrder, layout, position)
    setDragState({ blockIndex: dragState.blockIndex, offsetY: liveCenter - restCenter })
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragState === null || event.pointerId !== activePointerIdRef.current) return
    releasePointerCaptureIfSupported(event.currentTarget, event.pointerId)
    activePointerIdRef.current = null
    // order[] already holds the final arrangement from the live swaps above
    // — ending the drag just clears dragState, which drops the dragged row's
    // live offset back to 0 and (via the CSS transition on the now-plain
    // `.drag-order__row` class) animates it into its rest slot.
    setDragState(null)
  }

  /**
   * A capture the row never releases itself (e.g. the browser reassigns it
   * mid-gesture) would otherwise leave the row stuck "lifted" forever, since
   * no pointerup would ever arrive to call `endDrag`. Only clears state —
   * does NOT call `releasePointerCaptureIfSupported`, since releasing a
   * capture that's already gone throws `NotFoundError` in real browsers.
   */
  const handleLostPointerCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== activePointerIdRef.current) return
    activePointerIdRef.current = null
    setDragState(null)
  }

  const handleRowFocus = (blockIndex: number) => () => {
    if (locked) return
    setSelected(blockIndex)
  }

  /** Non-pointer fallback: moves `blockIndex`'s row one slot toward `direction`, swapping with whichever neighbor is there. Same swap logic the drag gesture uses, just a single discrete step per keypress instead of a continuous midpoint check. Needs no layout of its own — the render below reads `layoutRef.current` (already populated by the mount effect) to compute the resulting transform. */
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

  // Shared by both branches below — a block's own text keeps the scroll-fade
  // affordance only when ITS required scale is still below the shared floor
  // at the group's shared scale (see measureRowFontScale's doc comment); the
  // CSS var itself is shared by every row via the list container it cascades
  // down from.
  const rowTextClassName = (blockIndex: number) =>
    [
      'drag-order__row-text',
      rowFontInfo.scrollableBlockIndices.has(blockIndex) && 'drag-order__row-text--scrollable',
    ]
      .filter(Boolean)
      .join(' ')
  const listStyle = { '--drag-order-font-scale': rowFontInfo.scale } as CSSProperties

  if (committed) {
    return (
      <div className="drag-order">
        <div
          ref={listRef}
          className="drag-order__list drag-order__list--locked"
          role="list"
          style={listStyle}
        >
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
                <span
                  className={rowTextClassName(blockIndex)}
                  ref={(el) => {
                    textRefs.current[blockIndex] = el
                  }}
                >
                  {puzzle.blocks[blockIndex]}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  const translateYs = layoutRef.current
    ? computeTranslateYs(order, layoutRef.current)
    : order.map(() => 0)

  return (
    <div className="drag-order">
      <p className="drag-order__hint">
        Drag the blocks into the correct order (or focus a block and use the up/down arrow keys).
      </p>
      <div className="drag-order__list" role="list" ref={listRef} style={listStyle}>
        {puzzle.blocks.map((text, blockIndex) => {
          const position = order.indexOf(blockIndex)
          const isDragging = dragState?.blockIndex === blockIndex
          const isSelected = selected === blockIndex
          const translateY = (translateYs[blockIndex] ?? 0) + (isDragging ? dragState.offsetY : 0)
          return (
            <div
              key={blockIndex}
              ref={(el) => {
                rowRefs.current[blockIndex] = el
              }}
              className={[
                'drag-order__row',
                isSelected && 'drag-order__row--selected',
                isDragging && 'drag-order__row--dragging',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ transform: `translateY(${String(translateY)}px)` }}
              role="listitem"
              tabIndex={0}
              aria-label={`${text}, position ${String(position + 1)} of ${String(puzzle.blocks.length)}. Use the up and down arrow keys to reorder.`}
              onKeyDown={handleRowKeyDown(blockIndex)}
              onFocus={handleRowFocus(blockIndex)}
              onPointerDown={handlePointerDown(blockIndex)}
              onPointerMove={handlePointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onLostPointerCapture={handleLostPointerCapture}
            >
              <span className="drag-order__handle" aria-hidden="true">
                <GripIcon size={24} />
              </span>
              <span
                className={rowTextClassName(blockIndex)}
                ref={(el) => {
                  textRefs.current[blockIndex] = el
                }}
              >
                {text}
              </span>
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
