import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { animate, motion, useMotionValue, useMotionValueEvent, useTransform } from 'framer-motion'
import type { MotionValue } from 'framer-motion'
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
 * Drag distance (px) over which the card tilts and the "about to pick this
 * side" preview kicks in — locked to `DEFAULT_SWIPE_THRESHOLD.minDistance`
 * (gestureThreshold.ts), the actual commit distance, as a single source of
 * truth. Was a smaller, independent constant (90px) that let the card reach
 * full tilt and full preview color a full 30px before the real 120px
 * commit threshold — a user who watched the card visually "finish leaning"
 * and released there got no additional feedback for the remaining ~25% of
 * the required drag, and often no commit at all (mobile bug report,
 * 2026-08-18). Tying the two together means full tilt now coincides with
 * the point a release would actually satisfy the distance half of
 * `resolveSwipeCommit` — this is still a distance-only approximation
 * (velocity is unknowable until release), so a slow drag that reaches full
 * tilt can still fail to commit if released too slowly; that's a
 * pre-existing limitation of any distance-based preview, not new here. The
 * commit decision itself is still entirely `gestureThreshold.ts`'s job and
 * only runs once, at drag-end — this constant only drives the live visual.
 */
const PREVIEW_RANGE = DEFAULT_SWIPE_THRESHOLD.minDistance
const MAX_TILT_DEG = 10

/**
 * Movement (px, either axis) the gesture must travel before this component
 * will call it horizontal or vertical. Carried over verbatim from the
 * `axisThreshold: { touch: 20 }` the original `@use-gesture` implementation
 * used, and for the same reason: a real touchscreen's very first move sample
 * very often has a slightly larger vertical than horizontal component
 * (finger jitter, a not-quite-flat swipe angle), so deciding the axis off
 * that first sample locks a genuine horizontal swipe to 'vertical' and drops
 * it. 20px of travel is enough for the dominant axis of a deliberate gesture
 * to be unambiguous, while still being small enough to feel immediate.
 */
const AXIS_TOLERANCE = 20

/**
 * Longest gap (ms) a claimed gesture is allowed to go without a terminating
 * `touchend`/`touchcancel`/`pointerup`/`pointercancel`/`lostpointercapture`
 * before `forceResetGesture` below assumes the browser dropped it and
 * recovers on its own. Re-armed on every accepted move, so this is measured
 * from the LAST move, not gesture start — a genuinely slow, deliberate drag
 * that's still actively moving never trips it.
 *
 * Mobile bug report, 2026-08-19: live-reproduced (desktop Chrome, synthetic
 * PointerEvents: pointerdown + a few pointermoves past the tilt threshold,
 * then withholding pointerup entirely) that this component's gesture state
 * machine has no recovery path if the terminating event never arrives — the
 * card freezes at whatever tilt it last reached, `translateX`/`rotate`
 * inline styles stuck, and EVERY subsequent gesture attempt is silently
 * ignored forever (the claiming ref — `activeTouchIdRef`/
 * `activePointerIdRef` — never clears), because `onTouchStart`/
 * `handlePointerDown` both bail out early while a ref is still claimed. This
 * matches the reported symptom exactly ("pauses and stays tilted, doesn't
 * snap back or confirm") and needs no on-device capture to confirm: it's a
 * structural gap, not a specific browser quirk — the whole state machine
 * assumes a terminating event always eventually arrives, which is exactly
 * the assumption OD-1 through OD-5 (this file's own doc comment) found five
 * separate real ways to be false for touch specifically. This ceiling is a
 * safety net that makes "permanently stuck" impossible regardless of WHY a
 * terminating event went missing — dropped by a WebKit gesture-recognizer
 * race (OD-1..OD-5's territory), the app losing focus/being backgrounded
 * mid-drag (also handled instantly, not via this timeout — see the
 * `visibilitychange`/`blur` listeners below), or any other cause — without
 * needing to identify the exact mechanism first.
 *
 * 2000ms: generously past the ~300-500ms a real complete gesture takes in
 * this file's own tests (including the deliberate-pause-before-release
 * regression, which pauses 200ms) so it never fires mid-legitimate-drag, while
 * still recovering well within what would otherwise read as "broken".
 */
const GESTURE_WATCHDOG_MS = 2000

/** Whether this gesture has been decided to be a horizontal card drag, a vertical one (ignored — see OD-5), or is still too small to call. */
type AxisResolution = 'ambiguous' | 'horizontal' | 'vertical'

