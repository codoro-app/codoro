import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { animate, motion, useMotionValue, useMotionValueEvent, useTransform } from 'framer-motion'
import type { MotionValue } from 'framer-motion'
import type { InteractionBodyProps } from '../interactionTypes'
import type { SwipeBinaryPuzzle } from '../../../content'
import type { AnswerState } from '../answerState'
import {
  DEFAULT_SWIPE_THRESHOLD,
  RECENT_VELOCITY_WINDOW_MS,
  recentVelocity,
  resolveSwipeCommit,
} from '../gestureThreshold'
import type { GestureTrailSample, SwipeCommitDirection } from '../gestureThreshold'
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
 * side" preview kicks in — locked to `DEFAULT_SWIPE_THRESHOLD.commitDistance`
 * (gestureThreshold.ts), the actual commit distance, as a single source of
 * truth. Was a smaller, independent constant (90px) that let the card reach
 * full tilt and full preview color a full 30px before the real 120px
 * commit threshold — a user who watched the card visually "finish leaning"
 * and released there got no additional feedback for the remaining ~25% of
 * the required drag, and often no commit at all (mobile bug report,
 * 2026-08-18). Tying the two together means full tilt now coincides with
 * the point a release would actually satisfy the distance half of
 * `resolveSwipeCommit`. As of OD-6 (2026-08-21) that is an exact promise
 * rather than an approximation: the commit rule's distance branch stands
 * alone, so reaching full tilt and releasing commits at any pace. The
 * caveat this comment used to carry — "a slow drag that reaches full tilt
 * can still fail to commit if released too slowly" — was the visible face
 * of the defect OD-6 captured, and is gone with it. The commit decision
 * itself is still entirely `gestureThreshold.ts`'s job and only runs once,
 * at drag-end — this constant only drives the live visual.
 */
const PREVIEW_RANGE = DEFAULT_SWIPE_THRESHOLD.commitDistance
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
 * How many position samples the live gesture trail keeps. `recentVelocity`
 * only reads the tail of it (the last `RECENT_VELOCITY_WINDOW_MS`), so there
 * is nothing to gain from letting this grow for the length of a slow
 * multi-second drag — 16 samples covers well past that window at any
 * realistic touch sampling rate.
 */
const TRAIL_MAX_SAMPLES = 16

/** Appends one position sample to a gesture trail, evicting the oldest past `TRAIL_MAX_SAMPLES`. */
function pushTrail(trail: GestureTrailSample[], x: number, t: number): void {
  trail.push({ x, t })
  if (trail.length > TRAIL_MAX_SAMPLES) trail.shift()
}

/**
 * OD-6 (2026-08-21): the 2000ms gesture watchdog that used to live here is
 * GONE, and deliberately not replaced by a longer timeout.
 *
 * It was added (PR #71) because this state machine assumed a terminating
 * `touchend`/`touchcancel` always eventually arrives and had no recovery if
 * it didn't. That gap was real; a timer was the wrong instrument for it. A
 * timeout cannot tell "the browser dropped this gesture" apart from "the
 * user paused mid-drag" — both are just silence — so whatever value it is
 * given is wrong for one of the two cases. 2000ms picked the wrong one for a
 * hesitating user, which is common.
 *
 * Captured against production (desktop Chrome, synthetic touch stream; see
 * `docs/od-6-swipe-capture-2026-08-21.md`): a 200px drag that paused 2.3s
 * after 50px of travel had its gesture torn down WHILE THE FINGER WAS STILL
 * DOWN — the card snapped back to centre, every later move and the real
 * `touchend` were discarded, no commit. That is exactly the reported
 * "freezes mid-drag while I'm still moving" symptom: the watchdog was not
 * the recovery from that state, it was the cause of it.
 *
 * Worse, once the gesture was disowned this component stopped calling
 * `preventDefault()` on a touch still live on the card (`pd=false` in the
 * capture) — which on WebKit hands the in-flight gesture to the native pan
 * recognizer, the precise class of failure OD-1 through OD-5 spent nine
 * rounds fighting. A safety net that can manufacture the failure it exists
 * to catch is worse than no safety net.
 *
 * Two structural changes replace it, neither able to fire mid-gesture:
 *
 * 1. `touchmove`/`touchend`/`touchcancel` are bound to `window` (capture
 *    phase) for the gesture's duration rather than to the card, so the
 *    terminating event still arrives even if the card is unmounted,
 *    retargeted, or moved out from under the finger.
 * 2. Stale claims are detected lazily at the next `touchstart`: a claim whose
 *    identifier is absent from `event.touches` belongs to a finger that is
 *    provably gone, so it is dropped then and there. The browser's own touch
 *    list is ground truth, free, and available at exactly the moment
 *    staleness matters — no guessing from elapsed time required.
 *
 * The invariant those encode, asserted in SwipeBinary.test.tsx: while a touch
 * this component has claimed is still live, it is never disowned, and
 * `preventDefault()` is always called on it.
 */

