import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { DragOrder } from './DragOrder'
import type { DragOrderPuzzle } from '../../../content'
import type { CommitPayload } from '../interactionTypes'
import { nth } from '../../../test/nth'

const puzzle: DragOrderPuzzle = {
  id: 'rec-900',
  pattern: 'recursion-termination',
  difficulty_rating: 1200,
  explanation: 'The base case has to be checked before the function recurses any further.',
  prompt: 'Drag the steps into the order they execute.',
  language: 'javascript',
  snippet: '// unused for drag-order',
  interaction: 'drag-order',
  blocks: ['Block A', 'Block B', 'Block C'],
  // A 3-cycle, not a transposition: applying it twice does NOT return the
  // identity ([1, 0, 2] would — swapping two elements is its own inverse,
  // so a test built on it can't distinguish "correct_order applied
  // forward" from "applied backward"). [2, 0, 1] can only be reached one
  // way, so a bug that read the permutation inverted would show up here.
  correct_order: [2, 0, 1],
}

const SLOT_PITCH = 50

/**
 * jsdom never lays out, so `getBoundingClientRect` on its own tells
 * DragOrder.tsx nothing — `measureLayout` (DragOrder.tsx) reads each row's
 * own `.height` (never `.top`; the list's gap comes from `getComputedStyle`
 * instead, which jsdom has no stylesheet to resolve, so it falls back to 0
 * here — covered separately, and thoroughly, by dragOrderReorder.test.ts's
 * pure-math gap tests). `heights` is indexed by DOM position, i.e. block
 * index (rows render in fixed blockIndex order, per the component's own
 * doc comment) — defaulting every row to the same `SLOT_PITCH` reproduces
 * this file's original uniform-height fixture; passing distinct values per
 * test exercises the actual bug this model was rewritten to fix (real
 * blocks wrap to different heights, see dragOrderReorder.ts's own doc
 * comment).
 */
function mockRowGeometry(heights: readonly number[] = [SLOT_PITCH, SLOT_PITCH, SLOT_PITCH]) {
  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const parent = this.parentElement
    const domIndex = parent ? Array.from(parent.children).indexOf(this) : 0
    const height = heights[domIndex] ?? SLOT_PITCH
    return {
      top: 0,
      height,
      bottom: height,
      left: 0,
      right: 300,
      width: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }
  })
}

function Harness({ onCommit }: { onCommit?: (p: CommitPayload) => void }) {
  const [committed, setCommitted] = useState(false)
  const [payload, setPayload] = useState<CommitPayload | undefined>(undefined)
  return (
    <DragOrder
      puzzle={puzzle}
      committed={committed}
      committedPayload={payload}
      onCommit={(p) => {
        setCommitted(true)
        setPayload(p)
        onCommit?.(p)
      }}
    />
  )
}

/**
 * Drags Block C's row (blockIndex 2, starts at position 2) up past both
 * neighbors' midpoints in one continuous move and releases, landing order
 * at [2, 0, 1] — matching `puzzle.correct_order` exactly. Pointer events
 * fire on `.drag-order__handle`; DragOrder.tsx's pointer handlers live on
 * the row div (whole-card drag on desktop), but pointerdown/move/up all
 * bubble from the handle up to the row, so firing on the handle still
 * reaches them and doubles as coverage that the handle remains a valid
 * drag target.
 */
function dragBlockCToFront(container: HTMLElement) {
  const handles = Array.from(container.querySelectorAll('.drag-order__handle'))
  const blockCHandle = nth(handles, 2)
  fireEvent.pointerDown(blockCHandle, { pointerId: 1, clientY: 0 })
  // < -(2 * slotPitch) crosses both neighbors' centers in one move — see
  // dragOrderReorder.test.ts for the single-swap boundary this builds on.
  fireEvent.pointerMove(blockCHandle, { pointerId: 1, clientY: -(2 * SLOT_PITCH + 10) })
  fireEvent.pointerUp(blockCHandle, { pointerId: 1 })
}

/** Same drag as `dragBlockCToFront`, but dispatched on the row body (not the handle) — the whole-card desktop drag surface. */
function dragBlockCToFrontViaRow(container: HTMLElement) {
  const rows = Array.from(container.querySelectorAll('.drag-order__row'))
  const blockCRow = nth(rows, 2)
  fireEvent.pointerDown(blockCRow, { pointerId: 1, clientY: 0 })
  fireEvent.pointerMove(blockCRow, { pointerId: 1, clientY: -(2 * SLOT_PITCH + 10) })
  fireEvent.pointerUp(blockCRow, { pointerId: 1 })
}