/**
 * Feature-detected pointer capture (same guard, and same reason, as
 * DragOrder.tsx's): every real browser target implements it, jsdom does not,
 * and `typeof` rather than optional chaining because
 * `@typescript-eslint/no-unnecessary-condition` rejects the latter against
 * lib.dom's always-present typing. Mouse/pen only now — see OD-5 below for
 * why touch never uses this.
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
 * The `Touch` in `list` whose `identifier` matches `id`, or `null` if it
 * isn't present (a different finger changed, not the one this gesture is
 * tracking). Reads via `.item()` when present, falling back to bracket
 * indexing otherwise — real `TouchList`s support both, but jsdom has no
 * `TouchList` at all, so SwipeBinary.test.tsx's synthesized touch lists may
 * be plain arrays without `.item()`. `typeof` rather than optional chaining
 * because `@typescript-eslint/no-unnecessary-condition` rejects the latter
 * against lib.dom's always-present typing (same reasoning as
 * `setPointerCaptureIfSupported` above).
 */
function findTouchById(list: TouchList, id: number): Touch | null {
  for (let i = 0; i < list.length; i++) {
    let touch: Touch | null
    if (typeof list.item === 'function') {
      touch = list.item(i)
    } else {
      touch = list[i] ?? null
    }
    if (touch?.identifier === id) return touch
  }
  return null
}

/**
 * The nearest `.code-snippet` ancestor of `target` (inclusive), but ONLY
 * when it's currently in `code-snippet--scrollable` state — i.e. its own
 * auto-shrink already hit the floor and it still doesn't fit, so it has a
 * real competing horizontal scroll to protect. Returns `null` for a touch
 * anywhere else on the card, or on a snippet that isn't overflowing (the
 * common case — most snippets fit; see the component doc comment's touch
 * scroll-forwarding note below for why this is gated, not unconditional).
 *
 * Mobile bug report, 2026-08-18: without this, a long code line inside a
 * swipe-binary card shows CodeSnippet's own "scrollable" fade cue but a
 * touch there can never actually scroll it — the card's whole-surface
 * `touch-action: none` + unconditional `preventDefault()` (OD-5, below)
 * makes the snippet's effective touch-action `none` too (CSS Touch Action's
 * ancestor/descendant restrictions compose — a descendant can't loosen an
 * ancestor's `none`), so simply skipping `preventDefault()` for a
 * snippet-origin touch would NOT hand it back to native scroll; it would
 * just go dead. The fix is JS-driven manual forwarding (see
 * `onTouchMove`'s `snippetElRef` branch below), not a CSS/touch-action
 * change.
 */
function scrollableSnippetAncestor(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const snippet = target.closest('.code-snippet')
  if (!(snippet instanceof HTMLElement)) return null
  return snippet.classList.contains('code-snippet--scrollable') ? snippet : null
}

/**
 * Whether `target` is (or is inside) one of the two `.swipe-fallback__button`
 * tap-fallback buttons rendered inside the drag surface.
 *
 * Mobile bug report, 2026-08-19: `onTouchStart` below calls
 * `preventDefault()` unconditionally on every touch anywhere on the card,
 * buttons included (OD-5's whole point — see the component doc comment). Per
 * spec, a `touchstart` whose default is prevented suppresses the browser's
 * synthesized `click` for that touch, so on a real touch device tapping
 * either button fired no `click` and `handlePick` never ran — the buttons
 * rendered and looked tappable but silently did nothing. Neither existing
 * test suite caught it: SwipeBinary.test.tsx's tap-fallback tests dispatch
 * `click` directly (never touch), and every touch test dispatches
 * `touchStart` directly on the card element, so `event.target` was always
 * `card`, never a button.
 *
 * Fix: a button-origin touch skips the card's claim entirely (see its use in
 * `onTouchStart`) — no `preventDefault()`, no `activeTouchIdRef` — so the
 * browser's normal touch-to-click synthesis reaches the button unobstructed.
 * This makes the buttons tap-only, matching how they already behave for
 * mouse/pen (a mouse press on a button was never treated as a drag-start
 * either): starting a touch on a button and then dragging elsewhere on the
 * card does not swipe it.
 */
function fallbackButtonAncestor(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null
  const button = target.closest('.swipe-fallback__button')
  return button instanceof HTMLElement ? button : null
}