/** Whether this gesture has been decided to be a horizontal card drag, a vertical one (ignored — see OD-5), or is still too small to call. */
type AxisResolution = 'ambiguous' | 'horizontal' | 'vertical'

/**
 * Feature-detected pointer capture (same guard, and same reason, as
 * DragOrder.tsx's): every real browser target implements it, jsdom does not,
 * and `typeof` rather than optional chaining because
 * `@typescript-eslint/no-unnecessary-condition` rejects the latter against
 * lib.dom's always-present typing. Mouse/pen only now — see OD-5 below for
 * why touch never uses this.
 *
 * Also swallows `setPointerCapture`'s own `NotFoundError` — live-caught via
 * this exact app's console (2026-08-19): the browser throws it if `pointerId`
 * doesn't match a pointer it currently considers "active" at the moment of
 * the call, and it's uncaught here would silently abort the rest of
 * `handlePointerMove` for that event, INCLUDING the `x.set(dx)` below it —
 * meaning the card would stop following the drag entirely, with no visual
 * error, for the rest of that gesture (subsequent moves keep hitting the
 * same throw, since `capturedRef.current` never gets set past the throwing
 * line either). `releasePointerCaptureIfSupported` below already documents
 * this exact exception type for the release side; this is the equivalent
 * guard for the acquire side, so a capture race can no longer break a
 * gesture whether it happens on `setPointerCapture` or
 * `releasePointerCapture`.
 */