describe('DragOrder', () => {
  it('renders one row per block, in authored display order — no runtime shuffling on mount', () => {
    const { container } = render(<Harness />)
    const rows = container.querySelectorAll('.drag-order__row')
    expect(rows).toHaveLength(3)
    expect(nth(Array.from(rows), 0).textContent).toContain('Block A')
    expect(nth(Array.from(rows), 1).textContent).toContain('Block B')
    expect(nth(Array.from(rows), 2).textContent).toContain('Block C')
  })

  it('commits correct: false, choiceIndex: null when submitted without reordering', async () => {
    const onCommit = vi.fn()
    const user = userEvent.setup()
    render(<Harness onCommit={onCommit} />)

    await user.click(screen.getByRole('button', { name: 'Check order' }))

    expect(onCommit).toHaveBeenCalledWith({ correct: false, choiceIndex: null })
  })

  it('dragging Block C to the front matches correct_order and commits correct: true', async () => {
    const rectSpy = mockRowGeometry()
    const onCommit = vi.fn()
    const user = userEvent.setup()
    const { container } = render(<Harness onCommit={onCommit} />)

    dragBlockCToFront(container)

    await user.click(screen.getByRole('button', { name: 'Check order' }))

    expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })

    rectSpy.mockRestore()
  })

  it('keeps rows in fixed DOM order (by blockIndex) after a drag — only their transform moves', () => {
    const rectSpy = mockRowGeometry()
    const { container } = render(<Harness />)

    dragBlockCToFront(container)

    const rows = Array.from(container.querySelectorAll('.drag-order__row'))
    expect(nth(rows, 0).textContent).toContain('Block A')
    expect(nth(rows, 1).textContent).toContain('Block B')
    expect(nth(rows, 2).textContent).toContain('Block C')

    rectSpy.mockRestore()
  })

  it('calls onCommit exactly once and swaps to the locked view (no submit button left to re-click)', async () => {
    const onCommit = vi.fn()
    const user = userEvent.setup()
    render(<Harness onCommit={onCommit} />)

    await user.click(screen.getByRole('button', { name: 'Check order' }))
    expect(onCommit).toHaveBeenCalledTimes(1)
    // DragOrder hides (rather than disables) the submit button once
    // committed — the whole interactive view is replaced by the locked,
    // read-only one, so there is nothing left to re-click.
    expect(screen.queryByRole('button', { name: 'Check order' })).not.toBeInTheDocument()
  })

  it('renders a locked, read-only view after commit, marking each slot correct/wrong', async () => {
    const rectSpy = mockRowGeometry()
    const user = userEvent.setup()
    const { container } = render(<Harness />)

    dragBlockCToFront(container)
    await user.click(screen.getByRole('button', { name: 'Check order' }))

    const lockedRows = Array.from(container.querySelectorAll('.drag-order__row--locked'))
    expect(lockedRows).toHaveLength(3)
    // Submitted order after the drag is Block C, Block A, Block B — every
    // slot now matches correct_order [2, 0, 1], so every row reads correct.
    expect(nth(lockedRows, 0).textContent).toContain('Block C')
    expect(nth(lockedRows, 0).className).toContain('drag-order__row--correct')
    expect(nth(lockedRows, 1).textContent).toContain('Block A')
    expect(nth(lockedRows, 1).className).toContain('drag-order__row--correct')
    expect(nth(lockedRows, 2).textContent).toContain('Block B')
    expect(nth(lockedRows, 2).className).toContain('drag-order__row--correct')

    // No drag surface and no submit button once locked.
    expect(screen.queryByRole('button', { name: 'Check order' })).not.toBeInTheDocument()
    expect(container.querySelector('.drag-order__row--dragging')).toBeNull()

    rectSpy.mockRestore()
  })

  it('marks every slot wrong in the locked view when submitted without reordering', async () => {
    const user = userEvent.setup()
    const { container } = render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Check order' }))

    const lockedRows = Array.from(container.querySelectorAll('.drag-order__row--locked'))
    // Identity order (Block A, Block B, Block C) vs. correct_order [2, 0, 1]
    // (Block C, Block A, Block B): a 3-cycle has no fixed point, so nothing
    // in the untouched identity order matches.
    expect(nth(lockedRows, 0).className).toContain('drag-order__row--wrong')
    expect(nth(lockedRows, 1).className).toContain('drag-order__row--wrong')
    expect(nth(lockedRows, 2).className).toContain('drag-order__row--wrong')
  })

  it('swaps at the correct threshold when rows are NOT uniform height — the actual real-device bug this model was rewritten to fix', async () => {
    // Block A wraps to two lines (100px); Block B and Block C stay one
    // line (40px) — exactly the "some blocks wrap, some don't" shape real
    // content has (rec-009.json's blocks range ~31-47 characters under
    // `white-space: pre-wrap`). A shared "row height" model (this file's
    // first version) would use Block A's 100px for every row's pitch,
    // putting Block B's swap threshold 30px further down than its real
    // (40px-tall) center — visibly wrong on any device where blocks
    // actually differ in height.
    const rectSpy = mockRowGeometry([100, 40, 40])
    const user = userEvent.setup()
    const { container } = render(<Harness />)

    const handles = Array.from(container.querySelectorAll('.drag-order__handle'))
    const blockAHandle = nth(handles, 0)
    // Rest centers, per dragOrderReorder.test.ts's own math (gap 0): Block
    // A at 50 (0 + 100/2), Block B at 120 (100 + 40/2). Crossing Block B's
    // center requires offsetY > 70; 80 crosses it without also reaching
    // Block C's center (160).
    fireEvent.pointerDown(blockAHandle, { pointerId: 1, clientY: 0 })
    fireEvent.pointerMove(blockAHandle, { pointerId: 1, clientY: 80 })
    fireEvent.pointerUp(blockAHandle, { pointerId: 1 })

    await user.click(screen.getByRole('button', { name: 'Check order' }))

    const lockedRows = Array.from(container.querySelectorAll('.drag-order__row--locked'))
    expect(nth(lockedRows, 0).textContent).toContain('Block B')
    expect(nth(lockedRows, 1).textContent).toContain('Block A')
    expect(nth(lockedRows, 2).textContent).toContain('Block C')

    rectSpy.mockRestore()
  })

  it('highlights a row on click-select, and moves the highlight when another row is pressed', () => {
    const { container } = render(<Harness />)
    const rows = Array.from(container.querySelectorAll('.drag-order__row'))

    fireEvent.pointerDown(nth(rows, 0), { pointerId: 1, clientY: 0 })
    fireEvent.pointerUp(nth(rows, 0), { pointerId: 1 })
    expect(nth(rows, 0).className).toContain('drag-order__row--selected')
    expect(nth(rows, 0).className).not.toContain('drag-order__row--dragging')

    fireEvent.pointerDown(nth(rows, 1), { pointerId: 2, clientY: 0 })
    fireEvent.pointerUp(nth(rows, 1), { pointerId: 2 })
    expect(nth(rows, 1).className).toContain('drag-order__row--selected')
    expect(nth(rows, 0).className).not.toContain('drag-order__row--selected')
  })

  it('drags by the whole card body (not just the handle) with a mouse', async () => {
    const rectSpy = mockRowGeometry()
    const onCommit = vi.fn()
    const user = userEvent.setup()
    const { container } = render(<Harness onCommit={onCommit} />)

    dragBlockCToFrontViaRow(container)

    await user.click(screen.getByRole('button', { name: 'Check order' }))

    expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })

    rectSpy.mockRestore()
  })

  it('does not start a drag from a touch on the row body — only the handle is a touch drag target', async () => {
    const rectSpy = mockRowGeometry()
    const user = userEvent.setup()
    const { container } = render(<Harness />)
    const rows = Array.from(container.querySelectorAll('.drag-order__row'))
    const blockCText = nth(rows, 2).querySelector('.drag-order__row-text')
    if (!blockCText) throw new Error('missing .drag-order__row-text')

    fireEvent.pointerDown(blockCText, { pointerId: 1, clientY: 0, pointerType: 'touch' })
    expect(nth(rows, 2).className).toContain('drag-order__row--selected')
    expect(nth(rows, 2).className).not.toContain('drag-order__row--dragging')

    fireEvent.pointerMove(blockCText, {
      pointerId: 1,
      clientY: -(2 * SLOT_PITCH + 10),
      pointerType: 'touch',
    })
    expect(nth(rows, 2).className).not.toContain('drag-order__row--dragging')
    fireEvent.pointerUp(blockCText, { pointerId: 1, pointerType: 'touch' })

    await user.click(screen.getByRole('button', { name: 'Check order' }))
    const lockedRows = Array.from(container.querySelectorAll('.drag-order__row--locked'))
    // Untouched identity order — every slot still reads wrong against [2, 0, 1].
    expect(nth(lockedRows, 0).className).toContain('drag-order__row--wrong')
    expect(nth(lockedRows, 1).className).toContain('drag-order__row--wrong')
    expect(nth(lockedRows, 2).className).toContain('drag-order__row--wrong')

    rectSpy.mockRestore()
  })

  it('still drags from the handle with a touch pointer', async () => {
    const rectSpy = mockRowGeometry()
    const onCommit = vi.fn()
    const user = userEvent.setup()
    const { container } = render(<Harness onCommit={onCommit} />)
    const handles = Array.from(container.querySelectorAll('.drag-order__handle'))
    const blockCHandle = nth(handles, 2)

    fireEvent.pointerDown(blockCHandle, { pointerId: 1, clientY: 0, pointerType: 'touch' })
    fireEvent.pointerMove(blockCHandle, {
      pointerId: 1,
      clientY: -(2 * SLOT_PITCH + 10),
      pointerType: 'touch',
    })
    fireEvent.pointerUp(blockCHandle, { pointerId: 1, pointerType: 'touch' })

    await user.click(screen.getByRole('button', { name: 'Check order' }))

    expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })

    rectSpy.mockRestore()
  })

  it('ignores a second simultaneous pointer while a drag is already in progress', async () => {
    const rectSpy = mockRowGeometry()
    const onCommit = vi.fn()
    const user = userEvent.setup()
    const { container } = render(<Harness onCommit={onCommit} />)
    const rows = Array.from(container.querySelectorAll('.drag-order__row'))

    // Pointer 1 starts dragging Block C.
    fireEvent.pointerDown(nth(rows, 2), { pointerId: 1, clientY: 0 })

    // Pointer 2 lands on Block A mid-gesture — must not hijack the drag.
    fireEvent.pointerDown(nth(rows, 0), { pointerId: 2, clientY: 0 })
    expect(nth(rows, 0).className).not.toContain('drag-order__row--dragging')
    fireEvent.pointerMove(nth(rows, 0), { pointerId: 2, clientY: -(2 * SLOT_PITCH + 10) })
    fireEvent.pointerUp(nth(rows, 0), { pointerId: 2 })

    // Pointer 1 completes normally.
    fireEvent.pointerMove(nth(rows, 2), { pointerId: 1, clientY: -(2 * SLOT_PITCH + 10) })
    fireEvent.pointerUp(nth(rows, 2), { pointerId: 1 })

    await user.click(screen.getByRole('button', { name: 'Check order' }))

    expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })

    rectSpy.mockRestore()
  })

  it('recovers from a lost pointer capture instead of leaving the row stuck mid-drag', () => {
    const rectSpy = mockRowGeometry()
    const { container } = render(<Harness />)
    const rows = Array.from(container.querySelectorAll('.drag-order__row'))
    const blockCRow = nth(rows, 2)

    fireEvent.pointerDown(blockCRow, { pointerId: 1, clientY: 0 })
    fireEvent.pointerMove(blockCRow, { pointerId: 1, clientY: -(SLOT_PITCH + 10) })
    expect(blockCRow.className).toContain('drag-order__row--dragging')

    // A raw `dispatchEvent` bypasses RTL's `act()` wrapping, leaving the
    // resulting `setDragState(null)` unflushed when the assertion below
    // reads `className` — `fireEvent(el, event)` (the generic custom-event
    // form) dispatches the same event but wrapped in `act()`.
    fireEvent(blockCRow, new PointerEvent('lostpointercapture', { pointerId: 1, bubbles: true }))
    expect(blockCRow.className).not.toContain('drag-order__row--dragging')

    // A late pointerup for the same gesture must be a no-op, not a crash.
    fireEvent.pointerUp(blockCRow, { pointerId: 1 })
    expect(blockCRow.className).not.toContain('drag-order__row--dragging')

    rectSpy.mockRestore()
  })

  it('selects a row on focus, and arrow-key reordering keeps the selection', () => {
    const { container } = render(<Harness />)
    const rows = Array.from(container.querySelectorAll('.drag-order__row'))
    const blockARow = nth(rows, 0)

    fireEvent.focus(blockARow)
    expect(blockARow.className).toContain('drag-order__row--selected')

    fireEvent.keyDown(blockARow, { key: 'ArrowDown' })

    expect(blockARow.className).toContain('drag-order__row--selected')
    expect(blockARow.getAttribute('aria-label')).toContain('position 2 of 3')
  })
})
