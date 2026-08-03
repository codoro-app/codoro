/**
 * The visual frame every practice puzzle renders inside, regardless of
 * interaction type. Thin shell: no rating/selection/streak/requeue logic
 * lives here — that's src/engine/, consumed by the caller (concern d), not
 * this component. This file + interactionTypes.ts define the contract
 * concerns (b) and (d) build against; see the Phase 4 concern-a report for
 * the full rationale.
 *
 * Elevation (box-shadow) is retired in the v2 Arena design system — every
 * surface here (code snippet, mcq choices, feedback panel) uses a flat
 * border instead. The Continue button is a flat CTA (no border, no
 * Duolingo-style "lip"): `:active` scale/opacity + `:focus-visible` outline
 * — see practice.css.
 */
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Puzzle } from '../../content'
import type { CommitPayload } from './interactionTypes'
import { highlightSnippet } from './highlightSnippet'
import { CodeSnippet } from './CodeSnippet'
import { Mcq } from './interactions/Mcq'
import { SwipeBinary } from './interactions/SwipeBinary'
import { TapLine } from './interactions/TapLine'
import { DragOrder } from './interactions/DragOrder'
import '../tokens.css'
import './practice.css'

export interface PuzzleCardShellProps {
  puzzle: Puzzle
  /** Rating delta to display in the feedback panel once committed, e.g. +12 or -9. Provided by the caller (concern d), which owns rating math via src/engine. You do not compute this. */
  ratingDelta: number | null
  /** Called once, the instant the user commits an answer (before Continue is pressed) — lets the caller (d) fire telemetry/persist the attempt immediately rather than waiting for Continue. */
  onAnswered: (payload: CommitPayload) => void
  /** Called when the user presses Continue after a committed answer — the caller advances to the next puzzle. */
  onContinue: () => void
  /**
   * An externally-triggered commit — e.g. Rush's per-puzzle clock (Phase 5b
   * Item 6) reaching 0 before the player answers. Behaves exactly like the
   * interaction body calling `onCommit` with this payload (same feedback
   * panel, same `onAnswered` call, same lock against further input), except
   * the player never had to interact. Undefined outside a timed mode.
   */
  forcedCommit?: CommitPayload | undefined
}

interface CommitState {
  puzzleId: string
  payload: CommitPayload
}

/**
 * Compile-time exhaustiveness enforcement for the switch below: if a future
 * interaction is added to `Puzzle` without a case here, `puzzle` in the
 * `default` branch narrows to that new member instead of `never`, and this
 * call fails to compile. No shared type-utils module exists in this repo
 * (checked — src/engine, src/storage, src/content all export domain logic
 * only), so this stays local rather than inventing one for a single call site.
 */
function assertNever(value: never): never {
  throw new Error(`PuzzleCardShell: unhandled interaction variant ${JSON.stringify(value)}`)
}

/**
 * Tracks committed state as `{ puzzleId, payload }` rather than plain
 * `payload` state, and compares `commit.puzzleId === puzzle.id` to decide
 * whether it applies to the *current* puzzle. This makes the shell
 * self-resetting when the caller swaps `puzzle` without needing a
 * `key={puzzle.id}` at the call site — belt-and-suspenders, since a caller
 * that *does* use `key={puzzle.id}` (remounting the whole shell) also works
 * fine, it just never needs this comparison to matter. Document whichever
 * approach concern (d) actually uses; either is safe against this shell.
 */