/**
 * Shared tail of both commit paths (touch's `onTouchEnd`, mouse's
 * `handlePointerUp`) — flies the card offscreen, then resets its position
 * once safely invisible instead of teleporting it back to center in full
 * view (the mobile "jump-cut" bug report, 2026-08-18: the old reset was a
 * bare `x.set(0)` with no transition at all, landing on the same frame the
 * feedback panel/sticky CTA mount below it). `opacity` fades out over the
 * SAME 0.22s/easeIn as the fly-off, reaching ~0 right as `x` reaches
 * `FLY_OUT_DISTANCE`, so the position reset happens while the card is
 * already transparent — then fades back in over a short 0.15s, reading as a
 * deliberate settle rather than an abrupt reappearance.
 */
function commitFlyOff(
  x: MotionValue<number>,
  opacity: MotionValue<number>,
  direction: 'left' | 'right',
): void {
  const distance = direction === 'right' ? FLY_OUT_DISTANCE : -FLY_OUT_DISTANCE
  void animate(opacity, 0, { duration: 0.22, ease: 'easeIn' })
  void animate(x, distance, { duration: 0.22, ease: 'easeIn' }).then(() => {
    x.set(0)
    void animate(opacity, 1, { duration: 0.15, ease: 'easeOut' })
  })
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
 * ## Gesture plumbing history (v3 Phase 0, OD-1) — four device-capture
 * rounds, four different real mechanisms, in order:
 *
 * 1. **OD-1 → OD-2**: the original rewrite used `@use-gesture/react`, then
 *    native Pointer Events with `touch-action: pan-y` (letting native scroll
 *    handle a vertical-resolving gesture). A real on-device capture showed
 *    WebKit's native pan recognizer independently claiming and
 *    `pointercancel`-ing a touch under `pan-y`, regardless of whether JS was
 *    successfully calling `preventDefault()` on every move. Fixed by
 *    switching to `touch-action: none` and manually forwarding vertical
 *    movement via `window.scrollBy`.
 * 2. **OD-3**: a second capture showed `lostpointercapture` firing 0-13ms
 *    after this component's explicit `setPointerCapture()` call on every
 *    horizontal-resolving touch gesture — redundant, since touch pointers
 *    get *implicit* capture on `pointerdown` per spec; WebKit's handling of
 *    the redundant call produced the spurious loss. Fixed by skipping the
 *    explicit call for touch.
 * 3. **OD-4 (candidate, disproven)**: a third capture showed gestures now
 *    dying to plain `pointercancel` instead of `pointerup`. Hypothesized the
 *    debug overlay's own per-event `setState` call — synchronous inside the
 *    `pointermove` handler — was slow enough to trigger iOS's
 *    cancel-if-unresponsive behavior; batched it to one `requestAnimationFrame`
 *    flush. A fourth capture showed the exact same `pointercancel` pattern
 *    persisting (one gesture reached 175px of travel, nearly 3× the commit
 *    threshold, and still never reached `pointerup`) — the hypothesis did
 *    not hold, and is left in the git history as a real, honestly-labeled,
 *    disproven attempt rather than erased.
 *
 * ## OD-5: native Touch Events, matching react-tinder-card's proven pattern
 *
 * Four rounds of fixing the Pointer-Events-plus-`touch-action` model each
 * found a real mechanism and none stopped WebKit from eventually taking the
 * gesture back. Per the "3+ fixes revealing a new problem in the same place
 * means question the architecture" rule, the next step was reading a proven
 * reference implementation rather than a fifth hypothesis:
 * [`react-tinder-card`](https://github.com/3DJakob/react-tinder-card)'s
 * actual source (`index.js`) — the most directly comparable, widely-used,
 * production-tested library for exactly this UI pattern — does NOT use
 * Pointer Events, does NOT set `touch-action` at all, and calls
 * `preventDefault()` **unconditionally at `touchstart`**, before the axis is
 * even known, rather than deferring the decision into the gesture the way
 * every round above did. That front-loads "this touch is mine" to the
 * earliest possible moment instead of racing WebKit's own recognizer
 * mid-gesture — the race every prior round lost in a different way.
 *
 * This component now follows that pattern for touch specifically:
 *
 * 1. **Raw native `touchstart`/`touchmove`/`touchend`/`touchcancel`
 *    listeners**, attached via `useEffect` + `addEventListener` with
 *    `{ passive: false }` — NOT React's synthetic `onTouchStart` props.
 *    React makes `touchstart`/`touchmove` passive by default at its root
 *    listener (matching browser scroll-performance guidance), which would
 *    make `preventDefault()` silently no-op; `react-tinder-card`'s own use
 *    of raw `addEventListener` isn't incidental. Listeners are attached once
 *    (mount-only effect) and read `committed`/`handlePick` through refs kept
 *    current each render, so they never need to be torn down and
 *    re-attached mid-gesture.
 * 2. **`preventDefault()` on `touchstart`, unconditionally** (still checked
 *    against `cancelable` defensively) — before axis arbitration, before any
 *    branch. `touch-action: none` stays set too, as a second, independent
 *    layer (a browser decides scroll-vs-gesture at hit-test time, before any
 *    JS runs, so it's still the first line of defense even though it wasn't
 *    sufficient alone in OD-2/OD-3/OD-4's rounds).
 * 3. **No scroll-passthrough.** OD-2's `window.scrollBy` forwarding for a
 *    vertical-resolving gesture is gone. A touch that starts on this card
 *    and drifts vertical simply does nothing (the card doesn't move,
 *    nothing scrolls) — this is a real, deliberate behavior change, not an
 *    oversight: it matches how `react-tinder-card` and Tinder itself
 *    actually behave (the card stack owns 100% of a touch that starts on
 *    it), and removes the entire class of "must yield an unclaimed touch to
 *    native/manual scroll" arbitration this defect has been fighting since
 *    OD-1. The surrounding page (filter chips, puzzle list, etc.) stays
 *    scrollable exactly as before — only touches starting ON the card no
 *    longer scroll the page.
 * 4. **No pointer capture for touch at all** — moot now that touch isn't
 *    Pointer-Events-driven; OD-3's whole mechanism doesn't apply.
 * 5. **Mouse/pen still use Pointer Events**, unchanged in spirit from
 *    before (`onPointerDown`/etc. below, explicitly skipping
 *    `pointerType === 'touch'` since that input is now fully owned by the
 *    listeners above) — desktop drag was never the broken half of OD-1, so
 *    it isn't touched beyond that guard.
 *
 * `gestureThreshold.ts` (commit math) and the Framer Motion visual layer
 * (`x`, `rotate`, `animate`) are unchanged through all five rounds.
 *
 * ### Timing source
 *
 * `elapsedTime` for `signedVelocityFromGesture` is measured with
 * `performance.now()`, not `event.timeStamp` — `timeStamp` is read-only and
 * not settable through RTL's `fireEvent`, which would make every
 * timing-dependent case in SwipeBinary.test.tsx (including the
 * 32ms-staleness regression) untestable. The difference is at most a frame
 * or so over a ~350ms gesture, far inside `minVelocity`'s margin.
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
  // Fades in step with the fly-off (see commitFlyOff below) so the
  // subsequent `x.set(0)` position reset lands while the card is already
  // invisible instead of visibly teleporting back to center — the mobile
  // "jump-cut" bug report, 2026-08-18.
  const opacity = useMotionValue(1)
  const rotate = useTransform(x, [-PREVIEW_RANGE, PREVIEW_RANGE], [-MAX_TILT_DEG, MAX_TILT_DEG], {
    clamp: true,
  })

  useMotionValueEvent(x, 'change', (latest) => {
    if (latest <= -PREVIEW_RANGE / 2) setPreviewDirection('left')
    else if (latest >= PREVIEW_RANGE / 2) setPreviewDirection('right')
    else setPreviewDirection(null)
  })

  // TEMPORARY, dev-flagged (`?gesture-debug=1`) on-screen capture — v3
  // Phase 0 instrumentation for OD-1; see useGestureDebugOverlay.tsx. A
  // no-op (and renders nothing) without the flag. `debug.log` is stable
  // across renders (see the hook's own `useCallback`), so it's safe to close
  // over directly in the mount-only touch effect below.
  const debug = useGestureDebugOverlay()

  const cardRef = useRef<HTMLDivElement | null>(null)

  // Shared across touch and mouse gesture tracking (only one input drives a
  // gesture at a time, so no risk of the two stepping on each other).
  const startXRef = useRef(0)
  const startYRef = useRef(0)
  const startTimeRef = useRef(0)
  const axisRef = useRef<AxisResolution>('ambiguous')

  // Touch-only: the identifier of the single active touch, or null.
  const activeTouchIdRef = useRef<number | null>(null)

  // Touch-only, set at touchstart when the touch began on a scrollable
  // snippet (scrollableSnippetAncestor) — non-null for the rest of that
  // gesture means onTouchMove forwards movement to the snippet's own
  // scroll/the page's vertical scroll instead of the card's drag. See
  // scrollableSnippetAncestor's own doc comment for why this is JS
  // forwarding, not a touch-action/preventDefault change.
  const snippetElRef = useRef<HTMLElement | null>(null)
  const snippetStartScrollLeftRef = useRef(0)
  const snippetStartWindowScrollYRef = useRef(0)

  // Mouse/pen-only (Pointer Events): pointerId + whether this component
  // holds an explicit capture on it.
  const activePointerIdRef = useRef<number | null>(null)
  const capturedRef = useRef(false)

  // See GESTURE_WATCHDOG_MS's doc comment. Shared across touch and mouse —
  // only one input drives a gesture at a time, so only one timer is ever
  // live.
  const watchdogTimerRef = useRef<number | null>(null)

  const clearWatchdog = useCallback(() => {
    if (watchdogTimerRef.current !== null) {
      window.clearTimeout(watchdogTimerRef.current)
      watchdogTimerRef.current = null
    }
  }, [])

  /**
   * Recovers a gesture the browser abandoned mid-flight (see
   * GESTURE_WATCHDOG_MS's doc comment for the live repro) — clears BOTH
   * touch's and mouse's claim refs unconditionally (only one is ever
   * actually set, but clearing both is simpler than branching on which
   * input was active) and springs the card back to center, exactly like a
   * normal `touchcancel`/`pointercancel` would. Deliberately does not call
   * `releasePointerCaptureIfSupported` — same reasoning as
   * `handleLostPointerCapture`: a capture the browser already reclaimed
   * (which is exactly the scenario this exists for) throws `NotFoundError`
   * on an explicit release attempt.
   *
   * Stable across renders (every value it closes over — the refs, `x`, and
   * `setPreviewDirection` — has stable identity for the component's
   * lifetime), so the mount-only touch effect below can reference it
   * directly without the ref-indirection `committedRef`/`handlePickRef` use.
   */
  const forceResetGesture = useCallback(
    (reason: 'watchdog-timeout' | 'visibility' | 'blur') => {
      clearWatchdog()
      const wasActive = activeTouchIdRef.current !== null || activePointerIdRef.current !== null
      activeTouchIdRef.current = null
      activePointerIdRef.current = null
      axisRef.current = 'ambiguous'
      snippetElRef.current = null
      capturedRef.current = false
      if (!wasActive) return
      debug.log({
        type: 'cancel',
        x: 0,
        y: 0,
        cancelable: false,
        axis: 'ambiguous',
        prevented: false,
        note: `force-reset (${reason}) — gesture abandoned mid-flight, recovered`,
      })
      setPreviewDirection(null)
      void animate(x, 0, { type: 'spring', stiffness: 500, damping: 30 })
    },
    [clearWatchdog, debug, x],
  )

  const armWatchdog = useCallback(() => {
    clearWatchdog()
    watchdogTimerRef.current = window.setTimeout(() => {
      forceResetGesture('watchdog-timeout')
    }, GESTURE_WATCHDOG_MS)
  }, [clearWatchdog, forceResetGesture])

  // Instant recovery for the most common real-world "terminating event never
  // arrives" cause — the app loses focus or is backgrounded mid-drag (a
  // notification, an app switch, the OS's own edge gesture) — rather than
  // waiting out the full GESTURE_WATCHDOG_MS. Mount-only: `forceResetGesture`
  // is stable, so this never needs to re-subscribe.
  useEffect(() => {
    const onBlur = () => {
      forceResetGesture('blur')
    }
    const onVisibilityChange = () => {
      if (document.hidden) forceResetGesture('visibility')
    }
    window.addEventListener('blur', onBlur)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      window.removeEventListener('blur', onBlur)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [forceResetGesture])

  // `committed`/`handlePick` change identity or value across renders (a
  // commit flips `committed` false->true mid-lifecycle); the touch effect
  // below is intentionally mount-only (empty deps) so listeners are never
  // torn down and re-attached mid-gesture, so it reads these through refs
  // kept current every render instead of closing over the render-scope
  // values directly. Synced in an effect, not assigned during render itself
  // — mutating a ref's `.current` while rendering is a real React footgun
  // (react-hooks/refs), even though the net effect here is "stays current
  // by the time the next event fires" either way.
  const committedRef = useRef(committed)
  const handlePickRef = useRef(handlePick)
  useEffect(() => {
    committedRef.current = committed
    handlePickRef.current = handlePick
  })

  useEffect(() => {
    const card = cardRef.current
    if (!card) return

    const resetTouch = () => {
      activeTouchIdRef.current = null
      axisRef.current = 'ambiguous'
      snippetElRef.current = null
      clearWatchdog()
    }

    const onTouchStart = (event: TouchEvent) => {
      if (committedRef.current) return
      if (activeTouchIdRef.current !== null) return
      // Mobile bug report, 2026-08-19 — see fallbackButtonAncestor's doc
      // comment: a button-origin touch is never claimed, so the browser's
      // native tap-to-click reaches it instead of being swallowed by this
      // card's unconditional preventDefault() below.
      if (fallbackButtonAncestor(event.target)) return
      const touch = event.touches[0]
      if (!touch) return
      activeTouchIdRef.current = touch.identifier
      startXRef.current = touch.clientX
      startYRef.current = touch.clientY
      startTimeRef.current = performance.now()
      axisRef.current = 'ambiguous'
      armWatchdog()
      const snippetEl = scrollableSnippetAncestor(event.target)
      snippetElRef.current = snippetEl
      if (snippetEl) {
        snippetStartScrollLeftRef.current = snippetEl.scrollLeft
        snippetStartWindowScrollYRef.current = window.scrollY
      }
      // OD-5: declare intent HERE, unconditionally, before the browser's
      // own gesture recognizer can commit to anything — see the component
      // doc comment. Still true for a snippet-origin touch (`snippetEl`
      // set above): this component still claims the touch and forwards its
      // movement manually (see onTouchMove below) rather than releasing it
      // back to the browser — see scrollableSnippetAncestor's doc comment
      // for why a native handoff can't work here.
      const prevented = event.cancelable
      if (prevented) event.preventDefault()
      debug.log({
        type: 'down',
        x: touch.clientX,
        y: touch.clientY,
        cancelable: event.cancelable,
        axis: 'ambiguous',
        prevented,
        note: snippetEl ? 'snippet-scroll-forward' : undefined,
      })
    }

    const onTouchMove = (event: TouchEvent) => {
      if (committedRef.current) return
      const id = activeTouchIdRef.current
      if (id === null) return
      const touch = findTouchById(event.touches, id)
      if (!touch) return
      // Rearmed on every accepted move (not just at touchstart) — see
      // GESTURE_WATCHDOG_MS's doc comment: a still-actively-moving real drag
      // should never trip the watchdog, only one that's gone silent.
      armWatchdog()

      const prevented = event.cancelable
      if (prevented) event.preventDefault()

      const dx = touch.clientX - startXRef.current
      const dy = touch.clientY - startYRef.current

      if (axisRef.current === 'ambiguous') {
        if (Math.abs(dx) < AXIS_TOLERANCE && Math.abs(dy) < AXIS_TOLERANCE) {
          debug.log({
            type: 'move',
            x: touch.clientX,
            y: touch.clientY,
            cancelable: event.cancelable,
            axis: 'ambiguous',
            prevented,
          })
          return
        }
        axisRef.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'
      }

      if (axisRef.current === 'vertical') {
        // OD-5: no scroll-passthrough for the card itself — see the
        // component doc comment. A snippet-origin touch is the one
        // exception: it gets real page-vertical passthrough back, restoring
        // the scroll the ancestor card's own touch-action:none/
        // preventDefault would otherwise still be blocking for it (see
        // scrollableSnippetAncestor's doc comment) — sign convention
        // (`- dy`) matches natural touch-scroll semantics (finger moves
        // down -> content follows the finger down -> the page scrolls
        // toward its top, i.e. scrollY decreases), flagged in the plan as
        // needing on-device confirmation like every other gesture change
        // here.
        const snippetEl = snippetElRef.current
        if (snippetEl) {
          window.scrollTo(window.scrollX, snippetStartWindowScrollYRef.current - dy)
        }
        debug.log({
          type: 'move',
          x: touch.clientX,
          y: touch.clientY,
          cancelable: event.cancelable,
          axis: 'vertical',
          prevented,
          note: snippetEl ? 'snippet-scroll-forward' : undefined,
        })
        return
      }

      const snippetEl = snippetElRef.current
      if (snippetEl) {
        // Forwarded to the snippet's own horizontal scroll instead of the
        // card's drag — same sign convention/on-device-verification note as
        // the vertical branch above.
        snippetEl.scrollLeft = snippetStartScrollLeftRef.current - dx
        debug.log({
          type: 'move',
          x: touch.clientX,
          y: touch.clientY,
          cancelable: event.cancelable,
          axis: 'horizontal',
          prevented,
          note: `snippet-scroll-forward dx=${String(Math.round(dx))}`,
        })
        return
      }

      x.set(dx)
      debug.log({
        type: 'move',
        x: touch.clientX,
        y: touch.clientY,
        cancelable: event.cancelable,
        axis: 'horizontal',
        prevented,
        note: `dx=${String(Math.round(dx))}`,
      })
    }

    const onTouchEnd = (event: TouchEvent) => {
      const id = activeTouchIdRef.current
      if (id === null) return
      const touch = findTouchById(event.changedTouches, id)
      if (!touch) return

      const axis = axisRef.current
      const dx = touch.clientX - startXRef.current
      const elapsedTime = performance.now() - startTimeRef.current
      // Captured before resetTouch() clears it below — a gesture that spent
      // its whole life forwarding to the snippet's own scroll never moved
      // the card at all, so its dx/velocity must not be run through
      // resolveSwipeCommit: without this guard, a fast/long snippet-scroll
      // touch could accidentally satisfy the commit threshold and fly the
      // card off / fire onCommit for an answer the user never actually
      // dragged toward.
      const wasSnippetForward = snippetElRef.current !== null
      resetTouch()

      if (committedRef.current || axis !== 'horizontal' || wasSnippetForward) {
        debug.log({
          type: 'up',
          x: touch.clientX,
          y: touch.clientY,
          cancelable: event.cancelable,
          axis,
          prevented: false,
          note: wasSnippetForward
            ? 'no commit (forwarded to snippet scroll, not a card drag)'
            : 'no commit (gesture never resolved horizontal, or already committed)',
        })
        return
      }

      // Signed velocity averaged over the WHOLE gesture (movement /
      // elapsedTime) — see signedVelocityFromGesture's doc comment in
      // gestureThreshold.ts for the real-hardware bug (a pause before
      // release collapsing a final-frame velocity to ~0) that averaging
      // sidesteps.
      const velocityX = signedVelocityFromGesture({ movement: dx, elapsedTime })
      const commitDirection = resolveSwipeCommit({ dx, velocityX }, DEFAULT_SWIPE_THRESHOLD)

      debug.log({
        type: 'up',
        x: touch.clientX,
        y: touch.clientY,
        cancelable: event.cancelable,
        axis: 'horizontal',
        prevented: false,
        note: `dx=${String(Math.round(dx))} t=${String(Math.round(elapsedTime))}ms v=${velocityX.toFixed(3)} -> ${commitDirection ?? 'no commit'}`,
      })

      setPreviewDirection(null)

      if (commitDirection) {
        handlePickRef.current(commitDirection)
        commitFlyOff(x, opacity, commitDirection)
      } else {
        void animate(x, 0, { type: 'spring', stiffness: 500, damping: 30 })
      }
    }

    /** A gesture the OS took away (a system gesture interrupted it — rare, now that touchstart claims the touch upfront): drop everything and settle the card back to center — never leave it stuck off-center. */
    const onTouchCancel = (event: TouchEvent) => {
      const id = activeTouchIdRef.current
      if (id === null) return
      const touch = findTouchById(event.changedTouches, id)
      resetTouch()
      setPreviewDirection(null)
      void animate(x, 0, { type: 'spring', stiffness: 500, damping: 30 })
      debug.log({
        type: 'cancel',
        x: touch?.clientX ?? 0,
        y: touch?.clientY ?? 0,
        cancelable: event.cancelable,
        axis: 'ambiguous',
        prevented: false,
        note: 'gesture cancelled — reset to center',
      })
    }

    // { passive: false } is load-bearing: without it, the browser may
    // register these as passive (its own default for touch on some
    // engines/versions), which makes preventDefault() a silent no-op. This
    // is why these are raw addEventListener calls and not React's
    // onTouchStart/onTouchMove synthetic props — see the component doc
    // comment's OD-5 section.
    card.addEventListener('touchstart', onTouchStart, { passive: false })
    card.addEventListener('touchmove', onTouchMove, { passive: false })
    card.addEventListener('touchend', onTouchEnd)
    card.addEventListener('touchcancel', onTouchCancel)
    return () => {
      card.removeEventListener('touchstart', onTouchStart)
      card.removeEventListener('touchmove', onTouchMove)
      card.removeEventListener('touchend', onTouchEnd)
      card.removeEventListener('touchcancel', onTouchCancel)
      // A puzzle change remounts this component fresh (PracticePage keys the
      // card wrapper on puzzle.id) — without this, an in-flight watchdog
      // from an abandoned gesture on the PREVIOUS puzzle would still fire
      // later and touch this cleanup's now-stale closure.
      clearWatchdog()
    }
    // Mount-only, deliberately — see the doc comment above committedRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- Mouse/pen only from here down — touch is fully owned by the native
  // listeners above. Desktop drag was never OD-1's broken half, so this
  // stays close to the pre-OD-5 shape, just gated to skip touch. ----

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return
    if (committed) return
    if (activePointerIdRef.current !== null) return
    activePointerIdRef.current = event.pointerId
    startXRef.current = event.clientX
    startYRef.current = event.clientY
    startTimeRef.current = performance.now()
    axisRef.current = 'ambiguous'
    capturedRef.current = false
    armWatchdog()
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return
    if (committed) return
    if (event.pointerId !== activePointerIdRef.current) return
    // Rearmed on every accepted move — see GESTURE_WATCHDOG_MS's doc comment.
    armWatchdog()

    const dx = event.clientX - startXRef.current
    const dy = event.clientY - startYRef.current

    if (axisRef.current === 'ambiguous') {
      if (Math.abs(dx) < AXIS_TOLERANCE && Math.abs(dy) < AXIS_TOLERANCE) return
      axisRef.current = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical'
      if (axisRef.current === 'horizontal' && !capturedRef.current) {
        setPointerCaptureIfSupported(event.currentTarget, event.pointerId)
        capturedRef.current = true
      }
    }

    if (axisRef.current === 'vertical') return
    x.set(dx)
  }

  const handlePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return
    if (event.pointerId !== activePointerIdRef.current) return

    const axis = axisRef.current
    const dx = event.clientX - startXRef.current
    const elapsedTime = performance.now() - startTimeRef.current
    const wasCaptured = capturedRef.current
    const target = event.currentTarget

    activePointerIdRef.current = null
    axisRef.current = 'ambiguous'
    capturedRef.current = false
    clearWatchdog()
    if (wasCaptured) releasePointerCaptureIfSupported(target, event.pointerId)

    if (committed || axis !== 'horizontal') return

    const velocityX = signedVelocityFromGesture({ movement: dx, elapsedTime })
    const commitDirection = resolveSwipeCommit({ dx, velocityX }, DEFAULT_SWIPE_THRESHOLD)

    setPreviewDirection(null)

    if (commitDirection) {
      handlePick(commitDirection)
      commitFlyOff(x, opacity, commitDirection)
    } else {
      void animate(x, 0, { type: 'spring', stiffness: 500, damping: 30 })
    }
  }

  const handlePointerCancel = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return
    if (event.pointerId !== activePointerIdRef.current) return
    const wasCaptured = capturedRef.current
    const target = event.currentTarget
    activePointerIdRef.current = null
    axisRef.current = 'ambiguous'
    capturedRef.current = false
    clearWatchdog()
    if (wasCaptured) releasePointerCaptureIfSupported(target, event.pointerId)
    setPreviewDirection(null)
    void animate(x, 0, { type: 'spring', stiffness: 500, damping: 30 })
  }

  /**
   * A capture the card never releases itself (the browser reassigns it
   * mid-gesture) would otherwise leave the card stuck mid-drag, since no
   * pointerup would ever arrive. Only clears state — does NOT call
   * `releasePointerCaptureIfSupported`, since releasing a capture that is
   * already gone throws `NotFoundError` in real browsers.
   */
  const handleLostPointerCapture = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return
    if (event.pointerId !== activePointerIdRef.current) return
    activePointerIdRef.current = null
    axisRef.current = 'ambiguous'
    capturedRef.current = false
    clearWatchdog()
    setPreviewDirection(null)
    void animate(x, 0, { type: 'spring', stiffness: 500, damping: 30 })
  }

  return (
    <div className="swipe-fallback">
      <p className="swipe-fallback__hint">Drag the card, or tap a button.</p>
      <motion.div
        ref={cardRef}
        className="swipe-fallback__card"
        // STATIC, never assigned at runtime — see the component doc
        // comment's OD-5 section. Duplicated from practice.css's own
        // `.swipe-fallback__card { touch-action: none }` because jsdom only
        // reflects inline styles, so this copy is the one the test suite can
        // actually assert on; keep the two in sync by hand.
        style={{ x, rotate, opacity, touchAction: 'none' }}
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
