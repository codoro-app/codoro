import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEvent, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useState } from 'react'
import type { SwipeBinaryPuzzle } from '../../../content'
import type { CommitPayload } from '../interactionTypes'
import { SwipeBinary } from './SwipeBinary'

/**
 * SwipeBinary's touch gesture plumbing is raw native `touchstart`/
 * `touchmove`/`touchend`/`touchcancel` listeners (v3 Phase 0, OD-5 — see the
 * component's own doc comment for the full history: OD-1 through OD-4 tried
 * Pointer Events in various shapes and each real on-device capture found a
 * new way WebKit took the gesture back; OD-5 pivoted to the same pattern
 * `react-tinder-card` — a proven, widely-used reference implementation for
 * this exact UI — actually uses). jsdom has no native `TouchEvent`/
 * `TouchList`, so these tests build plain `touches`/`changedTouches` arrays
 * and pass them through `fireEvent.touchStart` etc., which RTL synthesizes
 * into DOM `Event`s with those properties attached — real enough to exercise
 * `event.cancelable`/`event.preventDefault()`, which the component reads
 * directly.
 *
 * Mouse/pen still runs through Pointer Events (unchanged in spirit from
 * before OD-5) — a small dedicated describe block near the bottom covers
 * that path only; every other test below is the touch path.
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

const TOUCH_ID = 7

interface TouchOpts {
  readonly cancelable?: boolean
}

// `fireEvent.X()` returns a boolean (dispatchEvent's own return value), not
// the event — `.defaultPrevented` needs the event object itself, so these
// build it via `createEvent` first, dispatch with the two-argument
// `fireEvent(el, event)` form, and return the same (now-dispatched,
// possibly-defaultPrevented) event object.

function touchStart(card: HTMLElement, x: number, y: number, opts: TouchOpts = {}) {
  const event = createEvent.touchStart(card, {
    cancelable: opts.cancelable ?? true,
    touches: [{ identifier: TOUCH_ID, clientX: x, clientY: y, target: card }],
  })
  fireEvent(card, event)
  return event
}

function touchMove(card: HTMLElement, x: number, y: number, opts: TouchOpts = {}) {
  const event = createEvent.touchMove(card, {
    cancelable: opts.cancelable ?? true,
    touches: [{ identifier: TOUCH_ID, clientX: x, clientY: y, target: card }],
  })
  fireEvent(card, event)
  return event
}

function touchEnd(card: HTMLElement, x: number, y: number) {
  const event = createEvent.touchEnd(card, {
    changedTouches: [{ identifier: TOUCH_ID, clientX: x, clientY: y, target: card }],
  })
  fireEvent(card, event)
  return event
}

function touchCancel(card: HTMLElement, x: number, y: number) {
  const event = createEvent.touchCancel(card, {
    changedTouches: [{ identifier: TOUCH_ID, clientX: x, clientY: y, target: card }],
  })
  fireEvent(card, event)
  return event
}

/**
 * A complete, deliberate horizontal swipe: past `AXIS_TOLERANCE` (20px) on
 * the first move so the axis resolves horizontal, then out to `distance`,
 * released after `durationMs` in total.
 */
function swipe(card: HTMLElement, distance: number, durationMs: number) {
  const sign = distance < 0 ? -1 : 1
  touchStart(card, 0, 0)
  advanceClock(durationMs / 2)
  touchMove(card, sign * 30, 0)
  advanceClock(durationMs / 2)
  touchMove(card, distance, 0)
  touchEnd(card, distance, 0)
}

