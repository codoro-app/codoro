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
import { useMediaQuery } from '../useMediaQuery'
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
  /** What pressing Continue does next — previewed on the button itself (icon + label). Defaults to `'next-puzzle'`. See `ContinueDestination`'s own doc comment. */
  continueDestination?: ContinueDestination
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

// 2b.0: was `.feedback-panel--correct`/`--wrong` + their descendant
// icon/verdict/delta color overrides (tokens.css) — reused verbatim in
// TraceRunner.tsx's identical feedback panel. `feedback-panel` itself stays
// literal (tokens.css keeps its entrance-animation keyframes keyed to it);
// `feedback-panel__delta` stays literal too — PuzzlePage.test.tsx asserts
// on it directly.
const FEEDBACK_BASE = 'feedback-panel flex flex-col gap-3 p-4 rounded-xl border-[1.5px]'
function feedbackPanelClass(correct: boolean): string {
  return correct
    ? `${FEEDBACK_BASE} border-accent [background:linear-gradient(160deg,var(--ok-dim),var(--surface-1))]`
    : `${FEEDBACK_BASE} border-danger [background:linear-gradient(160deg,var(--danger-dim),var(--surface-1))]`
}
function feedbackAccentClass(correct: boolean): string {
  return correct ? 'text-accent' : 'text-danger'
}
const FEEDBACK_CONTINUE_CLASS =
  'flex items-center justify-center gap-2 min-h-11 w-full py-3.5 px-4 border-0 rounded-md bg-accent text-accent-ink text-base font-bold cursor-pointer transition-[transform,opacity] duration-[0.05s] ease-out active:scale-[0.98] active:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

// 2b.9 (feedback-fit bug, 2026-08-21): mobile no longer splits the result
// into a normal-flow feedback panel (scrolls away with the page) plus a
// separate sticky bar holding only Continue (the original 2b.2 shape, kept
// below for history) — the explanation text was routinely scrolled out of
// reach even though the button stayed pinned, exactly the "user has to
// scroll to see why" bug report. The whole result — icon/verdict/delta,
// explanation, Continue — is now ONE sticky drawer: this class wraps it,
// `feedbackPanelClass`/`drawerPanelClass` style the bordered panel inside
// it. `bg-surface-0 border-t border-border` matches PageShell's own
// `stickyAction` slot treatment (PageShell.tsx) for the same reason: this
// is functionally that same pinned-CTA pattern, kept local to this
// component instead of threading every caller through PageShell explicitly.
//
// What makes this safe where a naive "just make the whole panel sticky"
// attempt previously wasn't: `drawerPanelClass` caps the panel's height and
// only the explanation paragraph inside it scrolls (`overflow-y-auto`).
// Sticky positioning pins a box to the viewport edge but does nothing to
// shrink its content — an uncapped panel with a long explanation grew
// taller than the viewport and broke exactly the way this file's history
// warns about. Capping the panel and scrolling only the explanation is what
// keeps the banner and the button always visible regardless of explanation
// length.
//
// 2b.2 (click-meaningfulness, original rationale — still why this drawer is
// a sibling of `.puzzle-card`, not nested inside it): a sticky element
// nested inside a normal-flow, non-sticky card would visually detach from
// that card's chrome once pinned to the viewport edge, since the card's own
// background/border don't scroll with it. Here the *entire* bordered panel
// is what's sticky (not just a bar below it), so nesting Continue inside
// that panel — instead of outside it, as the original 2b.2 bar did — no
// longer has that problem: the whole thing, border/gradient/button
// included, is one pinned unit.
//
// Desktop dropped the sticky treatment entirely (see `isDesktop` below)
// rather than applying the same cap: desktop has the width to just place
// Continue inline above a normal-flow, uncapped feedback panel instead.
//
// 2b.8: offset `bottom-[var(--bottom-nav-height)]`, not flush `bottom-0` —
// AppShell.tsx now renders a fixed BottomNav at the viewport bottom on
// mobile (this drawer's only rendered width), and a flush offset would sit
// this drawer directly underneath it. No `lg:` fallback needed: this
// drawer never renders on desktop at all (see `isDesktop` below), unlike
// PageShell.tsx's `stickyAction` slot which does.
const FEEDBACK_DRAWER_CLASS =
  'sticky bottom-[var(--bottom-nav-height)] z-10 bg-surface-0 border-t border-border'

