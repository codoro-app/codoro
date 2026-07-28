import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import type { SwipeBinaryPuzzle } from '../../../content'
import type { CommitPayload } from '../interactionTypes'
import { SwipeBinary } from './SwipeBinary'

/**
 * `@use-gesture/react`'s `useDrag` binds real pointer/touch event listeners
 * that RTL's fireEvent/userEvent can't realistically drive in jsdom (no
 * real pointer capture, no coalesced pointermove sequence). Per the brief,
 * we mock `useDrag` to capture the handler SwipeBinary registers, then
 * invoke it directly with a constructed drag-gesture state — this tests
 * the real production wiring (SwipeBinary's own drag-end handler, calling
 * the real `resolveSwipeCommit`), just without a real gesture library
 * driving it end-to-end.
 */
interface DragState {
  down: boolean
  last: boolean
  movement: [number, number]
  velocity: [number, number]
  direction: [number, number]
  elapsedTime: number
  cancel: () => void
}
type DragHandler = (state: DragState) => void

const gestureMock = vi.hoisted(() => ({
  handler: null as DragHandler | null,
  config: null as Record<string, unknown> | null,
}))

vi.mock('@use-gesture/react', () => ({
  useDrag: (handler: DragHandler, config: Record<string, unknown>) => {
    gestureMock.handler = handler
    gestureMock.config = config
    return () => ({})
  },
}))

// elapsedTime defaults to a normal, unhurried ~350ms drag — real enough that
// the elapsedTime-driven commit path (SwipeBinary now derives velocity from
// movement/elapsedTime, not the mocked velocity/direction fields) exercises
// realistic numbers unless a test overrides it.
function fireDragEnd(overrides: Partial<DragState>) {
  const state: DragState = {
    down: false,
    last: true,
    movement: [0, 0],
    velocity: [0, 0],
    direction: [0, 0],
    elapsedTime: 350,
    cancel: vi.fn(),
    ...overrides,
  }
  if (!gestureMock.handler) throw new Error('SwipeBinary never registered a drag handler')
  gestureMock.handler(state)
}

const puzzle: SwipeBinaryPuzzle = {
  id: 'con-001',
  pattern: 'concurrency',
  difficulty_rating: 2000,
  explanation: 'count++ is not atomic.',
  prompt: 'Is this safe?',
  language: 'java',
  snippet: 'count++;',
  interaction: 'swipe-binary',
  left_label: 'Thread-safe',
  right_label: 'Race condition',
  correct_direction: 'right',
}

