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
 * jsdom never lays out or applies transforms, so `getBoundingClientRect`
 * on its own tells DragOrder.tsx nothing — `measureSlotPitch` needs two
 * rows' real top-to-top distance (dragOrderReorder.ts's `resolveSlotPitch`).
 * This derives a row's mocked `top` from its DOM position among siblings
 * (rows render in fixed blockIndex order, per the component's own doc
 * comment) times a uniform pitch, which is what a real browser's layout +
 * `transform: translateY(...)` would converge to for the single,
 * from-identity drag every test below performs.
 */
function mockRowGeometry(pitch = SLOT_PITCH) {
  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    const parent = this.parentElement
    const domIndex = parent ? Array.from(parent.children).indexOf(this) : 0
    const top = domIndex * pitch
    return {
      top,
      height: pitch,
      bottom: top + pitch,
      left: 0,
      right: 300,
      width: 300,
      x: 0,
      y: top,
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
 * fire on `.drag-order__handle` (the dedicated drag hit target), not the
 * row itself — DragOrder.tsx attaches the pointer handlers there, not to
 * the row div, so the row is no longer a valid dispatch target.
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
})