describe('SwipeBinary', () => {
  describe('tap fallback', () => {
    it('commits correct on tapping the correct-side button', () => {
      const onCommit = vi.fn()
      render(<Harness onCommit={onCommit} />)
      fireEvent.click(screen.getByText('Race condition'))
      expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })
    })

    it('commits incorrect on tapping the wrong-side button', () => {
      const onCommit = vi.fn()
      render(<Harness onCommit={onCommit} />)
      fireEvent.click(screen.getByText('Thread-safe'))
      expect(onCommit).toHaveBeenCalledWith({ correct: false, choiceIndex: null })
    })

    it('disables both buttons once committed', () => {
      render(<Harness />)
      fireEvent.click(screen.getByText('Race condition'))
      expect(screen.getByText('Thread-safe')).toBeDisabled()
      expect(screen.getByText('Race condition')).toBeDisabled()
    })

    it('reveals correct/wrong state on the buttons after commit', () => {
      render(<Harness />)
      fireEvent.click(screen.getByText('Thread-safe'))
      expect(screen.getByText('Thread-safe').className).toContain('--wrong')
      expect(screen.getByText('Race condition').className).toContain('--reveal-correct')
    })
  })

  describe('touch gesture', () => {
    installMockClock()

    it('commits correct on a deliberate rightward swipe past both thresholds', () => {
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)
      swipe(getCard(container), 180, 350)
      expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })
    })

    it('commits incorrect on a deliberate leftward swipe past both thresholds', () => {
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)
      swipe(getCard(container), -180, 350)
      expect(onCommit).toHaveBeenCalledWith({ correct: false, choiceIndex: null })
    })

    it('does not commit a drag below the distance threshold', () => {
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)
      const card = getCard(container)
      touchStart(card, 0, 0)
      advanceClock(100)
      touchMove(card, 40, 0)
      advanceClock(250)
      touchEnd(card, 40, 0)
      expect(onCommit).not.toHaveBeenCalled()
    })

    it('does not commit a short, high-velocity flick below the distance threshold', () => {
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)
      const card = getCard(container)
      touchStart(card, 0, 0)
      advanceClock(10)
      touchMove(card, 50, 0)
      touchEnd(card, 50, 0)
      expect(onCommit).not.toHaveBeenCalled()
    })

    it('still commits on a deliberate swipe with a pause before release (32ms-staleness regression)', () => {
      // v2 Phase 0's original OD-1 fix: velocity is derived from
      // movement/elapsedTime over the WHOLE gesture, not from a last-frame
      // delta that can go stale if the finger pauses before lifting.
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)
      const card = getCard(container)
      touchStart(card, 0, 0)
      advanceClock(16)
      touchMove(card, 30, 0)
      advanceClock(84)
      touchMove(card, 180, 0)
      advanceClock(200) // deliberate pause before lift
      touchEnd(card, 180, 0)
      expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })
    })

    it('never commits from an intermediate (non-final) move', () => {
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)
      const card = getCard(container)
      touchStart(card, 0, 0)
      advanceClock(16)
      touchMove(card, 30, 0)
      advanceClock(84)
      touchMove(card, 180, 0)
      expect(onCommit).not.toHaveBeenCalled()
    })

    it('ignores further touch events once committed', () => {
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)
      const card = getCard(container)
      swipe(card, 180, 350)
      onCommit.mockClear()
      touchStart(card, 0, 0)
      advanceClock(350)
      touchMove(card, 180, 0)
      touchEnd(card, 180, 0)
      expect(onCommit).not.toHaveBeenCalled()
    })

    it('resolves a slightly-diagonal swipe as horizontal and commits it', () => {
      // The zero-tolerance axis-lock bug in miniature: the first sample is
      // vertical-dominant (2px across, 5px down — ordinary finger jitter),
      // and a first-sample axis lock would drop the entire swipe. Under
      // AXIS_TOLERANCE that sample is simply too small to decide anything.
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)
      const card = getCard(container)
      touchStart(card, 0, 0)
      advanceClock(16)
      touchMove(card, 2, 5)
      advanceClock(100)
      touchMove(card, 34, 14)
      advanceClock(234)
      touchMove(card, 180, 22)
      touchEnd(card, 180, 22)
      expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })
    })

    it('resolves a vertical-dominant drag as vertical and never moves or commits, even if it later turns horizontal', () => {
      // OD-5: no scroll-passthrough — a vertical-resolving gesture just
      // doesn't move the card, and can never later become horizontal (the
      // axis, once resolved, is sticky for the rest of the gesture).
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)
      const card = getCard(container)
      touchStart(card, 0, 0)
      advanceClock(16)
      touchMove(card, 8, 40) // vertical-dominant first sample past tolerance
      touchMove(card, 200, 60) // big horizontal continuation must not steal it back
      advanceClock(300)
      touchEnd(card, 200, 60)
      expect(onCommit).not.toHaveBeenCalled()
    })

    it('resets cleanly on touchcancel, and a subsequent gesture still commits', () => {
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)
      const card = getCard(container)
      touchStart(card, 0, 0)
      advanceClock(50)
      touchMove(card, 60, 0)
      touchCancel(card, 60, 0)
      expect(onCommit).not.toHaveBeenCalled()

      swipe(card, 180, 350)
      expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })
    })

    it('a second finger landing mid-gesture does not hijack or interleave with the first', () => {
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)
      const card = getCard(container)
      touchStart(card, 0, 0)
      advanceClock(16)
      touchMove(card, 30, 0)
      // A second, different-identifier touch starting mid-gesture must be
      // ignored — touches[0] is still identifier TOUCH_ID here, so this
      // exercises the "already have an active touch" guard on touchstart.
      fireEvent.touchStart(card, {
        touches: [
          { identifier: TOUCH_ID, clientX: 30, clientY: 0, target: card },
          { identifier: TOUCH_ID + 1, clientX: 5, clientY: 5, target: card },
        ],
      })
      advanceClock(334)
      touchEnd(card, 180, 0)
      expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })
    })
  })

  describe('touchstart preventDefault (OD-5)', () => {
    installMockClock()

    it('calls preventDefault unconditionally on touchstart, before the axis is known', () => {
      const { container } = render(<Harness />)
      const down = touchStart(getCard(container), 0, 0)
      expect(down.defaultPrevented).toBe(true)
    })

    it('does not call preventDefault when the browser reports the touchstart as non-cancelable', () => {
      const { container } = render(<Harness />)
      const down = touchStart(getCard(container), 0, 0, { cancelable: false })
      expect(down.defaultPrevented).toBe(false)
    })

    it('keeps calling preventDefault on every subsequent move, horizontal or vertical', () => {
      const { container } = render(<Harness />)
      const card = getCard(container)
      touchStart(card, 0, 0)
      advanceClock(16)
      const horizontalMove = touchMove(card, 40, 0)
      const verticalStart = touchMove(card, 40, 60) // won't re-resolve axis; still calls preventDefault
      expect(horizontalMove.defaultPrevented).toBe(true)
      expect(verticalStart.defaultPrevented).toBe(true)
    })
  })

  describe('static touch-action', () => {
    installMockClock()

    it("keeps the card's inline touch-action at 'none' through a whole gesture", () => {
      const { container } = render(<Harness />)
      const card = getCard(container)
      expect(card.style.touchAction).toBe('none')

      touchStart(card, 0, 0)
      expect(card.style.touchAction).toBe('none')
      advanceClock(100)
      touchMove(card, 40, 6)
      expect(card.style.touchAction).toBe('none')
      touchMove(card, 180, 6)
      advanceClock(250)
      touchEnd(card, 180, 6)
      expect(card.style.touchAction).toBe('none')

      touchStart(card, 0, 0)
      touchMove(card, 6, 40)
      touchCancel(card, 6, 40)
      expect(card.style.touchAction).toBe('none')
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

    it('logs the touch stream, cancelable flags, axis state and commit decision when flagged on', async () => {
      window.history.replaceState({}, '', '/?gesture-debug=1')
      const { container } = render(<Harness />)

      swipe(getCard(container), 180, 350)

      // Entries are buffered in a ref and flushed to state at most once per
      // animation frame (v3 Phase 0, OD-4 candidate) — see the hook's own
      // doc comment — so the DOM only catches up asynchronously here, same
      // as it would on a real device.
      await waitFor(() => {
        const log = screen.getByTestId('gesture-debug-overlay').textContent
        expect(log).toContain('down x=0 y=0 cancelable=true axis=ambiguous pd=true')
        expect(log).toContain('move x=30 y=0 cancelable=true axis=horizontal pd=true')
        expect(log).toContain('-> right')
      })
    })
  })

  describe('mouse/pen (Pointer Events, unchanged in spirit by OD-5)', () => {
    installMockClock()

    function pointerDown(card: HTMLElement, x: number, y: number) {
      fireEvent.pointerDown(card, { pointerId: 3, pointerType: 'mouse', clientX: x, clientY: y })
    }
    function pointerMove(card: HTMLElement, x: number, y: number) {
      fireEvent.pointerMove(card, { pointerId: 3, pointerType: 'mouse', clientX: x, clientY: y })
    }
    function pointerUp(card: HTMLElement, x: number, y: number) {
      fireEvent.pointerUp(card, { pointerId: 3, pointerType: 'mouse', clientX: x, clientY: y })
    }

    it('commits on a deliberate rightward mouse drag past both thresholds', () => {
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)
      const card = getCard(container)
      pointerDown(card, 0, 0)
      advanceClock(175)
      pointerMove(card, 30, 0)
      advanceClock(175)
      pointerMove(card, 180, 0)
      pointerUp(card, 180, 0)
      expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })
    })

    it('a touch-typed pointer event never drives the mouse path (touch is fully owned by the native listeners)', () => {
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)
      const card = getCard(container)
      fireEvent.pointerDown(card, { pointerId: 9, pointerType: 'touch', clientX: 0, clientY: 0 })
      advanceClock(350)
      fireEvent.pointerMove(card, { pointerId: 9, pointerType: 'touch', clientX: 180, clientY: 0 })
      fireEvent.pointerUp(card, { pointerId: 9, pointerType: 'touch', clientX: 180, clientY: 0 })
      expect(onCommit).not.toHaveBeenCalled()
    })
  })
})