// Caps the drawer's panel so a long explanation scrolls *inside* it instead
// of growing the panel past the viewport (see FEEDBACK_DRAWER_CLASS's
// comment above for why that matters). `min-h` keeps the banner+button from
// ever being squeezed out on a very short viewport; `max-h` is what
// actually bounds growth. Children rely on this being `flex flex-col`
// (inherited from `feedbackPanelClass`/`FEEDBACK_BASE`): the header row and
// Continue button both get `flex-none` so only the explanation paragraph
// (`flex-1 min-h-0 overflow-y-auto`) is the part that scrolls.
function drawerPanelClass(correct: boolean): string {
  return `${feedbackPanelClass(correct)} min-h-[128px] max-h-[46dvh]`
}

// Desktop's inline placement (see `isDesktop` below): same button, not
// full-width (it sits beside the feedback panel's own width, right-aligned,
// not spanning a dedicated bar) and never sticky (it's positioned above the
// feedback panel in normal flow, so there's nothing for it to overlap).
const DESKTOP_CONTINUE_CLASS =
  'flex items-center justify-center gap-2 min-h-11 py-3 px-6 border-0 rounded-md bg-accent text-accent-ink text-base font-bold cursor-pointer transition-[transform,opacity] duration-[0.05s] ease-out active:scale-[0.98] active:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

/**
 * What pressing Continue actually does next — the gating-tap fix
 * (docs/design/click-meaningfulness.md §2): a bare "Continue" previews
 * nothing, so every caller now states its destination explicitly instead of
 * leaving the tap a blind advance. `'next-puzzle'` is the default because
 * it's every mode's common case (Practice/Trace never end; Rush/Boss are
 * `'next-puzzle'` on every puzzle except the one that ends the run).
 */
export type ContinueDestination = 'next-puzzle' | 'results' | 'retry'

function ContinueIcon({ destination }: { destination: ContinueDestination }) {
  if (destination === 'results') {
    return (
      <svg
        aria-hidden="true"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M5 3v18" />
        <path d="M5 4h11l-2.5 3.5L16 11H5" />
      </svg>
    )
  }
  if (destination === 'retry') {
    return (
      <svg
        aria-hidden="true"
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M3 12a9 9 0 1 1 2.64 6.36" />
        <polyline points="3 20 3 14 9 14" />
      </svg>
    )
  }
  return (
    <svg
      aria-hidden="true"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  )
}

function continueLabel(destination: ContinueDestination): string {
  if (destination === 'results') return 'See results'
  if (destination === 'retry') return 'Try again'
  return 'Next puzzle'
}

function FeedbackIcon({ correct }: { correct: boolean }) {
  return correct ? (
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
  )
}

/**
 * Icon + verdict text + rating delta — identical between desktop's
 * normal-flow feedback panel and mobile's drawer panel, so both build on
 * this instead of hand-copying the same three spans. `flex-none` so it
 * never shrinks inside the drawer's capped, `flex flex-col` panel (see
 * `drawerPanelClass`'s doc comment) — only the explanation paragraph next
 * to it is meant to give up height.
 */
function FeedbackHeader({
  correct,
  ratingDelta,
}: {
  correct: boolean
  ratingDelta: number | null
}) {
  return (
    <div className="flex items-center gap-2 flex-none">
      <span className={`flex items-center ${feedbackAccentClass(correct)}`} aria-hidden="true">
        <FeedbackIcon correct={correct} />
      </span>
      <span className={`flex-1 font-bold text-base ${feedbackAccentClass(correct)}`}>
        {correct ? 'Nice — correct' : 'Not quite'}
      </span>
      {ratingDelta !== null && (
        <span
          className={`feedback-panel__delta font-mono font-bold tabular-nums ${feedbackAccentClass(correct)}`}
        >
          {ratingDelta > 0 ? `+${String(ratingDelta)}` : String(ratingDelta)}
        </span>
      )}
    </div>
  )
}