export function PuzzleCardShell({
  puzzle,
  ratingDelta,
  onAnswered,
  onContinue,
  forcedCommit,
}: PuzzleCardShellProps) {
  const [commit, setCommit] = useState<CommitState | null>(null)

  const committed = commit !== null && commit.puzzleId === puzzle.id
  const committedPayload = committed ? commit.payload : undefined

  const handleCommit = (payload: CommitPayload) => {
    if (committed) return
    setCommit({ puzzleId: puzzle.id, payload })
    onAnswered(payload)
  }

  // A forced commit calls the exact same onAnswered/telemetry/storage path
  // a real tap would — inside an effect, not during render, since
  // onAnswered has real external side effects (the caller persists the
  // attempt, fires telemetry) that must never run mid-render (an impure
  // render is a real rules-of-react violation, unlike this lint rule's
  // generic "avoid setState in an effect" caution, which exists to catch
  // effects that redundantly re-derive state React could compute during
  // render — not this case, an external prop driving a one-time side
  // effect, exactly what an effect is for). `committed` already guards
  // against double-firing for the current puzzle, same as a real tap
  // racing a timeout would.
  useEffect(() => {
    if (forcedCommit && !committed) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      handleCommit(forcedCommit)
    }
    // handleCommit is intentionally excluded: it closes over `committed`/
    // `puzzle.id`, both already deps here, and re-running this effect only
    // when `forcedCommit` itself changes (or committed flips) is the point
    // — including handleCommit would refire on every render for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forcedCommit, committed])

  // tap-line renders the snippet itself, as its interactive tap-target
  // surface, and swipe-binary renders it inside its own draggable card
  // surface (the snippet has to move/tilt with the drag, Tinder-style) — a
  // separate static copy from the shell would just be a confusing duplicate
  // for either, so the shell skips both. drag-order rearranges `blocks`, not
  // a fixed snippet with tap targets — it renders no snippet view at all
  // (DragOrder.tsx owns its own block list), so `snippet` goes unused for
  // this interaction (still present on BaseSchema; `prompt` still carries
  // the puzzle's instruction line as usual).
  const staticLines =
    puzzle.interaction === 'tap-line' ||
    puzzle.interaction === 'swipe-binary' ||
    puzzle.interaction === 'drag-order'
      ? null
      : highlightSnippet(puzzle.snippet, puzzle.language)

  let interactionBody: ReactNode
  switch (puzzle.interaction) {
    case 'mcq':
      interactionBody = (
        <Mcq
          puzzle={puzzle}
          committed={committed}
          committedPayload={committedPayload}
          onCommit={handleCommit}
        />
      )
      break
    case 'swipe-binary':
      interactionBody = (
        <SwipeBinary
          puzzle={puzzle}
          committed={committed}
          committedPayload={committedPayload}
          onCommit={handleCommit}
        />
      )
      break
    case 'tap-line':
      interactionBody = (
        <TapLine
          puzzle={puzzle}
          committed={committed}
          committedPayload={committedPayload}
          onCommit={handleCommit}
        />
      )
      break
    case 'drag-order':
      interactionBody = (
        <DragOrder
          puzzle={puzzle}
          committed={committed}
          committedPayload={committedPayload}
          onCommit={handleCommit}
        />
      )
      break
    case 'scrubber':
      // Structurally excluded from Practice/Daily/Rush (they all serve from
      // quizPool, not puzzlePool — see src/content/index.ts). Reaching this
      // case means that guarantee broke somewhere upstream; fail loudly
      // instead of silently rendering the empty, un-escapable interaction
      // div this switch replaces (docs/v2-phase2-review.md, P0). Scrubber
      // gets its own renderer in its own mode (Phase 3), not a branch here.
      throw new Error(
        `PuzzleCardShell: scrubber puzzle "${puzzle.id}" reached the quiz shell — scrubber must be served from scrubberPool by its own mode, never quizPool/puzzlePool.`,
      )
    default:
      assertNever(puzzle)
  }

  return (
    <div className="puzzle-card">
      <p className="puzzle-card__prompt">{puzzle.prompt}</p>

      {staticLines && <CodeSnippet lines={staticLines} />}

      <div className="puzzle-card__interaction">{interactionBody}</div>

      {committed && committedPayload && (
        <div
          className={`feedback-panel feedback-panel--${committedPayload.correct ? 'correct' : 'wrong'}`}
          role="status"
        >
          <div className="feedback-panel__header">
            <span className="feedback-panel__icon" aria-hidden="true">
              {committedPayload.correct ? (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--danger)"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              )}
            </span>
            <span className="feedback-panel__verdict">
              {committedPayload.correct ? 'Nice — correct' : 'Not quite'}
            </span>
            {ratingDelta !== null && (
              <span className="feedback-panel__delta">
                {ratingDelta > 0 ? `+${String(ratingDelta)}` : String(ratingDelta)}
              </span>
            )}
          </div>
          <p className="feedback-panel__explanation">{puzzle.explanation}</p>
          <button type="button" className="feedback-panel__continue" onClick={onContinue}>
            Continue
          </button>
        </div>
      )}
    </div>
  )
}
