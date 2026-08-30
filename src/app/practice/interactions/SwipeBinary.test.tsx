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

/**
 * A snippet whose longest line is well past what fits on a phone card (~33
 * characters at the app's code size on a 393px-wide viewport). Under the
 * pre-2026-08-21 renderer this content is exactly what tipped a snippet into
 * `code-snippet--scrollable` and made the card unswipeable; it now wraps and
 * changes nothing about the gesture. Used by the regression block below.
 */
const LONG_SNIPPET =
  'public class Report {\n' +
  '  public static String formatPrice(double price) {\n' +
  '    return String.format("Price: $%d", price);\n' +
  '  }\n' +
  '}'

function Harness({
  onCommit,
  snippet,
}: {
  onCommit?: (p: CommitPayload) => void
  snippet?: string
}) {
  const [committed, setCommitted] = useState(false)
  const [payload, setPayload] = useState<CommitPayload | undefined>(undefined)
  return (
    <SwipeBinary
      puzzle={snippet === undefined ? puzzle : { ...puzzle, snippet }}
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

function getSnippet(container: HTMLElement): HTMLElement {
  const snippet = container.querySelector<HTMLElement>('.code-snippet')
  if (!snippet) throw new Error('missing .code-snippet')
  return snippet
}

/**
 * `stubExtremeSnippetOverflow()` used to live here: it faked
 * scrollWidth/clientWidth so the nested CodeSnippet would mark itself
 * `code-snippet--scrollable` and this component would divert the touch into
 * the snippet's own scroll. Both the stub and the behavior it exercised were
 * deleted on 2026-08-21 — code snippets wrap and never scroll horizontally,
 * so there is no competing scroll container to forward to. See
 * CodeSnippet.tsx's doc comment and the deleted-function note in
 * SwipeBinary.tsx.
 *
 * What replaces it is the opposite assertion: a snippet with content long
 * enough that it USED to become scrollable must now drag the card like any
 * other part of the surface. `LONG_SNIPPET` below is that fixture.
 */

const TOUCH_ID = 7

interface TouchOpts {
  readonly cancelable?: boolean
}

// `fireEvent.X()` returns a boolean (dispatchEvent's own return value), not
// the event — `.defaultPrevented` needs the event object itself, so these
// build it via `createEvent` first, dispatch with the two-argument
// `fireEvent(el, event)` form, and return the same (now-dispatched,
// possibly-defaultPrevented) event object.

/**
 * Every helper below populates BOTH `touches` and `changedTouches`, the way a
 * real browser does — `touches` is every touch point currently on the screen,
 * `changedTouches` is the subset this particular event is about. They used to
 * set only one or the other, which is what let OD-6's defect 3 (the component
 * reading `touches[0]` at `touchstart` instead of `changedTouches[0]`) sit
 * undetected under a green suite: with a single-finger gesture the two lists
 * are identical, so the bug is invisible until a second touch exists. The
 * multi-touch cases further down are the ones that actually distinguish them.
 */
function touchStart(card: HTMLElement, x: number, y: number, opts: TouchOpts = {}) {
  const touch = { identifier: TOUCH_ID, clientX: x, clientY: y, target: card }
  const event = createEvent.touchStart(card, {
    cancelable: opts.cancelable ?? true,
    touches: [touch],
    changedTouches: [touch],
  })
  fireEvent(card, event)
  return event
}

function touchMove(card: HTMLElement, x: number, y: number, opts: TouchOpts = {}) {
  const touch = { identifier: TOUCH_ID, clientX: x, clientY: y, target: card }
  const event = createEvent.touchMove(card, {
    cancelable: opts.cancelable ?? true,
    touches: [touch],
    changedTouches: [touch],
  })
  fireEvent(card, event)
  return event
}

function touchEnd(card: HTMLElement, x: number, y: number) {
  const event = createEvent.touchEnd(card, {
    touches: [],
    changedTouches: [{ identifier: TOUCH_ID, clientX: x, clientY: y, target: card }],
  })
  fireEvent(card, event)
  return event
}

function touchCancel(card: HTMLElement, x: number, y: number) {
  const event = createEvent.touchCancel(card, {
    touches: [],
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

  describe('reveal opacity (fly-off then invisible reset, not a jump-cut)', () => {
    installMockClock()

    it("binds the card's opacity to a motion value so the post-commit reset can fade instead of teleporting visibly", () => {
      // framer-motion writes a MotionValue bound via `style={{ ... }}` as a
      // real inline style synchronously on mount — this is a structural
      // smoke test (the binding exists) rather than an assertion on the
      // exact interpolated value mid-tween, which framer-motion's rAF-driven
      // `animate()` calls aren't meaningfully readable from jsdom/RTL
      // without a fake-timer + rAF-polyfill setup this file doesn't have.
      const { container } = render(<Harness />)
      const card = getCard(container)
      expect(card.style.opacity).not.toBe('')
    })
  })

  /*
   * Regression block for the mobile PWA report of 2026-08-21: a swipe that
   * started on a long code snippet did nothing at all.
   *
   * Cause (see SwipeBinary.tsx's deleted-function note and CodeSnippet.tsx):
   * a snippet whose longest line overflowed became a horizontal scroll
   * container, and this component deliberately handed any touch starting
   * there to `snippetEl.scrollLeft` instead of the card drag. Since the
   * snippet covers nearly the whole card, that made long-code puzzles
   * effectively unswipeable — and dragging RIGHT clamped `scrollLeft` at 0,
   * so the gesture produced no movement whatsoever. Roughly 28% of the
   * puzzle corpus rendered in that state on a phone.
   *
   * The tests this replaces asserted the forwarding worked. These assert it
   * is gone: the snippet is part of the drag surface, full stop, and content
   * length changes nothing about that.
   */
  describe('a touch starting on the code snippet drags the card (2026-08-21 regression)', () => {
    installMockClock()

    it('drags the card when the touch starts on a long snippet, not a scroll', () => {
      const { container } = render(<Harness snippet={LONG_SNIPPET} />)
      const snippet = getSnippet(container)

      touchStart(snippet, 0, 0)
      advanceClock(50)
      touchMove(snippet, 30, 0) // resolves the axis horizontal
      touchMove(snippet, 80, 0) // past the 60px preview-halfway point

      // framer-motion's own style writes are rAF-batched and don't flush
      // synchronously in jsdom, so `--previewing` (a useMotionValueEvent
      // subscriber -> React state) is the reliable synchronous signal here,
      // not `card.style.transform`.
      expect(screen.getByText('Race condition').className).toContain('--previewing')
      // And nothing scrolled: the snippet is not a scroll container at all.
      expect(snippet.scrollLeft).toBe(0)
    })

    it('commits a full swipe that starts on a long snippet', () => {
      const onCommit = vi.fn()
      const { container } = render(<Harness snippet={LONG_SNIPPET} onCommit={onCommit} />)
      const snippet = getSnippet(container)

      touchStart(snippet, 0, 0)
      advanceClock(50)
      touchMove(snippet, 40, 0)
      touchMove(snippet, 130, 0)
      touchEnd(snippet, 130, 0)

      expect(onCommit).toHaveBeenCalledTimes(1)
    })

    it('renders a long snippet without becoming a horizontal scroll container', () => {
      const { container } = render(<Harness snippet={LONG_SNIPPET} />)
      const snippet = getSnippet(container)

      expect(snippet.className).not.toContain('code-snippet--scrollable')
      expect(snippet.className).not.toContain('overflow-x-auto')
    })

    it('still calls preventDefault on a snippet-origin touchstart (OD-5: the card claims every touch)', () => {
      const { container } = render(<Harness snippet={LONG_SNIPPET} />)
      const snippet = getSnippet(container)

      const down = touchStart(snippet, 0, 0)
      expect(down.defaultPrevented).toBe(true)
    })

    it('a touch starting elsewhere on the card still drags it, long snippet or not', () => {
      const { container } = render(<Harness snippet={LONG_SNIPPET} />)
      const card = getCard(container)

      touchStart(card, 0, 0)
      advanceClock(50)
      touchMove(card, 30, 0)
      touchMove(card, 80, 0)

      expect(screen.getByText('Race condition').className).toContain('--previewing')
    })
  })

  /**
   * OD-6 (2026-08-21) — gesture resilience WITHOUT a watchdog.
   *
   * This block replaces the "gesture watchdog" block that lived here. The
   * watchdog (PR #71, GESTURE_WATCHDOG_MS = 2000) existed because the state
   * machine assumed a terminating touch event always eventually arrives. The
   * concern was real; a timer was the wrong instrument, because it cannot
   * tell a dropped gesture apart from a user pausing mid-drag — both are just
   * silence — and the value it was given picked the wrong one for the
   * pausing user. Captured against production: a 2.3s mid-drag pause tore the
   * gesture down while the finger was still on the screen, discarded the real
   * touchend, and stopped calling preventDefault() on a still-live touch.
   *
   * Two structural properties replace it, and these are their tests:
   *   1. terminating events are heard at `window`, so they arrive even if the
   *      card is gone or the touch retargeted;
   *   2. a stale claim is detected lazily at the next `touchstart`, from the
   *      browser's own `event.touches` list rather than from elapsed time.
   *
   * No fake timers here, deliberately: there is no longer any timer to
   * advance. That the whole block can run on the real clock is itself part of
   * what changed.
   */
  describe('gesture resilience without a watchdog (OD-6, 2026-08-21)', () => {
    installMockClock()

    const OTHER_ID = 42

    /** A `touchend` dispatched somewhere other than the card — what the window-level listener exists for. */
    function touchEndOnBody(x: number, y: number, id: number = TOUCH_ID) {
      const event = createEvent.touchEnd(document.body, {
        touches: [],
        changedTouches: [{ identifier: id, clientX: x, clientY: y, target: document.body }],
      })
      fireEvent(document.body, event)
      return event
    }

    /** A `touchstart` on the card while `stray` is already resting elsewhere on the page. */
    function touchStartWithStray(card: HTMLElement, x: number, y: number, id: number = TOUCH_ID) {
      const stray = { identifier: 99, clientX: 5, clientY: 600, target: document.body }
      const touch = { identifier: id, clientX: x, clientY: y, target: card }
      const event = createEvent.touchStart(card, {
        cancelable: true,
        // Note the ORDER: the stray finger started first, so a real browser
        // puts it at `touches[0]`. That is the whole defect.
        touches: [stray, touch],
        changedTouches: [touch],
      })
      fireEvent(card, event)
      return event
    }

    function touchMoveWithStray(card: HTMLElement, x: number, y: number, id: number = TOUCH_ID) {
      const stray = { identifier: 99, clientX: 5, clientY: 600, target: document.body }
      const touch = { identifier: id, clientX: x, clientY: y, target: card }
      const event = createEvent.touchMove(card, {
        cancelable: true,
        touches: [stray, touch],
        changedTouches: [touch],
      })
      fireEvent(card, event)
      return event
    }

    function touchEndWithStray(card: HTMLElement, x: number, y: number, id: number = TOUCH_ID) {
      const stray = { identifier: 99, clientX: 5, clientY: 600, target: document.body }
      const event = createEvent.touchEnd(card, {
        touches: [stray],
        changedTouches: [{ identifier: id, clientX: x, clientY: y, target: card }],
      })
      fireEvent(card, event)
      return event
    }

    it('binds its window-level touch listeners only while a gesture is in flight', () => {
      // The cost of hearing terminating events at `window`, and why it is
      // scoped to the gesture. A non-passive `touchmove` listener on `window`
      // opts the WHOLE PAGE out of the browser's scroll fast path for as long
      // as it is attached — the compositor can no longer assume the handler
      // won't preventDefault. Attaching at mount would tax every scroll on any
      // page showing a swipe-binary card, including scrolls nowhere near it.
      const add = vi.spyOn(window, 'addEventListener')
      const remove = vi.spyOn(window, 'removeEventListener')
      const moveAdds = () => add.mock.calls.filter(([type]) => type === 'touchmove').length
      const moveRemoves = () => remove.mock.calls.filter(([type]) => type === 'touchmove').length

      const { container } = render(<Harness />)
      const card = getCard(container)
      expect(moveAdds()).toBe(0)

      touchStart(card, 0, 0)
      expect(moveAdds()).toBe(1)
      // passive:false is load-bearing — a passive listener makes
      // preventDefault() a silent no-op, which is OD-5's whole mechanism.
      expect(add.mock.calls.find(([type]) => type === 'touchmove')?.[2]).toMatchObject({
        passive: false,
        capture: true,
      })

      advanceClock(150)
      touchMove(card, 40, 0)
      advanceClock(150)
      touchMove(card, 180, 0)
      touchEnd(card, 180, 0)
      expect(moveRemoves()).toBe(1)
    })

    it('never disowns a gesture that is still live, however long it pauses (the watchdog regression)', () => {
      // The exact captured failure: 200px of intent, interrupted by a 2.3s
      // pause — comfortably past the old 2000ms watchdog — and then finished
      // normally. Under the watchdog this committed nothing and the card sat
      // dead at centre from the moment the timer fired.
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)
      const card = getCard(container)

      touchStart(card, 0, 0)
      advanceClock(60)
      touchMove(card, 70, 0) // past PREVIEW_RANGE/2 — the side preview lights up
      expect(screen.getByText('Race condition').className).toContain('--previewing')

      // The pause. Nothing may happen here — no reset, no un-preview.
      advanceClock(2300)
      expect(screen.getByText('Race condition').className).toContain('--previewing')

      advanceClock(60)
      touchMove(card, 200, 0)
      touchEnd(card, 200, 0)
      expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })
    })

    it('keeps calling preventDefault throughout a long pause, never handing a live touch back mid-gesture', () => {
      // The second, worse half of the watchdog defect: once it fired, the
      // component stopped preventing default on a touch STILL on the card,
      // which on WebKit hands the in-flight gesture to the native pan
      // recognizer — the failure OD-1..OD-5 spent nine rounds chasing.
      const { container } = render(<Harness />)
      const card = getCard(container)

      touchStart(card, 0, 0)
      advanceClock(60)
      touchMove(card, 70, 0)
      advanceClock(3000)

      expect(touchMove(card, 90, 0).defaultPrevented).toBe(true)
      expect(touchMove(card, 140, 0).defaultPrevented).toBe(true)
    })

    it('resolves a gesture whose touchend never reaches the card, because it listens at window', () => {
      // The gap the watchdog was added for. Hearing terminating events at
      // window means a retargeted or re-parented touchend still lands.
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)
      const card = getCard(container)

      touchStart(card, 0, 0)
      advanceClock(150)
      touchMove(card, 40, 0)
      advanceClock(150)
      touchMove(card, 180, 0)
      touchEndOnBody(180, 0)

      expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })
    })

    it('recovers a claim abandoned with no terminating event at all, at the next touchstart', () => {
      // Belt and braces for the case (1) cannot cover: no terminating event
      // is ever dispatched anywhere. The next touchstart sees that the
      // claimed identifier is absent from `event.touches` — the browser
      // saying that finger is gone — and takes the new gesture.
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)
      const card = getCard(container)

      touchStart(card, 0, 0)
      advanceClock(50)
      touchMove(card, 150, 0)
      // Deliberately nothing else — the gesture simply evaporates.

      const next = { identifier: OTHER_ID, clientX: 0, clientY: 0, target: card }
      const start = createEvent.touchStart(card, {
        cancelable: true,
        touches: [next],
        changedTouches: [next],
      })
      fireEvent(card, start)
      // The abandoned gesture must not have blocked this one.
      expect(start.defaultPrevented).toBe(true)

      advanceClock(150)
      const moved = { identifier: OTHER_ID, clientX: 40, clientY: 0, target: card }
      fireEvent(
        card,
        createEvent.touchMove(card, {
          cancelable: true,
          touches: [moved],
          changedTouches: [moved],
        }),
      )
      advanceClock(150)
      const far = { identifier: OTHER_ID, clientX: 180, clientY: 0, target: card }
      fireEvent(
        card,
        createEvent.touchMove(card, { cancelable: true, touches: [far], changedTouches: [far] }),
      )
      fireEvent(card, createEvent.touchEnd(card, { touches: [], changedTouches: [far] }))

      expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })
    })

    it('claims the touch that actually started, not whichever finger was already on the screen (OD-6 defect 3)', () => {
      // Captured: with one finger already resting anywhere on the page, the
      // component read `event.touches[0]` — the STRAY finger, because
      // `touches` is document-wide and ordered by start time — anchored its
      // origin to a point that never moved, and the card did not budge
      // through a full 160px drag. Then touchend could not find that
      // identifier in `changedTouches` and returned without clearing the
      // claim, leaving the card inert for every gesture afterwards.
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)
      const card = getCard(container)

      touchStartWithStray(card, 0, 0)
      advanceClock(150)
      touchMoveWithStray(card, 70, 0)
      expect(screen.getByText('Race condition').className).toContain('--previewing')
      advanceClock(150)
      touchMoveWithStray(card, 180, 0)
      touchEndWithStray(card, 180, 0)

      expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })
    })

    it('does not leave the card inert when another finger lifts mid-gesture', () => {
      // A touchend for a DIFFERENT identifier must neither resolve nor kill
      // our gesture — ours is still down, and `event.touches` still contains
      // it. This is the guard on the early-return that used to leak.
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)
      const card = getCard(container)

      touchStartWithStray(card, 0, 0)
      advanceClock(150)
      touchMoveWithStray(card, 70, 0)

      // The stray finger lifts. Our touch is still listed in `touches`.
      const ours = { identifier: TOUCH_ID, clientX: 70, clientY: 0, target: card }
      fireEvent(
        document.body,
        createEvent.touchEnd(document.body, {
          touches: [ours],
          changedTouches: [{ identifier: 99, clientX: 5, clientY: 600, target: document.body }],
        }),
      )
      expect(onCommit).not.toHaveBeenCalled()
      expect(screen.getByText('Race condition').className).toContain('--previewing')

      advanceClock(150)
      touchMove(card, 180, 0)
      touchEnd(card, 180, 0)
      expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })
    })

    it('commits the captured slow drag: 160px released after 2558ms (OD-6 defect 1)', () => {
      // Component-level companion to gestureThreshold.test.ts's unit case.
      // This is the gesture a real user makes and the old AND rule silently
      // discarded.
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)
      const card = getCard(container)

      touchStart(card, 0, 0)
      for (let i = 1; i <= 24; i++) {
        advanceClock(2558 / 24)
        touchMove(card, (160 * i) / 24, 0)
      }
      touchEnd(card, 160, 0)

      expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })
    })

    it('commits a full-distance drag that comes to a complete stop before release', () => {
      // The release habit that made a whole-gesture average velocity feel
      // necessary in the first place. With distance standing alone, a dead
      // stop before lift-off is simply irrelevant.
      const onCommit = vi.fn()
      const { container } = render(<Harness onCommit={onCommit} />)
      const card = getCard(container)

      touchStart(card, 0, 0)
      advanceClock(100)
      touchMove(card, 60, 0)
      advanceClock(100)
      touchMove(card, 180, 0)
      // Three samples at the same position: the finger has stopped dead.
      advanceClock(120)
      touchMove(card, 180, 0)
      advanceClock(120)
      touchMove(card, 180, 0)
      touchEnd(card, 180, 0)

      expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })
    })
  })

  describe('button-origin touch (mobile tap-fallback bug, 2026-08-19)', () => {
    installMockClock()

    /**
     * Unlike every other touch test in this file, this dispatches on the
     * button itself (not `card`) so the event bubbles up to the card's
     * listener with `event.target` actually set to the button — matching a
     * real on-device tap. Every other helper here (`touchStart` et al.)
     * dispatches directly on `card`, which is exactly why this bug had no
     * coverage: `event.target` was always `card`, never a button.
     */
    function touchStartOnButton(button: HTMLElement, x: number, y: number) {
      const touch = { identifier: TOUCH_ID, clientX: x, clientY: y, target: button }
      const event = createEvent.touchStart(button, {
        cancelable: true,
        touches: [touch],
        changedTouches: [touch],
      })
      fireEvent(button, event)
      return event
    }

    function touchEndOnButton(button: HTMLElement, x: number, y: number) {
      const event = createEvent.touchEnd(button, {
        touches: [],
        changedTouches: [{ identifier: TOUCH_ID, clientX: x, clientY: y, target: button }],
      })
      fireEvent(button, event)
      return event
    }

    it('commits directly on touchstart+touchend on a button, with no click event ever dispatched (second real-device report, 2026-08-19)', () => {
      // The first fix (skip preventDefault so native click reaches the
      // button) turned out insufficient on a real device — see
      // buttonTouchIdRef's doc comment in SwipeBinary.tsx. This is the
      // regression test for the actual fix: the component now owns the tap
      // itself in JS and must commit WITHOUT any `click` event firing at
      // all, unlike every 'tap fallback' test above which dispatches click
      // directly.
      const onCommit = vi.fn()
      render(<Harness onCommit={onCommit} />)
      const button = screen.getByText('Race condition')
      touchStartOnButton(button, 0, 0)
      advanceClock(80)
      touchEndOnButton(button, 0, 0)
      expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })
    })

    it('commits incorrect on tapping the wrong-side button via touch', () => {
      const onCommit = vi.fn()
      render(<Harness onCommit={onCommit} />)
      const button = screen.getByText('Thread-safe')
      touchStartOnButton(button, 0, 0)
      advanceClock(80)
      touchEndOnButton(button, 0, 0)
      expect(onCommit).toHaveBeenCalledWith({ correct: false, choiceIndex: null })
    })

    it('calls preventDefault on a button-origin touchstart, to suppress native click synthesis and avoid a double-commit', () => {
      render(<Harness />)
      const button = screen.getByText('Race condition')
      const down = touchStartOnButton(button, 0, 0)
      expect(down.defaultPrevented).toBe(true)
    })

    it('does not claim the touch for card-dragging when it originates on a button', () => {
      const { container } = render(<Harness />)
      const button = screen.getByText('Race condition')
      touchStartOnButton(button, 0, 0)
      advanceClock(50)
      // Fired on the card directly (matching every other test's move/end
      // helpers) — if the card had claimed this touch id, this would move it.
      touchMove(getCard(container), 80, 0)
      expect(screen.getByText('Race condition').className).not.toContain('--previewing')
    })

    it('cancels the tap (does not commit) when the touch drags away from the button before lifting', () => {
      const onCommit = vi.fn()
      render(<Harness onCommit={onCommit} />)
      const button = screen.getByText('Race condition')
      touchStartOnButton(button, 0, 0)
      advanceClock(50)
      // Moved past AXIS_TOLERANCE — this is no longer a tap, and per
      // fallbackButtonAncestor's contract it must not become a card drag
      // either.
      fireEvent(
        button,
        createEvent.touchMove(button, {
          cancelable: true,
          touches: [{ identifier: TOUCH_ID, clientX: 30, clientY: 0, target: button }],
        }),
      )
      touchEndOnButton(button, 30, 0)
      expect(onCommit).not.toHaveBeenCalled()
    })

    it('does not commit a button tap once already committed', () => {
      const onCommit = vi.fn()
      render(<Harness onCommit={onCommit} />)
      fireEvent.click(screen.getByText('Race condition'))
      onCommit.mockClear()
      const button = screen.getByText('Thread-safe')
      touchStartOnButton(button, 0, 0)
      advanceClock(50)
      touchEndOnButton(button, 0, 0)
      expect(onCommit).not.toHaveBeenCalled()
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

  describe('preview highlight (tilt threshold tracks the real commit distance)', () => {
    installMockClock()

    it('does not preview a side before half the commit distance', () => {
      const { container } = render(<Harness />)
      const card = getCard(container)
      touchStart(card, 0, 0)
      advanceClock(50)
      touchMove(card, 30, 0) // resolves the axis horizontal
      touchMove(card, 50, 0) // still below half of the 120px commit distance (60px)

      expect(screen.getByText('Race condition').className).not.toContain('--previewing')
      expect(screen.getByText('Thread-safe').className).not.toContain('--previewing')
    })

    it('previews the dragged-toward side once past half the commit distance', () => {
      const { container } = render(<Harness />)
      const card = getCard(container)
      touchStart(card, 0, 0)
      advanceClock(50)
      touchMove(card, 30, 0)
      touchMove(card, 61, 0) // just past half of 120px

      expect(screen.getByText('Race condition').className).toContain('--previewing')
    })

    it('keeps previewing all the way out to the real commit distance, not just partway there', () => {
      const { container } = render(<Harness />)
      const card = getCard(container)
      touchStart(card, 0, 0)
      advanceClock(50)
      touchMove(card, 30, 0)
      touchMove(card, 120, 0) // exactly the real commit distance

      expect(screen.getByText('Race condition').className).toContain('--previewing')
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

  it('arrow-key navigation moves focus between the two fallback buttons', () => {
    render(<Harness />)
    const leftButton = screen.getByRole('button', { name: puzzle.left_label })
    const rightButton = screen.getByRole('button', { name: puzzle.right_label })

    leftButton.focus()
    fireEvent.keyDown(leftButton, { key: 'ArrowRight' })
    expect(document.activeElement).toBe(rightButton)

    fireEvent.keyDown(rightButton, { key: 'ArrowLeft' })
    expect(document.activeElement).toBe(leftButton)
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

    it('survives setPointerCapture throwing NotFoundError instead of losing the rest of the drag (live-caught, 2026-08-19)', () => {
      // jsdom has no setPointerCapture at all (feature-detected away — see
      // setPointerCaptureIfSupported's doc comment), so this installs one
      // that reproduces the actual live failure mode caught in this app's
      // own console: a real browser throws NotFoundError if `pointerId`
      // doesn't match a pointer it currently considers "active" at the
      // moment of the call. Uncaught, this used to abort the rest of
      // handlePointerMove — including x.set(dx) — for the remainder of the
      // gesture. `vi.spyOn` can't target this (jsdom has no existing method
      // to spy on), so it's a plain assignment, cleaned up manually since
      // `installMockClock`'s `vi.restoreAllMocks()` only undoes real spies.
      HTMLElement.prototype.setPointerCapture = () => {
        throw new DOMException('No active pointer with the given id is found.', 'NotFoundError')
      }
      try {
        const onCommit = vi.fn()
        const { container } = render(<Harness onCommit={onCommit} />)
        const card = getCard(container)
        pointerDown(card, 0, 0)
        advanceClock(175)
        pointerMove(card, 30, 0) // resolves horizontal -> setPointerCapture throws here
        advanceClock(175)
        pointerMove(card, 180, 0)
        pointerUp(card, 180, 0)
        expect(onCommit).toHaveBeenCalledWith({ correct: true, choiceIndex: null })
      } finally {
        delete (HTMLElement.prototype as { setPointerCapture?: unknown }).setPointerCapture
      }
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
