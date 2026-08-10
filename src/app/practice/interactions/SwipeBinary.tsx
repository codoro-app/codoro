import { useMemo, useState, type ComponentPropsWithoutRef } from 'react'
import { animate, motion, useMotionValue, useMotionValueEvent, useTransform } from 'framer-motion'
import { useDrag } from '@use-gesture/react'
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
 * `left_label` / `right_label` as hints plus two labelled side buttons
 * (danger-bordered left, success-bordered right) that commit directly on
 * click/tap — the desktop/tap fallback the locked design requires, built by
 * concern (a) and left fully playable here, unchanged in behavior. A click
 * never goes through the drag-threshold math below; it commits immediately,
 * exactly as before.
 *
 * On top of that fallback, the whole card — the syntax-highlighted snippet
 * plus the buttons row below it, not just the buttons — is a single
 * `@use-gesture/react`-bound drag surface (the "Tinder-style card" the brief
 * calls for): it tilts and previews a side as the user drags, springs back
 * to center below threshold, and flies off in the drag direction (then
 * resets to center to show the reveal) once `resolveSwipeCommit`
 * (gestureThreshold.ts) says the drag both traveled far enough AND was
 * released fast enough, in the same direction. Rendering the snippet here
 * (rather than PuzzleCardShell's usual static copy) is what lets it move
 * with the drag; see PuzzleCardShell's `staticLines` doc comment.
 *
 * `CommitPayload.choiceIndex` is `null` for swipe-binary by contract — but
 * since this is a strictly binary choice, `correct` + `puzzle.correct_direction`
 * is always enough to reconstruct which side was actually picked (if
 * correct, the pick was `correct_direction`; if not, it was the other one),
 * so no additional field is needed to render "you picked X" post-commit.
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

  const bind = useDrag(
    ({ down, movement: [mx], elapsedTime, last, cancel }) => {
      if (committed) {
        // Belt-and-suspenders: `enabled: !committed` below already tells
        // @use-gesture not to run this gesture at all once committed, but
        // bail out defensively too in case a drag was already in flight
        // the instant commit happened (e.g. committed via the other side's
        // button mid-drag).
        cancel()
        return
      }

      if (down) {
        x.set(mx)
        return
      }

      // Only the final (pointer-up) frame of the gesture can resolve a
      // commit — intermediate frames only update the live drag position
      // above.
      if (!last) return

      // Signed velocity averaged over the whole gesture (movement /
      // elapsedTime), NOT @use-gesture's own final-frame velocity/direction
      // — see signedVelocityFromGesture's doc comment in gestureThreshold.ts
      // for the real-hardware bug (a >32ms pause before release collapses
      // @use-gesture's last-frame kinematics to ~0) that approach used to
      // reproduce.
      const commitDirection = resolveSwipeCommit(
        { dx: mx, velocityX: signedVelocityFromGesture({ movement: mx, elapsedTime }) },
        DEFAULT_SWIPE_THRESHOLD,
      )

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
    },
    {
      axis: 'x',
      filterTaps: true,
      enabled: !committed,
      // @use-gesture/core defaults axisThreshold to { mouse: 0, touch: 0, pen: 8 }
      // (dragConfigResolver.ts) — zero tolerance for touch means the very
      // FIRST touchmove sample permanently locks the gesture's axis, and on
      // real touchscreens that sample very often has a slightly larger
      // vertical component than horizontal (finger jitter, a not-quite-flat
      // swipe angle), which locks axis to 'y' and then silently drops the
      // whole gesture: `axis: 'x'` + a mismatched locked axis makes every
      // frame (including the final pointerup one) get blocked before it ever
      // reaches this callback — see DragEngine.ts's `axisIntent`/`_blocked`
      // and Engine.ts's emit-skip check. This never reproduces with a mouse
      // or in jsdom-mocked tests (both produce clean axis-dominant deltas),
      // which is why it slipped through the existing test suite and a prior
      // fix that only addressed a different bug (stale last-frame velocity
      // over a >32ms pause before release). A few pixels of touch tolerance
      // is enough to absorb that natural jitter without weakening genuine
      // vertical-scroll detection.
      axisThreshold: { touch: 20 },
      // v2 Phase 7b, OD-1 (third gesture defect, real device — iPhone 15
      // Pro, iOS 26.5.2, both PWA and browser tab): the two fixes above
      // (32ms kinematics staleness, this axisThreshold) close the JS-level
      // axis-lock bugs but don't touch a separate, earlier-arbitrating
      // layer — `touch-action: pan-y` below tells the WebKit compositor at
      // parse time that it may commit a touch to native vertical scroll
      // WITHOUT ever consulting JS, and it can make that commitment within
      // the first few touchmove samples, before `axisThreshold` above gets
      // a meaningful chance to run. Once committed, the touchmove's own
      // `cancelable` flips to false — confirmed directly in
      // @use-gesture/core's own DragEngine.preventScroll(), which no-ops
      // under that guard. That's the actual symptom this device reproduced:
      // a normal-speed or slightly-diagonal swipe loses this race to native
      // scroll and does nothing; only a fast, purely-horizontal flick wins
      // it. `preventScroll: true` activates @use-gesture's own
      // already-shipped scroll-arbitration path instead of leaving it to
      // touch-action: a dedicated non-passive listener defers the
      // vertical/horizontal call to this same axisThreshold — if it
      // resolves vertical, it cleanly yields (removes itself, never calls
      // preventDefault, native scroll proceeds normally) before scroll
      // visibly starts; if horizontal, the drag wins and scroll is
      // prevented for the rest of the gesture. `preventScrollAxis` defaults
      // to 'y', which is exactly the axis this card must still yield to.
      //
      // Amendment (real-device re-report after the first Phase 7b deploy):
      // touch-action was shipped as 'none' here, which does NOT reproduce
      // the swipe-arbitration bug fix real-device testers expected — a
      // normal-speed or diagonal swipe still did nothing. Root cause, read
      // directly from @use-gesture's own docs (use-gesture.netlify.app/docs/
      // options/#preventscroll and #preventscrollaxis), not just its source:
      // preventScroll/preventScrollAxis is explicitly documented to require
      // `touch-action: pan-x`/`pan-y` on the element, NOT `none` — "touch-
      // action: none ... generally means that the scroll of the page can't
      // be initiated from the draggable element", which is exactly the
      // "yields to native scroll" behavior this card needs. `touch-action:
      // none` is a hard, unconditional browser-level opt-out of ALL default
      // panning for touches starting on this element — it takes effect at
      // hit-test time, before any JS runs, and isn't something preventScroll
      // (or NOT calling preventDefault) can hand back. So with 'none', a
      // vertical/diagonal touch on the card was already blocked from
      // scrolling the page by CSS alone, `state.axis` still resolved to 'y',
      // the gesture engine correctly "yielded" by cleaning up and never
      // calling preventDefault — but there was no native scroll left to
      // yield TO, so the touch produced no visible effect at all (no card
      // drag, no page scroll). That reads to a real user exactly like the
      // original bug: "swipe does nothing." The previous doc comment's claim
      // that @use-gesture's docs require 'none' for a draggable element was
      // wrong — that guidance is for drag surfaces that don't need to hand
      // any axis back to native scroll at all; this card explicitly does.
      // Switched to `touchAction: 'pan-y'` below (matching the library's own
      // documented setup for `preventScrollAxis`), so the browser can still
      // start a native vertical scroll on this element, with
      // preventScrollAxis's non-passive listener responsible for calling
      // preventDefault before that scroll visibly commits once the axis
      // resolves horizontal. Per @use-gesture's own docs this feature is
      // explicitly labeled "experimental" and "still under testing" — this
      // change is not assumed correct from source/docs alone and needs a
      // real on-device re-test (iPhone, both PWA and browser tab) before
      // OD-1 is re-closed.
      preventScroll: true,
    },
  )

  // `bind()`'s TS type is `@use-gesture/react`'s own generic
  // `ReactDOMAttributes` (every possible React DOM handler name, widely
  // typed) — that shape structurally conflicts with `motion.div`'s props
  // for a handful of names framer-motion gives its own gesture-specific
  // signature to (`onDrag`, `onDragStart`, ...), even though `bind()` never
  // actually populates those with anything but plain pointer-event
  // handlers at runtime. This is a known typing mismatch between the two
  // libraries, not a real prop conflict, so it's cast through `unknown`
  // rather than fighting the two independently-authored handler types.
  const dragSurfaceProps = bind() as unknown as ComponentPropsWithoutRef<typeof motion.div>

  return (
    <div className="swipe-fallback">
      <p className="swipe-fallback__hint">Drag the card, or tap a button.</p>
      <motion.div
        {...dragSurfaceProps}
        className="swipe-fallback__card"
        // v2 Phase 7b, OD-1: 'pan-y', not 'none' — see the useDrag config's
        // own comment above (preventScroll) for the full amendment. 'none'
        // blocks native scroll unconditionally at the CSS level, which
        // silently defeats preventScrollAxis's own "yield to native scroll"
        // path; 'pan-y' is what @use-gesture's own docs specify for this
        // exact setup.
        style={{ x, rotate, touchAction: 'pan-y' }}
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
    </div>
  )
}