/** The Continue button itself — shared by both of its placements below (mobile's sticky bar, desktop's inline slot) so the two stay in sync instead of drifting as two hand-copied buttons. */
function ContinueCta({
  className,
  destination,
  onContinue,
}: {
  className: string
  destination: ContinueDestination
  onContinue: () => void
}) {
  return (
    <button type="button" className={className} onClick={onContinue}>
      {continueLabel(destination)}
      <ContinueIcon destination={destination} />
    </button>
  )
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
  continueDestination = 'next-puzzle',
}: PuzzleCardShellProps) {
  const [commit, setCommit] = useState<CommitState | null>(null)
  // Purely a Continue-button placement switch (bug report, 2026-08-12) — see
  // CONTINUE_BAR_CLASS's doc comment above for why this needs an actual
  // structural move (a different parent, sticky vs. not) rather than a pure
  // CSS reorder within one shared container.
  const isDesktop = useMediaQuery('(min-width: 1024px)')

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
  // a fixed snippet with tap targets, so it doesn't need an *interactive*
  // copy of its own (DragOrder.tsx owns only the block list) — but a
  // format: 'output' puzzle's `blocks` describe execution/output of a real
  // snippet ("clamps n to 2", "Logs 'C'"), unreadable without seeing that
  // code, so it gets the same static, read-only CodeSnippet mcq/scrubber
  // get, just not its own interactive one. A format: 'code' puzzle's
  // `blocks` ARE fragments of `snippet` being reassembled into it — showing
  // the snippet there hands the player the solved answer (see
  // DragOrderSchema's doc comment), so it stays suppressed, same as
  // tap-line/swipe-binary.
  const staticLines =
    puzzle.interaction === 'tap-line' ||
    puzzle.interaction === 'swipe-binary' ||
    (puzzle.interaction === 'drag-order' && puzzle.format === 'code')
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
    <>
      {/* `puzzle-card` stays literal (no styling of its own now) — App.test.tsx/
          ChallengePage.test.tsx/PuzzlePage.test.tsx all use it as a
          root-marker selector to confirm the quiz shell (vs. Trace's
          `.trace-runner`) mounted. */}
      <div className="puzzle-card flex flex-col gap-4 w-full max-w-[var(--content-width-mobile)] mx-auto p-4">
        <p className="m-0 text-center text-xl font-semibold text-text-0">{puzzle.prompt}</p>

        {staticLines && <CodeSnippet lines={staticLines} />}

        <div className="flex flex-col">{interactionBody}</div>

        {committed && committedPayload && isDesktop && (
          <>
            <div className="flex justify-end">
              <ContinueCta
                className={DESKTOP_CONTINUE_CLASS}
                destination={continueDestination}
                onContinue={onContinue}
              />
            </div>
            <div className={feedbackPanelClass(committedPayload.correct)} role="status">
              <FeedbackHeader correct={committedPayload.correct} ratingDelta={ratingDelta} />
              <p className="m-0 text-text-0 text-[0.9375rem] leading-[1.45]">
                {puzzle.explanation}
              </p>
            </div>
          </>
        )}
      </div>

      {committed && committedPayload && !isDesktop && (
        <div className={FEEDBACK_DRAWER_CLASS}>
          <div className="w-full max-w-[var(--content-width-mobile)] mx-auto px-4 py-3">
            <div className={drawerPanelClass(committedPayload.correct)} role="status">
              <FeedbackHeader correct={committedPayload.correct} ratingDelta={ratingDelta} />
              {/* flex-1 min-h-0 is what lets this shrink and scroll inside
                  the panel's flex column instead of forcing the panel past
                  its max-height cap — see drawerPanelClass's doc comment. */}
              <p
                className="m-0 flex-1 min-h-0 overflow-y-auto text-text-0 text-[0.9375rem] leading-[1.45]"
                style={{ WebkitOverflowScrolling: 'touch' }}
              >
                {puzzle.explanation}
              </p>
              <ContinueCta
                className={`${FEEDBACK_CONTINUE_CLASS} flex-none`}
                destination={continueDestination}
                onContinue={onContinue}
              />
            </div>
          </div>
        </div>
      )}
    </>
  )
}