function Harness({ onCommit }: { onCommit?: (p: CommitPayload) => void }) {
  const [committed, setCommitted] = useState(false)
  const [payload, setPayload] = useState<CommitPayload | undefined>(undefined)
  return (
    <SwipeBinary
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

describe('SwipeBinary', () => {
  it('renders the left/right labels as two buttons', () => {
    render(<Harness />)
    expect(screen.getByRole('button', { name: 'Thread-safe' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Race condition' })).toBeInTheDocument()
  })

  it('commits correct: true, choiceIndex: null when the correct side is tapped', async () => {
    const onCommit = vi.fn()
    const user = userEvent.setup()
    render(<Harness onCommit={onCommit} />)

    await user.click(screen.getByRole('button', { name: 'Race condition' }))

    expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })
  })

  it('commits correct: false when the wrong side is tapped', async () => {
    const onCommit = vi.fn()
    const user = userEvent.setup()
    render(<Harness onCommit={onCommit} />)

    await user.click(screen.getByRole('button', { name: 'Thread-safe' }))

    expect(onCommit).toHaveBeenCalledWith({ correct: false, choiceIndex: null })
  })

  it('marks the wrongly-chosen side red and reveals the correct side green', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Thread-safe' }))

    expect(screen.getByRole('button', { name: 'Thread-safe' }).className).toContain('wrong')
    expect(screen.getByRole('button', { name: 'Race condition' }).className).toContain(
      'reveal-correct',
    )
  })

  it('marks the correctly-chosen side green with no separate reveal', async () => {
    const user = userEvent.setup()
    render(<Harness />)

    await user.click(screen.getByRole('button', { name: 'Race condition' }))

    expect(screen.getByRole('button', { name: 'Race condition' }).className).toContain('correct')
    expect(screen.getByRole('button', { name: 'Thread-safe' }).className).not.toContain(
      'reveal-correct',
    )
  })

  it('disables both buttons once committed', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('button', { name: 'Race condition' }))

    expect(screen.getByRole('button', { name: 'Race condition' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Thread-safe' })).toBeDisabled()
  })

  describe('drag gesture', () => {
    it('calls onCommit with the correct direction when a drag ends past both thresholds', () => {
      const onCommit = vi.fn()
      render(<Harness onCommit={onCommit} />)

      // A deliberate rightward drag: 180px in 350ms is well past minDistance
      // (120px) and minVelocity (0.3px/ms, since 180/350 ≈ 0.51). correct_direction
      // is 'right' for this puzzle, so this should commit correct: true.
      fireDragEnd({ movement: [180, 0], elapsedTime: 350 })

      expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })
    })

    it('calls onCommit with correct: false for a deliberate drag in the wrong direction', () => {
      const onCommit = vi.fn()
      render(<Harness onCommit={onCommit} />)

      // correct_direction is 'right', so a deliberate leftward drag is the
      // wrong pick.
      fireDragEnd({ movement: [-180, 0], elapsedTime: 350 })

      expect(onCommit).toHaveBeenCalledWith({ correct: false, choiceIndex: null })
    })

    it('does NOT call onCommit for a drag below both thresholds', () => {
      const onCommit = vi.fn()
      render(<Harness onCommit={onCommit} />)

      // A lazy half-drag: 40px in 350ms is below both minDistance (120) and
      // minVelocity (40/350 ≈ 0.11, below 0.3).
      fireDragEnd({ movement: [40, 0], elapsedTime: 350 })

      expect(onCommit).not.toHaveBeenCalled()
    })

    it('does NOT call onCommit for a short, high-velocity accidental flick', () => {
      const onCommit = vi.fn()
      render(<Harness onCommit={onCommit} />)

      // 15px in 15ms is a genuinely high average velocity (1.0 px/ms, well
      // past minVelocity) but far short of minDistance (120) — exactly the
      // failure mode minDistance exists to reject: a brief, fast, accidental
      // touch-drag of a few pixels.
      fireDragEnd({ movement: [15, 0], elapsedTime: 15 })

      expect(onCommit).not.toHaveBeenCalled()
    })

    it(
      'commits a deliberate full-distance swipe even when the underlying gesture ' +
        "library's own last-frame velocity/direction have collapsed to 0 " +
        '(regression: finger pausing before release used to silently drop the gesture)',
      () => {
        const onCommit = vi.fn()
        render(<Harness onCommit={onCommit} />)

        // Reproduces the confirmed real-hardware bug: @use-gesture/core only
        // recomputes its own last-frame `velocity`/`direction` from the delta
        // since the previous frame when the gap before release exceeds an
        // internal 32ms threshold — a finger that pauses before lifting off
        // (common) makes that final delta ~0, collapsing both to 0 regardless
        // of how the overall gesture went. `velocity`/`direction` below stand
        // in for that collapse; SwipeBinary must derive its own velocity from
        // `movement`/`elapsedTime` instead of trusting these two fields, so
        // this must still commit correctly.
        fireDragEnd({ movement: [180, 0], velocity: [0, 0], direction: [0, 0], elapsedTime: 350 })

        expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })
      },
    )

    it('ignores intermediate (down: true) drag frames — only the final frame can commit', () => {
      const onCommit = vi.fn()
      render(<Harness onCommit={onCommit} />)

      // Mid-drag frame, still held down, even though it's already past both
      // thresholds — must not commit until the gesture actually ends.
      fireDragEnd({
        down: true,
        last: false,
        movement: [180, 0],
        velocity: [0.6, 0],
        direction: [1, 0],
      })

      expect(onCommit).not.toHaveBeenCalled()
    })

    it('a subsequent button click still commits directly once a below-threshold drag has sprung back', async () => {
      const onCommit = vi.fn()
      const user = userEvent.setup()
      render(<Harness onCommit={onCommit} />)

      fireDragEnd({ movement: [40, 0], velocity: [0.05, 0], direction: [1, 0] })
      expect(onCommit).not.toHaveBeenCalled()

      await user.click(screen.getByRole('button', { name: 'Race condition' }))
      expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })
    })

    it('cancels the drag gesture once committed, rather than resolving it', async () => {
      const user = userEvent.setup()
      render(<Harness />)
      await user.click(screen.getByRole('button', { name: 'Race condition' }))

      const cancel = vi.fn()
      fireDragEnd({ movement: [180, 0], velocity: [0.6, 0], direction: [1, 0], cancel })

      expect(cancel).toHaveBeenCalled()
    })
  })

  describe('touch axis-lock tolerance', () => {
    it('gives touch input a non-zero axisThreshold', () => {
      // @use-gesture/core's DragEngine defaults axisThreshold to
      // { mouse: 0, touch: 0, pen: 8 } — zero tolerance for touch means the
      // first touchmove sample permanently locks the gesture's axis, and on
      // real touchscreens that sample very often has a slightly larger
      // vertical component than horizontal (natural finger jitter), locking
      // axis to 'y' and silently dropping the whole swipe (the callback
      // never fires again for that gesture, not even at pointerup — see
      // Engine.ts's `_blocked` emit-skip). This can't be reproduced through
      // the mocked `useDrag` handler above (it bypasses the real axis-lock
      // engine entirely), so this test instead locks in the actual config
      // SwipeBinary passes, preventing a future edit from silently
      // reverting to the dangerous zero-tolerance default.
      render(<Harness />)
      const config = gestureMock.config as { axisThreshold?: { touch?: number } } | null
      expect(config?.axisThreshold?.touch).toBeGreaterThan(0)
    })
  })
})
