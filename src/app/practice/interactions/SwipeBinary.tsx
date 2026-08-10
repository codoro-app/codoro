import { useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { animate, motion, useMotionValue, useMotionValueEvent, useTransform } from 'framer-motion'
import type { InteractionBodyProps } from '../interactionTypes'
import type { SwipeBinaryPuzzle } from '../../../content'
import type { AnswerState } from '../answerState'
import {
  DEFAULT_SWIPE_THRESHOLD,
  resolveSwipeCommit,
  signedVelocityFromGesture,
} from '../gestureThreshold'
import type { SwipeCommitDirection } from '../gestureThreshold'
import { highlightSnippet } from '../highlightSnippet'
import { CodeSnippet } from '../CodeSnippet'
import { useGestureDebugOverlay } from './useGestureDebugOverlay'

/**
 * How far offscreen (px) the card animates on a successful drag commit —
 * comfortably past any realistic viewport width so the fly-off reads as
 * "gone" before it resets back to center to show the answered state.
 *
 * This is a purely visual flourish: committing (calling `onCommit`, which
 * fires a rating update) happens synchronously the instant
 * `resolveSwipeCommit` says so, and is never gated on this animation
 * actually completing — environments with no frame loop (this component's
 * own jsdom tests included; see SwipeBinary.test.tsx) must not be able to
 * block or delay a commit.
 */
const FLY_OUT_DISTANCE = 600

/**
 * Drag distance (px) over which the card fully tilts and the "about to
 * pick this side" preview kicks in. Deliberately smaller than
 * `DEFAULT_SWIPE_THRESHOLD.minDistance` so the card visibly leans toward a
 * side well before the drag would actually satisfy the commit threshold —
 * this is live feedback ("if you let go around here, roughly this"), not
 * the commit decision itself, which is entirely `gestureThreshold.ts`'s
 * job and only runs once, at drag-end.
 */
const PREVIEW_RANGE = 90
const MAX_TILT_DEG = 10

/**
 * Movement (px, either axis) the gesture must travel before this component
 * will call it horizontal or vertical. Carried over verbatim from the
 * `axisThreshold: { touch: 20 }` the previous `@use-gesture` implementation
 * used, and for the same reason: a real touchscreen's very first move sample
 * very often has a slightly larger vertical than horizontal component
 * (finger jitter, a not-quite-flat swipe angle), so deciding the axis off
 * that first sample locks a genuine horizontal swipe to 'vertical' and drops
 * it. 20px of travel is enough for the dominant axis of a deliberate gesture
 * to be unambiguous, while still being small enough that a vertical scroll
 * feels immediate.
 */
const AXIS_TOLERANCE = 20

/**
 * Whether this gesture has been decided to be a horizontal card drag, a
 * vertical gesture we hand back to the browser's native scrolling, or is
 * still too small to call.
 */
type AxisResolution = 'ambiguous' | 'horizontal' | 'vertical-yielded'

/**
 * Feature-detected pointer capture (same guard, and same reason, as
 * DragOrder.tsx's): every real browser target implements it, jsdom does not,
 * and `typeof` rather than optional chaining because
 * `@typescript-eslint/no-unnecessary-condition` rejects the latter against
 * lib.dom's always-present typing.
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
 * `left_label` / `right_label` as hints plus two labelled side buttons
 * (danger-bordered left, success-bordered right) that commit directly on
 * click/tap — the desktop/tap fallback the locked design requires. A click
 * never goes through the drag-threshold math below; it commits immediately.
 *
 * On top of that fallback, the whole card — the syntax-highlighted snippet
 * plus the buttons row below it — is a single drag surface (the
 * "Tinder-style card" the brief calls for): it tilts and previews a side as
 * the user drags, springs back to center below threshold, and flies off in
 * the drag direction (then resets to center to show the reveal) once
 * `resolveSwipeCommit` (gestureThreshold.ts) says the drag both traveled far
 * enough AND was released fast enough, in the same direction. Rendering the
 * snippet here (rather than PuzzleCardShell's usual static copy) is what
 * lets it move with the drag; see PuzzleCardShell's `staticLines` doc
 * comment.
 *
 * ## Gesture plumbing: native Pointer Events (v3 Phase 0, OD-1)
 *
 * The drag used to be `@use-gesture/react`'s `useDrag`. OD-1 ("normal-speed
 * or slightly-diagonal swipes do nothing on iPhone; only fast, purely
 * horizontal flicks commit") survived five fix rounds against that
 * implementation — 32ms kinematics staleness, zero touch `axisThreshold`,
 * `touch-action: none`, then the corrected `pan-y` + `preventScroll`, whose
 * `preventScrollAxis` the library's own docs label experimental. Each round
 * found a real mechanism; none fixed the device.
 *
 * So the gesture DETECTION is now hand-rolled on raw Pointer Events,
 * mirroring DragOrder.tsx — the sibling interaction that has always worked
 * reliably on the same phone. The Framer Motion visual layer (`x`,
 * `rotate`, `animate`) and every commit decision (`gestureThreshold.ts`,
 * untouched) are unchanged; only what feeds `x` changed. What we inherit
 * from DragOrder:
 *
 * 1. **`touch-action` is static.** `none` is declared in practice.css AND
 *    in the inline style below, and is never assigned at runtime by any code
 *    path. A browser commits a touch to native scroll vs. custom gesture at
 *    hit-test time, BEFORE any JS handler runs, so a runtime-toggled
 *    `touch-action` is structurally too late no matter how early the toggle
 *    fires.
 * 2. **Explicit axis arbitration in JS**, below — the "is this a scroll or a
 *    swipe" decision made by our own code on our own samples, inspectable
 *    and testable, rather than delegated to a library's experimental path.
 * 3. **`pointercancel` / `lostpointercapture` both reset**, so a gesture
 *    the browser takes away from us can never leave the card stuck
 *    off-center.
 *
 * ### OD-2 (v3 Phase 0): why `touch-action` is `none`, not `pan-y`, and the
 * page scroll is now forwarded manually
 *
 * The first version of this rewrite used `pan-y` (this card fills the
 * practice view, so `none` — a hard block on ALL native panning starting
 * here — would have stranded a player mid-scroll, same reasoning DragOrder's
 * *handle* doesn't need to worry about since its *row* stays `pan-y`).
 * Thomas's on-device capture (iPhone 15 Pro, real production preview,
 * `?gesture-debug=1`) falsified that design: a clean, purely-horizontal drag
 * — axis correctly resolved `horizontal`, `preventDefault()` called
 * successfully on every move, `cancelable` never once false — still got a
 * `pointercancel` one frame later. Under `pan-y`, WebKit's native pan
 * gesture recognizer runs in parallel with JS and can independently decide
 * to claim the touch and cancel our pointer stream — that authority comes
 * from `pan-y` itself granting it permission to pan vertically at all, and
 * is not gated on whether individual `pointermove` events had
 * `preventDefault()` called on them. Consistently succeeding at
 * `preventDefault()` (which the capture shows we were) cannot revoke a
 * `touch-action` value's grant.
 *
 * So: `touch-action: none` removes WebKit's competing recognizer from the
 * picture for both axes, and this component takes over ALL of scrolling for
 * touches that start on the card — `window.scrollBy` in the
 * `vertical-yielded` branch below, driven by the same per-frame `dy` this
 * component already reads. Real trade-off, accepted rather than hidden: this
 * is a plain `scrollBy`, not a physics simulation, so a vertical swipe on
 * the card loses the OS's native momentum/inertia and elastic overscroll
 * bounce that scrolling anywhere else on the page still has. Flagged, not
 * fixed, in v3 Phase 0 — see the amendment in docs/v3-build-plan.md.
 *
 * ### OD-3 (v3 Phase 0): explicit pointer capture is skipped for touch
 * entirely, not just deferred
 *
 * DragOrder captures at pointerdown, unconditionally; this component used to
 * defer capture until the axis resolved horizontal, and now — per a second
 * on-device capture — never explicitly captures touch at all:
 *
 * - **The actual OD-3 finding**: that second capture showed WebKit firing
 *   `lostpointercapture` within 0-13ms of the `setPointerCapture()` call, on
 *   every horizontal-resolving touch gesture (3 of 3) — not a
 *   `pointercancel`, and not this component's own code (which only releases
 *   from `pointerup`/`pointercancel`/`lostpointercapture` itself). This
 *   component's `handleLostPointerCapture` then read that as "gesture over"
 *   and sprang the card back to center mid-drag, while the finger was still
 *   down — very likely the reported "jumpy" feeling itself. Per Pointer
 *   Events Level 3's implicit pointer capture, touch pointers are captured
 *   to the pointerdown target automatically, without any explicit call —
 *   so the explicit call here was pure redundancy, on a pointer WebKit
 *   already owned, and WebKit's handling of that redundant call is what
 *   produced the spurious `lostpointercapture`. Fix: skip the explicit call
 *   for `event.pointerType === 'touch'` entirely; implicit capture still
 *   covers it.
 * - Capturing at pointerdown (mouse/pen only, now) would still break the
 *   tap-fallback buttons if applied to touch: they live INSIDE this drag
 *   surface (DragOrder's rows contain no buttons), and an active pointer
 *   capture makes Chromium retarget the subsequent `click` to the capturing
 *   element — the card — so the buttons' own `onClick` would never fire.
 *   Moot for touch now that it's never captured; still the reason mouse/pen
 *   capture (if it ever happens) stays deferred to axis-resolution rather
 *   than moving to pointerdown.
 *
 * Note what is NOT the reason: capturing early would not "fight" the scroll
 * arbitration. Pointer capture only retargets pointer events — under
 * `touch-action: none` there is no native scroll left to fight in the first
 * place (see OD-2 above); if a gesture is cancelled for some other reason
 * (`pointercancel`) capture is implicitly dropped regardless.
 *
 * ### The axis arbitration itself
 *
 * Per gesture, from the pointerdown origin:
 *
 * - **Ambiguous** while `|dx| < AXIS_TOLERANCE && |dy| < AXIS_TOLERANCE`: do
 *   nothing at all — under `touch-action: none` there is no native default
 *   to suppress or allow either way, so this window exists only to decide
 *   which axis the gesture belongs to, not to referee against the browser.
 * - The first sample past the tolerance in either axis decides: `|dx| >
 *   |dy|` → **horizontal**, else **vertical-yielded** (ties go to vertical —
 *   the safer default for a page that must stay scrollable).
 * - **Horizontal**: `preventDefault()` on that event and every later move of
 *   the gesture (belt-and-suspenders under `none`, which already blocks any
 *   native default); take pointer capture; track `x` 1:1. The `cancelable`
 *   field is still logged to the debug overlay — useful evidence if a future
 *   defect resembles OD-1/OD-2's shape again.
 * - **Vertical-yielded**: forward the raw `dy` to `window.scrollBy` every
 *   move (OD-2, above) instead of relying on a native scroll that
 *   `touch-action: none` no longer permits; never move `x`; never commit.
 *
 * Only pointerup can commit, and only from the horizontal state.
 *
 * ### Timing source
 *
 * `elapsedTime` for `signedVelocityFromGesture` is measured with
 * `performance.now()` read inside the pointerdown/pointerup handlers, not
 * from `event.timeStamp`. `timeStamp` would be marginally more precise (it
 * predates any handler-dispatch delay) but is read-only and not settable
 * through RTL's `fireEvent`, which would make every timing-dependent case in
 * SwipeBinary.test.tsx — including the 32ms-staleness regression — untestable.
 * The difference is at most a frame or so over a ~350ms gesture, far inside
 * `minVelocity`'s margin.
 *
 * `CommitPayload.choiceIndex` is `null` for swipe-binary by contract — but
 * since this is a strictly binary choice, `correct` + `puzzle.correct_direction`
 * is always enough to reconstruct which side was actually picked, so no
 * additional field is needed to render "you picked X" post-commit.
 */
export function SwipeBinary({
  puzzle,
  committed,
  committedPayload,
  onCommit,
}: InteractionBodyProps<SwipeBinaryPuzzle>) {
  const lines = useMemo(
    () => highlightSnippet(puzzle.snippet, puzzle.language),
    [puzzle.snippet, puzzle.language],
  )

  const handlePick = (direction: 'left' | 'right') => {
    if (committed) return
    onCommit({ correct: direction === puzzle.correct_direction, choiceIndex: null })
  }

  const chosenDirection: 'left' | 'right' | null =
    committed && committedPayload
      ? committedPayload.correct
        ? puzzle.correct_direction
        : puzzle.correct_direction === 'left'
          ? 'right'
          : 'left'
      : null

  const stateFor = (direction: 'left' | 'right'): AnswerState => {
    if (!committed || !committedPayload) return 'default'
    if (direction === chosenDirection) return committedPayload.correct ? 'correct' : 'wrong'
    if (direction === puzzle.correct_direction) return 'reveal-correct'
    return 'default'
  }

  // `previewDirection` mirrors resolveSwipeCommit's return shape, but it is
  // NOT a commit decision — it only drives the live "you're about to pick
  // this side" highlight while the drag is in flight, at a smaller range
  // than the real commit threshold (see PREVIEW_RANGE above). The actual
  // commit decision is made once, at drag-end, by resolveSwipeCommit.
  const [previewDirection, setPreviewDirection] = useState<SwipeCommitDirection>(null)

  const classFor = (direction: 'left' | 'right') => {
    const state = stateFor(direction)
    return [
      'swipe-fallback__button',
      `swipe-fallback__button--${direction}`,
      state !== 'default' && `swipe-fallback__button--${state}`,
      !committed && previewDirection === direction && 'swipe-fallback__button--previewing',
    ]
      .filter(Boolean)
      .join(' ')
  }

  const x = useMotionValue(0)
  const rotate = useTransform(x, [-PREVIEW_RANGE, PREVIEW_RANGE], [-MAX_TILT_DEG, MAX_TILT_DEG], {
    clamp: true,
  })

  useMotionValueEvent(x, 'change', (latest) => {
    if (latest <= -PREVIEW_RANGE / 2) setPreviewDirection('left')
    else if (latest >= PREVIEW_RANGE / 2) setPreviewDirection('right')
    else setPreviewDirection(null)
  })

  const springBackToCenter = () => {
    void animate(x, 0, { type: 'spring', stiffness: 500, damping: 30 })
  }

  // TEMPORARY, dev-flagged (`?gesture-debug=1`) on-screen capture — v3
  // Phase 0 instrumentation for OD-1; see useGestureDebugOverlay.tsx. A
  // no-op (and renders nothing) without the flag.
  const debug = useGestureDebugOverlay()

  // The pointerId of the single gesture currently owning the card, or null
  // between gestures — a second finger landing mid-drag must not hijack or
  // interleave with the first's move/up events (DragOrder.tsx's convention).
  const activePointerIdRef = useRef<number | null>(null)
  const startXRef = useRef(0)
  const startYRef = useRef(0)
  const lastYRef = useRef(0)
  const startTimeRef = useRef(0)
  const axisRef = useRef<AxisResolution>('ambiguous')
  const capturedRef = useRef(false)

  const resetGesture = () => {
    activePointerIdRef.current = null
    axisRef.current = 'ambiguous'
    capturedRef.current = false
  }

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (committed) return
    if (activePointerIdRef.current !== null) return
    activePointerIdRef.current = event.pointerId
    startXRef.current = event.clientX
    startYRef.current = event.clientY
    lastYRef.current = event.clientY
    startTimeRef.current = performance.now()
    axisRef.current = 'ambiguous'
    capturedRef.current = false
    debug.log({
      type: 'down',
      x: event.clientX,
      y: event.clientY,
      cancelable: event.cancelable,
      axis: 'ambiguous',
      prevented: false,
    })
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (committed) return
    if (event.pointerId !== activePointerIdRef.current) return

    const dx = event.clientX - startXRef.current
    const dy = event.clientY - startYRef.current

    if (axisRef.current === 'ambiguous') {
      if (Math.abs(dx) < AXIS_TOLERANCE && Math.abs(dy) < AXIS_TOLERANCE) {
        // Still too small to call — deliberately inert (no preventDefault),
        // so a genuinely vertical touch stays free to become a native scroll.
        debug.log({
          type: 'move',
          x: event.clientX,
          y: event.clientY,
          cancelable: event.cancelable,
          axis: 'ambiguous',
          prevented: false,
        })
        return
      }
      axisRef.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical-yielded'
      // OD-3 (v3 Phase 0): touch pointers get IMPLICIT capture on
      // pointerdown per spec (see the component doc comment) — this
      // explicit call is only needed for mouse/pen, which don't. A second
      // on-device capture showed WebKit firing `lostpointercapture` within
      // 0-13ms of this call on every horizontal-resolving touch gesture
      // (3 of 3), which this component's own handler then reads as
      // "gesture over" and springs the card back mid-drag — an explicit
      // capture call WebKit doesn't need, on a pointer it already owns.
      if (
        axisRef.current === 'horizontal' &&
        !capturedRef.current &&
        event.pointerType !== 'touch'
      ) {
        setPointerCaptureIfSupported(event.currentTarget, event.pointerId)
        capturedRef.current = true
      }
    }

    if (axisRef.current === 'vertical-yielded') {
      // Forwarded manually — see the component doc comment's "OD-2" section
      // for why native scroll can no longer do this. `window.scrollBy` (not
      // the nearest scrollable ancestor) because this app has none: page
      // scroll is the document's own, confirmed by grep (no `overflow-y`
      // rule anywhere in the practice route's CSS).
      const deltaY = event.clientY - lastYRef.current
      lastYRef.current = event.clientY
      window.scrollBy(0, -deltaY)
      if (event.cancelable) event.preventDefault()
      debug.log({
        type: 'move',
        x: event.clientX,
        y: event.clientY,
        cancelable: event.cancelable,
        axis: 'vertical-yielded',
        prevented: event.cancelable,
        note: `manual scrollBy(0, ${String(Math.round(-deltaY))})`,
      })
      return
    }

    // Horizontal: claim the gesture. A non-cancelable event means the
    // browser already committed this touch to scrolling before JS could
    // object — OD-1's suspected mechanism, so it is logged rather than
    // silently swallowed.
    const canPrevent = event.cancelable
    if (canPrevent) event.preventDefault()
    x.set(dx)
    debug.log({
      type: 'move',
      x: event.clientX,
      y: event.clientY,
      cancelable: event.cancelable,
      axis: 'horizontal',
      prevented: canPrevent,
      note: canPrevent ? `dx=${String(Math.round(dx))}` : 'NOT CANCELABLE — scroll already claimed',
    })
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== activePointerIdRef.current) return

    const axis = axisRef.current
    const dx = event.clientX - startXRef.current
    const elapsedTime = performance.now() - startTimeRef.current
    const wasCaptured = capturedRef.current
    const target = event.currentTarget

    // Reset before releasing capture: releasing synthesizes a
    // `lostpointercapture`, and by then this gesture must already read as
    // finished so that handler no-ops instead of springing an in-flight
    // commit animation back to center.
    resetGesture()
    if (wasCaptured) releasePointerCaptureIfSupported(target, event.pointerId)

    if (committed || axis !== 'horizontal') {
      // Nothing to spring back: `x` is only ever moved from the horizontal
      // branch above, so an ambiguous/yielded gesture left it at 0.
      debug.log({
        type: 'up',
        x: event.clientX,
        y: event.clientY,
        cancelable: event.cancelable,
        axis,
        prevented: false,
        note: 'no commit (gesture never resolved horizontal, or already committed)',
      })
      return
    }

    // Signed velocity averaged over the WHOLE gesture (movement /
    // elapsedTime) — see signedVelocityFromGesture's doc comment in
    // gestureThreshold.ts for the real-hardware bug (a pause before release
    // collapsing a final-frame velocity to ~0) that averaging sidesteps.
    const velocityX = signedVelocityFromGesture({ movement: dx, elapsedTime })
    const commitDirection = resolveSwipeCommit({ dx, velocityX }, DEFAULT_SWIPE_THRESHOLD)

    debug.log({
      type: 'up',
      x: event.clientX,
      y: event.clientY,
      cancelable: event.cancelable,
      axis: 'horizontal',
      prevented: false,
      note: `dx=${String(Math.round(dx))} t=${String(Math.round(elapsedTime))}ms v=${velocityX.toFixed(3)} -> ${commitDirection ?? 'no commit'}`,
    })

    setPreviewDirection(null)

    if (commitDirection) {
      handlePick(commitDirection)
      void animate(x, commitDirection === 'right' ? FLY_OUT_DISTANCE : -FLY_OUT_DISTANCE, {
        duration: 0.22,
        ease: 'easeIn',
      }).then(() => {
        x.set(0)
      })
    } else {
      springBackToCenter()
    }
  }

  /** A gesture the browser took away (native scroll claimed it, a system gesture interrupted it): drop everything and settle the card back to center — never leave it stuck off-center. */
  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== activePointerIdRef.current) return
    const wasCaptured = capturedRef.current
    const target = event.currentTarget
    resetGesture()
    if (wasCaptured) releasePointerCaptureIfSupported(target, event.pointerId)
    setPreviewDirection(null)
    springBackToCenter()
    debug.log({
      type: 'cancel',
      x: event.clientX,
      y: event.clientY,
      cancelable: event.cancelable,
      axis: 'ambiguous',
      prevented: false,
      note: 'gesture cancelled — reset to center',
    })
  }

  /**
   * A capture the card never releases itself (the browser reassigns it
   * mid-gesture) would otherwise leave the card stuck mid-drag, since no
   * pointerup would ever arrive. Only clears state — does NOT call
   * `releasePointerCaptureIfSupported`, since releasing a capture that is
   * already gone throws `NotFoundError` in real browsers (DragOrder.tsx's
   * same recovery rule).
   */
  const handleLostPointerCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerId !== activePointerIdRef.current) return
    resetGesture()
    setPreviewDirection(null)
    springBackToCenter()
    debug.log({
      type: 'lostcapture',
      x: event.clientX,
      y: event.clientY,
      cancelable: event.cancelable,
      axis: 'ambiguous',
      prevented: false,
      note: 'capture lost — reset to center',
    })
  }

  return (
    <div className="swipe-fallback">
      <p className="swipe-fallback__hint">Drag the card, or tap a button.</p>
      <motion.div
        className="swipe-fallback__card"
        // STATIC, never assigned at runtime — see the component doc
        // comment's point 1 and the OD-2 section. Duplicated from
        // practice.css's own `.swipe-fallback__card { touch-action: none }`
        // because jsdom only reflects inline styles, so this copy is the one
        // the test suite can actually assert on; keep the two in sync by hand.
        style={{ x, rotate, touchAction: 'none' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onLostPointerCapture={handleLostPointerCapture}
      >
        <CodeSnippet lines={lines} />
        <div className="swipe-fallback__buttons">
          <button
            type="button"
            className={classFor('left')}
            onClick={() => {
              handlePick('left')
            }}
            disabled={committed}
          >
            {puzzle.left_label}
          </button>
          <button
            type="button"
            className={classFor('right')}
            onClick={() => {
              handlePick('right')
            }}
            disabled={committed}
          >
            {puzzle.right_label}
          </button>
        </div>
      </motion.div>
      {debug.overlay}
    </div>
  )
}
