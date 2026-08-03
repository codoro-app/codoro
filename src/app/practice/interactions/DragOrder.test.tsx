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
  // Identity order (0, 1, 2) is deliberately NOT correct — a swap between
  // the first two blocks is required, so tests can distinguish "submitted
  // without dragging" from "submitted after a real reorder".
  correct_order: [1, 0, 2],
}

const ROW_HEIGHT = 50

/** jsdom's getBoundingClientRect always returns all-zero geometry — this stands in for the real DOM measurement DragOrder.tsx does at pointerdown. */
function mockRowHeight() {
  return vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    height: ROW_HEIGHT,
    width: 300,
    top: 0,
    left: 0,
    right: 300,
    bottom: ROW_HEIGHT,
    x: 0,
    y: 0,
    toJSON: () => ({}),
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

/** Drags row 0 down past row 1's midpoint and releases — the one reorder gesture every drag test below needs. */
function dragFirstRowPastSecond(firstRow: Element) {
  fireEvent.pointerDown(firstRow, { pointerId: 1, clientY: 0 })
  // > rowHeight crosses the next row's center — see dragOrderReorder.test.ts
  // for the exact boundary this relies on.
  fireEvent.pointerMove(firstRow, { pointerId: 1, clientY: ROW_HEIGHT + 10 })
  fireEvent.pointerUp(firstRow, { pointerId: 1 })
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

  it('dragging the first row past the second swaps them, and submitting then commits correct: true', async () => {
    const rectSpy = mockRowHeight()
    const onCommit = vi.fn()
    const user = userEvent.setup()
    const { container } = render(<Harness onCommit={onCommit} />)

    dragFirstRowPastSecond(nth(Array.from(container.querySelectorAll('.drag-order__row')), 0))

    await user.click(screen.getByRole('button', { name: 'Check order' }))

    expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })

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
    const rectSpy = mockRowHeight()
    const user = userEvent.setup()
    const { container } = render(<Harness />)

    dragFirstRowPastSecond(nth(Array.from(container.querySelectorAll('.drag-order__row')), 0))
    await user.click(screen.getByRole('button', { name: 'Check order' }))

    const lockedRows = Array.from(container.querySelectorAll('.drag-order__row--locked'))
    expect(lockedRows).toHaveLength(3)
    // Submitted order after the swap is Block B, Block A, Block C — every
    // slot now matches correct_order [1, 0, 2], so every row reads correct.
    expect(nth(lockedRows, 0).textContent).toContain('Block B')
    expect(nth(lockedRows, 0).className).toContain('drag-order__row--correct')
    expect(nth(lockedRows, 1).textContent).toContain('Block A')
    expect(nth(lockedRows, 1).className).toContain('drag-order__row--correct')
    expect(nth(lockedRows, 2).textContent).toContain('Block C')
    expect(nth(lockedRows, 2).className).toContain('drag-order__row--correct')

    // No drag surface and no submit button once locked.
    expect(screen.queryByRole('button', { name: 'Check order' })).not.toBeInTheDocument()
    expect(container.querySelector('.drag-order__row--dragging')).toBeNull()

    rectSpy.mockRestore()
  })

  it('marks a still-wrong slot as wrong in the locked view when submitted without reordering', async () => {
    const user = userEvent.setup()
    const { container } = render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Check order' }))

    const lockedRows = Array.from(container.querySelectorAll('.drag-order__row--locked'))
    // Identity order (Block A, Block B, Block C) vs. correct_order [1, 0, 2]
    // (Block B, Block A, Block C): only the last slot matches.
    expect(nth(lockedRows, 0).className).toContain('drag-order__row--wrong')
    expect(nth(lockedRows, 1).className).toContain('drag-order__row--wrong')
    expect(nth(lockedRows, 2).className).toContain('drag-order__row--correct')
  })
})
