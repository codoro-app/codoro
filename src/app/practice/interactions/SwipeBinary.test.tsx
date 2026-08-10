import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEvent, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import type { SwipeBinaryPuzzle } from '../../../content'
import type { CommitPayload } from '../interactionTypes'
import { SwipeBinary } from './SwipeBinary'

/**
 * SwipeBinary's gesture plumbing is raw Pointer Events (v3 Phase 0, OD-1 —
 * see the component's own doc comment), so these tests drive it exactly the
 * way a browser would: real `fireEvent.pointer*` sequences with coordinates,
 * mirroring DragOrder.test.tsx's style. The previous version of this file
 * mocked `@use-gesture/react`'s `useDrag` and called the captured handler
 * with hand-built `DragState` objects; that could never exercise the axis
 * arbitration or scroll-yield behavior OD-1 lives in, which is a large part
 * of why five fix rounds shipped against tests that stayed green.
 *
 * Timing: the component measures `elapsedTime` with `performance.now()` (see
 * its "Timing source" doc note — `event.timeStamp` is read-only and not
 * settable through `fireEvent`), so a stubbed clock is the mechanism here.
 */
let now = 0

function advanceClock(ms: number) {
  now += ms
}

function installMockClock() {
  beforeEach(() => {
    now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })
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
  correct_verdict: 'bug',
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

function getCard(container: HTMLElement): HTMLElement {
  const card = container.querySelector<HTMLElement>('.swipe-fallback__card')
  if (!card) throw new Error('missing .swipe-fallback__card')
  return card
}

const POINTER_ID = 7

function pointerDown(card: HTMLElement, x: number, y: number) {
  fireEvent.pointerDown(card, {
    pointerId: POINTER_ID,
    pointerType: 'touch',
    clientX: x,
    clientY: y,
  })
}

/**
 * Dispatches one pointermove and returns the native event, so a test can
 * read `defaultPrevented` — the direct observable for "did the component
 * claim this gesture away from native scrolling?", which is OD-1's actual
 * failure surface. `cancelable: false` reproduces a browser that has
 * already committed the touch to scrolling.
 */
function pointerMove(
  card: HTMLElement,
  x: number,
  y: number,
  init: { cancelable?: boolean } = {},
): Event {
  const event = createEvent.pointerMove(card, {
    pointerId: POINTER_ID,
    pointerType: 'touch',
    clientX: x,
    clientY: y,
    ...init,
  })
  fireEvent(card, event)
  return event
}

function pointerUp(card: HTMLElement, x: number, y: number) {
  fireEvent.pointerUp(card, { pointerId: POINTER_ID, pointerType: 'touch', clientX: x, clientY: y })
}

function pointerCancel(card: HTMLElement, x: number, y: number) {
  fireEvent.pointerCancel(card, {
    pointerId: POINTER_ID,
    pointerType: 'touch',
    clientX: x,
    clientY: y,
  })
}

function lostPointerCapture(card: HTMLElement) {
  // Same generic-event form DragOrder.test.tsx uses: a raw `dispatchEvent`
  // would bypass RTL's `act()` wrapping and leave the resulting state
  // updates unflushed.
  fireEvent(card, new PointerEvent('lostpointercapture', { pointerId: POINTER_ID, bubbles: true }))
}

/**
 * A complete, deliberate horizontal swipe: past `AXIS_TOLERANCE` (20px) on
 * the first move so the axis resolves horizontal, then out to `distance`,
 * released after `durationMs` in total.
 */
function swipe(card: HTMLElement, distance: number, durationMs: number) {
  const sign = distance < 0 ? -1 : 1
  pointerDown(card, 0, 0)
  advanceClock(durationMs / 2)
  pointerMove(card, sign * 30, 0)
  advanceClock(durationMs / 2)
  pointerMove(card, distance, 0)
  pointerUp(card, distance, 0)
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
    installMockClock()

    it('calls onCommit with the correct direction when a drag ends past both thresholds', () => {
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)

      // 180px in 350ms is well past minDistance (120px) and minVelocity
      // (0.3px/ms — 180/350 ≈ 0.51). correct_direction is 'right' here.
      swipe(getCard(container), 180, 350)

      expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })
    })

    it('calls onCommit with correct: false for a deliberate drag in the wrong direction', () => {
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)

      swipe(getCard(container), -180, 350)

      expect(onCommit).toHaveBeenCalledWith({ correct: false, choiceIndex: null })
    })

    // Distance and velocity pointing opposite ways can't be produced through
    // this component any more (velocity is derived from the same signed
    // movement — signedVelocityFromGesture), so that disagreement case is
    // covered where it now lives: gestureThreshold.test.ts's "does not commit
    // when distance and velocity point in opposite directions".

    it('does NOT call onCommit for a drag below both thresholds', () => {
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)

      // A lazy half-drag: 40px in 350ms is below minDistance (120) and
      // minVelocity (40/350 ≈ 0.11). Still far enough past AXIS_TOLERANCE to
      // resolve horizontal, so this really does reach the threshold math
      // rather than being dropped as an ambiguous gesture.
      swipe(getCard(container), 40, 350)

      expect(onCommit).not.toHaveBeenCalled()
    })

    it('does NOT call onCommit for a short, high-velocity accidental flick', () => {
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)

      // 60px in 20ms is a genuinely high average velocity (3 px/ms) but far
      // short of minDistance (120) — the accidental-flick failure mode
      // minDistance exists to reject.
      swipe(getCard(container), 60, 20)

      expect(onCommit).not.toHaveBeenCalled()
    })

    it('commits a deliberate full-distance swipe that pauses before release (32ms-staleness regression)', () => {
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)
      const card = getCard(container)

      // The real-hardware shape: the finger travels the full distance, then
      // rests for a beat before lifting off. A last-frame velocity would
      // collapse to ~0 across that pause (the bug signedVelocityFromGesture
      // exists to avoid); the whole-gesture average is 180/350 ≈ 0.51.
      pointerDown(card, 0, 0)
      advanceClock(50)
      pointerMove(card, 60, 0)
      advanceClock(100)
      pointerMove(card, 180, 0)
      advanceClock(200) // dead still, well past the 32ms window
      pointerUp(card, 180, 0)

      expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })
    })

    it('ignores intermediate pointermove events — only pointerup can commit', () => {
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)
      const card = getCard(container)

      pointerDown(card, 0, 0)
      advanceClock(100)
      pointerMove(card, 60, 0)
      pointerMove(card, 180, 0)
      pointerMove(card, 300, 0)

      expect(onCommit).not.toHaveBeenCalled()

      advanceClock(250)
      pointerUp(card, 300, 0)
      expect(onCommit).toHaveBeenCalledTimes(1)
    })

    it('previews the side being dragged toward while the drag is in flight', () => {
      const { container } = render(<Harness />)
      const card = getCard(container)

      pointerDown(card, 0, 0)
      advanceClock(50)
      pointerMove(card, 60, 0)

      expect(screen.getByRole('button', { name: 'Race condition' }).className).toContain(
        'previewing',
      )
      expect(screen.getByRole('button', { name: 'Thread-safe' }).className).not.toContain(
        'previewing',
      )
    })

    it('a subsequent button click still commits after a below-threshold drag sprang back', async () => {
      const onCommit = vi.fn()
      const user = userEvent.setup()
      const { container } = render(<Harness onCommit={onCommit} />)

      swipe(getCard(container), 40, 350)
      expect(onCommit).not.toHaveBeenCalled()

      await user.click(screen.getByRole('button', { name: 'Race condition' }))
      expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })
    })

    it('ignores pointer events once committed', async () => {
      const onCommit = vi.fn()
      const user = userEvent.setup()
      const { container } = render(<Harness onCommit={onCommit} />)

      await user.click(screen.getByRole('button', { name: 'Race condition' }))
      expect(onCommit).toHaveBeenCalledTimes(1)

      swipe(getCard(container), 180, 350)

      expect(onCommit).toHaveBeenCalledTimes(1)
    })

    it('resets cleanly on pointercancel, leaving no stuck gesture behind', () => {
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)
      const card = getCard(container)

      pointerDown(card, 0, 0)
      advanceClock(100)
      pointerMove(card, 180, 0)
      pointerCancel(card, 180, 0)
      // A late pointerup for the cancelled gesture must be a no-op, not a
      // commit and not a crash.
      advanceClock(250)
      pointerUp(card, 180, 0)
      expect(onCommit).not.toHaveBeenCalled()

      // The next gesture still works — nothing stayed latched.
      swipe(card, 180, 350)
      expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })
    })

    it('resets cleanly on lostpointercapture, leaving no stuck gesture behind', () => {
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)
      const card = getCard(container)

      pointerDown(card, 0, 0)
      advanceClock(100)
      pointerMove(card, 180, 0)
      lostPointerCapture(card)
      advanceClock(250)
      pointerUp(card, 180, 0)
      expect(onCommit).not.toHaveBeenCalled()

      swipe(card, 180, 350)
      expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })
    })
  })

  /**
   * The heart of the OD-1 fix: the component's own scroll-vs-swipe decision.
   * `touch-action: pan-y` deliberately leaves vertical panning with the
   * browser, so the component must claim a gesture (preventDefault) exactly
   * when it resolves horizontal — not before (that would break page
   * scrolling from the card) and never for a vertical one.
   */
  describe('axis arbitration', () => {
    installMockClock()

    it('does NOT preventDefault while the gesture is still axis-ambiguous', () => {
      const { container } = render(<Harness />)
      const card = getCard(container)

      pointerDown(card, 0, 0)
      advanceClock(16)
      // Under AXIS_TOLERANCE (20px) on both axes: still anybody's gesture,
      // so the browser stays free to turn it into a native scroll.
      const event = pointerMove(card, 12, 8)

      expect(event.defaultPrevented).toBe(false)
    })

    it('calls preventDefault on the move that resolves horizontal, and on every move after it', () => {
      const { container } = render(<Harness />)
      const card = getCard(container)

      pointerDown(card, 0, 0)
      advanceClock(16)
      const resolving = pointerMove(card, 40, 6)
      const later = pointerMove(card, 120, 10)

      expect(resolving.defaultPrevented).toBe(true)
      expect(later.defaultPrevented).toBe(true)
    })

    it('never preventDefaults a vertical gesture, and stays yielded even if it later turns horizontal', () => {
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)
      const card = getCard(container)

      pointerDown(card, 0, 0)
      advanceClock(16)
      // Vertical-dominant first sample past the tolerance: this is a page
      // scroll, and the browser owns it from here.
      const vertical = pointerMove(card, 8, 40)
      // Even a big horizontal continuation must not steal it back — the
      // browser is already scrolling by now on a real device.
      const late = pointerMove(card, 200, 60)
      advanceClock(300)
      pointerUp(card, 200, 60)

      expect(vertical.defaultPrevented).toBe(false)
      expect(late.defaultPrevented).toBe(false)
      expect(onCommit).not.toHaveBeenCalled()
    })

    it('resolves a slightly-diagonal swipe as horizontal and commits it', () => {
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)
      const card = getCard(container)

      // The zero-tolerance axis-lock bug in miniature: the first sample is
      // vertical-dominant (2px across, 5px down — ordinary finger jitter),
      // and a first-sample axis lock would drop the entire swipe. Under
      // AXIS_TOLERANCE that sample is simply too small to decide anything.
      pointerDown(card, 0, 0)
      advanceClock(16)
      const jitter = pointerMove(card, 2, 5)
      advanceClock(100)
      const diagonal = pointerMove(card, 34, 14)
      advanceClock(234)
      pointerMove(card, 180, 22)
      pointerUp(card, 180, 22)

      expect(jitter.defaultPrevented).toBe(false)
      expect(diagonal.defaultPrevented).toBe(true)
      expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })
    })

    it('still tracks and commits when the browser sends a non-cancelable move', () => {
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)
      const card = getCard(container)

      // `cancelable: false` is what a browser sends once it has already
      // committed the touch to scrolling — preventDefault is impossible, and
      // the component must degrade to "track it anyway" rather than throw or
      // drop the gesture (the case the debug overlay flags on-device).
      pointerDown(card, 0, 0)
      advanceClock(100)
      const uncancelable = pointerMove(card, 60, 0, { cancelable: false })
      advanceClock(250)
      pointerMove(card, 180, 0, { cancelable: false })
      pointerUp(card, 180, 0)

      expect(uncancelable.defaultPrevented).toBe(false)
      expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })
    })
  })

  /**
   * OD-1's other half: `touch-action` is declared once, statically, and no
   * code path ever assigns it. A browser picks scroll-vs-gesture at hit-test
   * time — before any handler runs — so a runtime-toggled value is always too
   * late. (practice.css carries the same declaration; jsdom only reflects
   * inline styles, so this inline copy is the one assertable here.)
   */
  describe('static touch-action', () => {
    installMockClock()

    it("keeps the card's inline touch-action at 'pan-y' through a whole gesture", () => {
      const { container } = render(<Harness />)
      const card = getCard(container)
      expect(card.style.touchAction).toBe('pan-y')

      pointerDown(card, 0, 0)
      expect(card.style.touchAction).toBe('pan-y')
      advanceClock(100)
      pointerMove(card, 40, 6)
      expect(card.style.touchAction).toBe('pan-y')
      pointerMove(card, 180, 6)
      advanceClock(250)
      pointerUp(card, 180, 6)
      expect(card.style.touchAction).toBe('pan-y')

      pointerDown(card, 0, 0)
      pointerMove(card, 6, 40)
      pointerCancel(card, 6, 40)
      expect(card.style.touchAction).toBe('pan-y')
    })
  })

  /**
   * Temporary v3 Phase 0 instrumentation (useGestureDebugOverlay.tsx) — the
   * on-device capture OD-1's fix method requires. Tested at the seam that
   * matters: invisible unless explicitly asked for.
   */
  describe('gesture debug overlay', () => {
    installMockClock()

    afterEach(() => {
      window.history.replaceState({}, '', '/')
    })

    it('renders nothing without the ?gesture-debug=1 flag', () => {
      const { container } = render(<Harness />)
      swipe(getCard(container), 180, 350)

      expect(screen.queryByTestId('gesture-debug-overlay')).not.toBeInTheDocument()
    })

    it('logs the pointer stream, cancelable flags, axis state and commit decision when flagged on', () => {
      window.history.replaceState({}, '', '/?gesture-debug=1')
      const { container } = render(<Harness />)

      swipe(getCard(container), 180, 350)

      const log = screen.getByTestId('gesture-debug-overlay').textContent
      expect(log).toContain('down x=0 y=0 cancelable=true axis=ambiguous pd=false')
      expect(log).toContain('move x=30 y=0 cancelable=true axis=horizontal pd=true')
      expect(log).toContain('-> right')
    })
  })
})
