import { useState, type ComponentPropsWithoutRef } from 'react'
import { animate, motion, useMotionValue, useMotionValueEvent, useTransform } from 'framer-motion'
import { useDrag } from '@use-gesture/react'
import type { InteractionBodyProps } from '../interactionTypes'
import type { SwipeBinaryPuzzle } from '../../../content'
import type { AnswerState } from '../answerState'
import { DEFAULT_SWIPE_THRESHOLD, resolveSwipeCommit } from '../gestureThreshold'
import type { SwipeCommitDirection } from '../gestureThreshold'

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
 * On top of that fallback, the same buttons row is also a
 * `@use-gesture/react`-bound drag surface: it tilts and previews a side as
 * the user drags, springs back to center below threshold, and flies off in
 * the drag direction (then resets to center to show the reveal) once
 * `resolveSwipeCommit` (gestureThreshold.ts) says the drag both traveled
 * far enough AND was released fast enough, in the same direction.
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
    ({ down, movement: [mx], velocity: [vx], direction: [dirX], last, cancel }) => {
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

      // @use-gesture reports `velocity` as an unsigned magnitude and
      // `direction` as -1/0/1 per axis; multiplying them recovers a signed
      // velocity whose sign matches `movement`'s, which is what
      // resolveSwipeCommit's "same direction" check needs.
      const commitDirection = resolveSwipeCommit(
        { dx: mx, velocityX: vx * dirX },
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
    { axis: 'x', filterTaps: true, enabled: !committed },
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
      <p className="swipe-fallback__hint">Drag a side, or tap a button.</p>
      <motion.div
        {...dragSurfaceProps}
        className="swipe-fallback__buttons"
        style={{ x, rotate, touchAction: 'pan-y' }}
      >
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
      </motion.div>
    </div>
  )
}