function setPointerCaptureIfSupported(el: HTMLElement, pointerId: number): void {
  if (typeof el.setPointerCapture !== 'function') return
  try {
    el.setPointerCapture(pointerId)
  } catch {
    // Not fatal — the drag continues via `x.set(dx)` without an OS-level
    // capture; worst case is losing pointer events if the cursor leaves the
    // card mid-drag (rare — `axisRef`/`activePointerIdRef` still make the
    // eventual pointerup/pointercancel resolve correctly on their own).
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
 * First fix attempt: a button-origin touch skipped the card's claim
 * entirely — no `preventDefault()`, no `activeTouchIdRef` — banking on the
 * browser's normal touch-to-click synthesis reaching the button
 * unobstructed. A second real-device report (2026-08-19, same day) showed
 * that wasn't enough — see `buttonTouchIdRef`'s doc comment for why (the
 * card's own `touch-action: none` likely still suppresses it) and for the
 * actual fix, which owns the tap in JS instead of depending on native
 * click synthesis at all. This helper is now used only to detect the
 * button, not to decide whether to skip it.
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
 * The Framer Motion visual layer (`x`, `rotate`, `animate`) is unchanged
 * through all five rounds. `gestureThreshold.ts`'s commit math was unchanged
 * through them too, and then changed in OD-6 — see its module doc.
 *
 * ## OD-6: the defect was never WebKit's
 *
 * Rounds OD-1 through OD-5, plus PR #70/#71 and the 2026-08-19 velocity
 * retune, all assumed browser touch arbitration was the adversary, so nobody
 * built a scriptable reproduction. On 2026-08-21 one was built — synthetic
 * `TouchEvent` streams with controlled timing dispatched at this card in
 * desktop Chrome against production, with a window-level bubble-phase tap
 * recording `defaultPrevented` and the card's computed `translateX` per
 * event — and it reproduced BOTH reported symptoms in minutes, with no
 * WebKit involved. Three defects, all in this file and
 * `gestureThreshold.ts`: the whole-gesture velocity average acting as a
 * duration ceiling, the 2000ms watchdog aborting live gestures, and
 * `touches[0]` claiming the wrong touch identifier. Each is documented at
 * its own site above/below; the captured traces are in
 * `docs/od-6-swipe-capture-2026-08-21.md`.
 *
 * The lesson worth keeping: a gesture bug that survives repeated
 * source-reading rounds is a bug that needs a HARNESS, not a sixth
 * hypothesis — and "only reproduces on a phone" was itself an assumption
 * nobody had tested.
 *
 * ### Timing source
 *
 * Gesture timestamps are taken with `performance.now()`, not
 * `event.timeStamp` — `timeStamp` is read-only and not settable through
 * RTL's `fireEvent`, which would make every timing-dependent case in
 * SwipeBinary.test.tsx untestable. The difference is at most a frame or so.
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

  /**
   * Rolling position trail (client X + timestamp) for the live gesture,
   * feeding `recentVelocity` at release. Shared across touch and mouse for
   * the same reason the refs above are: only one input drives a gesture at a
   * time.
   */
  const trailRef = useRef<GestureTrailSample[]>([])

  /**
   * Detaches the window-level `touchmove`/`touchend`/`touchcancel` listeners
   * of the gesture currently in flight, or null when none is. Held in a ref
   * because those listeners are created inside the mount-only effect below,
   * while `forceResetGesture` (which must also be able to drop them) is
   * defined out here.
   */
  const detachGestureListenersRef = useRef<(() => void) | null>(null)

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

  // Touch-only: tracks a touch that started on one of the two fallback
  // buttons (`.swipe-fallback__button`) as its own, isolated tap gesture —
  // entirely separate from activeTouchIdRef's card-drag tracking, and never
  // promoted into one (fallbackButtonAncestor's doc comment: a
  // button-origin touch is tap-only, even if it later drags).
  //
  // Mobile bug report, 2026-08-19 (second round): the original fix
  // (skipping preventDefault so the browser's own touch-to-click synthesis
  // would reach the button) turned out insufficient on a real device.
  // scrollableSnippetAncestor's doc comment already establishes that a
  // descendant can't loosen an ancestor's `touch-action: none` (CSS Touch
  // Action's intersection rule) — this card sets exactly that on itself —
  // and the same restriction appears to suppress native tap-to-click
  // synthesis for a button underneath it too, not just scrolling. Rather
  // than depend further on exactly which touch-action side effect is
  // responsible, this owns the tap entirely in JS instead (matching OD-5's
  // "claim 100% of touch, don't rely on the browser's default handling"
  // approach for the rest of the card) and calls `preventDefault()` on the
  // button's touchstart to guarantee the browser's own click synthesis
  // never ALSO fires — which would otherwise risk a double-commit.
  const buttonTouchIdRef = useRef<number | null>(null)
  const buttonTapElRef = useRef<HTMLElement | null>(null)
  const buttonTapStartRef = useRef<{ x: number; y: number } | null>(null)

  /**
   * Recovers a gesture that ended without a terminating event because the
   * page itself went away underneath it — the app backgrounded, the window
   * blurred (see the listeners below). NOT a timeout: this only runs on an
   * explicit browser signal that the gesture cannot continue, never on a
   * guess about elapsed silence (OD-6 — see the watchdog removal note near
   * the top of this file). Clears BOTH touch's and mouse's claim refs
   * unconditionally (only one is ever actually set, but clearing both is
   * simpler than branching on which input was active) and springs the card
   * back to center, exactly like a
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
    (reason: 'visibility' | 'blur') => {
      const wasActive = activeTouchIdRef.current !== null || activePointerIdRef.current !== null
      activeTouchIdRef.current = null
      activePointerIdRef.current = null
      axisRef.current = 'ambiguous'
      snippetElRef.current = null
      capturedRef.current = false
      trailRef.current = []
      detachGestureListenersRef.current?.()
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
    [debug, x],
  )

  // Recovery for the most common real-world "terminating event never
  // arrives" cause — the app loses focus or is backgrounded mid-drag (a
  // notification, an app switch, the OS's own edge gesture). An explicit
  // browser signal, not a timeout: `document.hidden`/`blur` mean the gesture
  // genuinely cannot continue, which a stretch of silence never does.
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

    /**
     * The rest of a gesture is heard at `window`, capture phase — but only
     * WHILE a gesture is in flight, attached here at `touchstart` and dropped
     * again the moment the claim is released.
     *
     * Scoping matters, and not only for tidiness: a non-passive `touchmove`
     * listener on `window` opts the whole page out of the browser's scroll
     * fast path for as long as it is attached, because the compositor can no
     * longer assume the handler won't call `preventDefault()`. Attaching for
     * the component's whole lifetime would tax every scroll on any page
     * showing a swipe-binary card, including scrolls nowhere near it.
     * Attaching only between `touchstart` and the gesture's end costs
     * nothing the gesture wasn't already claiming.
     *
     * Re-attaching with the same function references and the same capture
     * flag is a no-op per the DOM spec, so the paths that attach without a
     * guaranteed matching detach (see `forceResetGesture`) cannot stack
     * duplicates.
     */
    const attachGestureListeners = () => {
      window.addEventListener('touchmove', onTouchMove, { passive: false, capture: true })
      window.addEventListener('touchend', onTouchEnd, { capture: true })
      window.addEventListener('touchcancel', onTouchCancel, { capture: true })
      detachGestureListenersRef.current = detachGestureListeners
    }

    const detachGestureListeners = () => {
      window.removeEventListener('touchmove', onTouchMove, { capture: true })
      window.removeEventListener('touchend', onTouchEnd, { capture: true })
      window.removeEventListener('touchcancel', onTouchCancel, { capture: true })
      detachGestureListenersRef.current = null
    }

    const resetTouch = () => {
      activeTouchIdRef.current = null
      axisRef.current = 'ambiguous'
      snippetElRef.current = null
      trailRef.current = []
      detachGestureListeners()
    }

    const resetButtonTap = () => {
      buttonTouchIdRef.current = null
      buttonTapElRef.current = null
      buttonTapStartRef.current = null
      detachGestureListeners()
    }

    /** Springs the card home and drops the claim — the shared tail of every abandoned-gesture path. */
    const abandonCardGesture = () => {
      resetTouch()
      setPreviewDirection(null)
      void animate(x, 0, { type: 'spring', stiffness: 500, damping: 30 })
    }

    const onTouchStart = (event: TouchEvent) => {
      if (committedRef.current) return
      // Lazy stale-claim recovery — the timer-free replacement for the OD-6
      // watchdog (see its removal note near the top of this file). A claim
      // whose identifier is no longer among the document's live touches
      // belongs to a finger that is provably gone, whatever became of its
      // terminating event; drop it and let this touch through. Unlike a
      // timeout this cannot misfire mid-gesture: it only runs when a NEW
      // touch has started, and it reads the browser's own touch list rather
      // than inferring death from elapsed silence.
      if (
        activeTouchIdRef.current !== null &&
        findTouchById(event.touches, activeTouchIdRef.current) === null
      ) {
        abandonCardGesture()
      }
      if (
        buttonTouchIdRef.current !== null &&
        findTouchById(event.touches, buttonTouchIdRef.current) === null
      ) {
        resetButtonTap()
      }
      if (activeTouchIdRef.current !== null || buttonTouchIdRef.current !== null) return
      // See buttonTouchIdRef's doc comment: a button-origin touch is
      // tracked and owned as its own isolated tap gesture, never claimed
      // for card-dragging.
      const button = fallbackButtonAncestor(event.target)
      if (button) {
        // `changedTouches`, not `touches` — see the card branch below.
        const touch = event.changedTouches[0]
        if (!touch) return
        buttonTouchIdRef.current = touch.identifier
        buttonTapElRef.current = button
        buttonTapStartRef.current = { x: touch.clientX, y: touch.clientY }
        attachGestureListeners()
        const prevented = event.cancelable
        if (prevented) event.preventDefault()
        debug.log({
          type: 'down',
          x: touch.clientX,
          y: touch.clientY,
          cancelable: event.cancelable,
          axis: 'ambiguous',
          prevented,
          note: 'button-tap',
        })
        return
      }
      // `changedTouches`, NOT `touches` (OD-6, 2026-08-21). `TouchEvent.touches`
      // is every active touch point in the DOCUMENT, ordered by start time, so
      // any finger already resting anywhere on the page — a palm on the screen
      // edge, a thumb bracing the phone, a finger still lifting from the last
      // interaction — is `touches[0]` and hijacks this claim. Captured effect:
      // the component anchored `startXRef`/`startYRef` to a finger that never
      // moved, so `dx` stayed ~0 and the card did not move AT ALL through a
      // full 160px drag; then `onTouchEnd` failed to find that identifier in
      // its `changedTouches` and returned without clearing the claim, leaving
      // the card inert for every gesture afterwards. `changedTouches[0]` is
      // the touch that actually started here, which is the one we mean.
      const touch = event.changedTouches[0]
      if (!touch) return
      const startTime = performance.now()
      activeTouchIdRef.current = touch.identifier
      startXRef.current = touch.clientX
      startYRef.current = touch.clientY
      startTimeRef.current = startTime
      axisRef.current = 'ambiguous'
      trailRef.current = []
      pushTrail(trailRef.current, touch.clientX, startTime)
      attachGestureListeners()
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
      const buttonId = buttonTouchIdRef.current
      if (buttonId !== null) {
        const touch = findTouchById(event.touches, buttonId)
        if (!touch) return
        const prevented = event.cancelable
        if (prevented) event.preventDefault()
        const start = buttonTapStartRef.current
        const dx = start ? touch.clientX - start.x : 0
        const dy = start ? touch.clientY - start.y : 0
        // A real tap barely moves; drifting past the same tolerance the
        // card's own axis arbitration uses means the finger left the
        // button — cancel the tap rather than commit it OR hand off to a
        // card drag (fallbackButtonAncestor's doc comment: button-origin
        // touches are tap-only, even if they later drag).
        if (Math.abs(dx) >= AXIS_TOLERANCE || Math.abs(dy) >= AXIS_TOLERANCE) {
          buttonTouchIdRef.current = null
          buttonTapElRef.current = null
          buttonTapStartRef.current = null
          debug.log({
            type: 'cancel',
            x: touch.clientX,
            y: touch.clientY,
            cancelable: event.cancelable,
            axis: 'ambiguous',
            prevented: false,
            note: 'button-tap cancelled — moved too far to be a tap',
          })
        }
        return
      }
      const id = activeTouchIdRef.current
      if (id === null) return
      const touch = findTouchById(event.touches, id)
      if (!touch) return
      pushTrail(trailRef.current, touch.clientX, performance.now())

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
      const buttonId = buttonTouchIdRef.current
      if (buttonId !== null) {
        const touch = findTouchById(event.changedTouches, buttonId)
        const button = buttonTapElRef.current
        buttonTouchIdRef.current = null
        buttonTapElRef.current = null
        buttonTapStartRef.current = null
        if (!touch || !button || committedRef.current) return
        const direction =
          button.dataset.swipeDirection === 'left' || button.dataset.swipeDirection === 'right'
            ? button.dataset.swipeDirection
            : null
        debug.log({
          type: 'up',
          x: touch.clientX,
          y: touch.clientY,
          cancelable: event.cancelable,
          axis: 'ambiguous',
          prevented: false,
          note: direction ? `button-tap -> ${direction}` : 'button-tap (no direction?!)',
        })
        if (direction) handlePickRef.current(direction)
        return
      }
      const id = activeTouchIdRef.current
      if (id === null) return
      const touch = findTouchById(event.changedTouches, id)
      if (!touch) {
        // A different finger lifted — keep tracking ours. Unless ours is not
        // among the document's live touches either, in which case this
        // gesture is over and the claim must not outlive it: the bare
        // `return` that used to be here is how a card went permanently inert
        // once the wrong identifier had been claimed (OD-6, defect 3).
        if (findTouchById(event.touches, id) === null) abandonCardGesture()
        return
      }

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
      // Captured before resetTouch() swaps in a fresh array.
      const trail = trailRef.current
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

      // Velocity over the gesture's last RECENT_VELOCITY_WINDOW_MS, not its
      // whole-life average (OD-6 — see recentVelocity's doc comment). It only
      // feeds the flick branch now; a full-distance drag commits on distance
      // alone, at any pace, so the pause-before-release habit that made a
      // recent-window velocity unusable before can no longer block a swipe.
      pushTrail(trail, touch.clientX, performance.now())
      const velocityX = recentVelocity(trail, RECENT_VELOCITY_WINDOW_MS)
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
      if (buttonTouchIdRef.current !== null) {
        buttonTouchIdRef.current = null
        buttonTapElRef.current = null
        buttonTapStartRef.current = null
        debug.log({
          type: 'cancel',
          x: 0,
          y: 0,
          cancelable: event.cancelable,
          axis: 'ambiguous',
          prevented: false,
          note: 'button-tap cancelled (touchcancel)',
        })
        return
      }
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
    // Only `touchstart` is bound permanently, and only to the card — a touch
    // that does not BEGIN here is never ours. The rest of the gesture is heard
    // at `window` for the gesture's duration only; see
    // `attachGestureListeners` above for why that scoping is load-bearing and
    // why `window` rather than the card (OD-6: the card can be unmounted,
    // retargeted, or transformed out from under a finger mid-gesture, and
    // `window` still sees the terminating event — which is what makes the
    // removed watchdog unnecessary rather than merely relaxed).
    card.addEventListener('touchstart', onTouchStart, { passive: false })
    return () => {
      card.removeEventListener('touchstart', onTouchStart)
      // A puzzle change remounts this component (PracticePage keys the card
      // wrapper on puzzle.id); an in-flight gesture's window listeners must
      // not outlive the component that owns them.
      detachGestureListeners()
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
    const startTime = performance.now()
    activePointerIdRef.current = event.pointerId
    startXRef.current = event.clientX
    startYRef.current = event.clientY
    startTimeRef.current = startTime
    axisRef.current = 'ambiguous'
    capturedRef.current = false
    trailRef.current = []
    pushTrail(trailRef.current, event.clientX, startTime)
  }

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') return
    if (committed) return
    if (event.pointerId !== activePointerIdRef.current) return
    pushTrail(trailRef.current, event.clientX, performance.now())

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
    const wasCaptured = capturedRef.current
    const target = event.currentTarget

    const trail = trailRef.current
    pushTrail(trail, event.clientX, performance.now())
    activePointerIdRef.current = null
    axisRef.current = 'ambiguous'
    capturedRef.current = false
    trailRef.current = []
    if (wasCaptured) releasePointerCaptureIfSupported(target, event.pointerId)

    if (committed || axis !== 'horizontal') return

    const velocityX = recentVelocity(trail, RECENT_VELOCITY_WINDOW_MS)
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
    trailRef.current = []
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
    trailRef.current = []
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
            data-swipe-direction="left"
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
            data-swipe-direction="right"
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
