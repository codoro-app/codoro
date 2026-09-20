/**
 * The wrong-answer coach block — v6 Phase 6.1. Renders inside
 * PuzzleCardShell.tsx's existing feedback panel, below the free
 * `explanation` paragraph, never replacing it (spec §5.3/§6). On mobile this
 * means INSIDE the drawer's existing `overflow-y-auto` scroll region — this
 * component renders no scroll container of its own.
 *
 * Only ever mounted for a wrong, coach-eligible commit on an explainable
 * interaction (mcq/tap-line/swipe-binary) — PuzzleCardShell owns all of
 * those gates and unmounts this between puzzles the same way it does every
 * other post-commit block.
 */
import { useEffect, useRef, useState } from 'react'
import type { Puzzle } from '../../content'
import type { ExplanationEntry } from '../../content/explanationSchema'
import { MISCONCEPTION_LABELS } from '../../content/misconceptions'
import { WEEKLY_COACH_LIMIT } from '../../coach/coachMeter'
import { loadCoachExplanationSet } from './coachExplanationCache'
import { renderInlineMarkdown } from './inlineMarkdown'
import type { CommitPayload } from './interactionTypes'

export interface CoachPanelProps {
  puzzle: Puzzle
  committedPayload: CommitPayload
  /**
   * Whether there is coach budget to fetch+show a real explanation right
   * now — entitled OR has weekly meter remaining. Caller-resolved (this
   * component has no profile/entitlement access of its own); `false` means
   * "meter spent," not "ineligible" — PuzzleCardShell never mounts this
   * component at all for an ineligible mode (Rush) or a correct answer.
   */
  coachAvailable: boolean
  /**
   * Fires once, the instant this panel actually renders a real fetched
   * explanation (never for the spent-meter line, never on a fetch that
   * comes back empty/missing). See PuzzleCardShellProps' identical prop for
   * why the meter-consumption decision lives at the caller, not here.
   */
  onCoachExplanationShown: () => void
}

/** The wrong target this puzzle's commit corresponds to — see explanationSchema.ts's `target` doc comment for why swipe-binary is always 0. */
function targetFor(puzzle: Puzzle, payload: CommitPayload): number | null {
  if (puzzle.interaction === 'swipe-binary') return 0
  return payload.choiceIndex
}

type LoadState =
  { kind: 'loading' } | { kind: 'ready'; entry: ExplanationEntry } | { kind: 'unavailable' } // no file yet, or no entry for this target — a real, expected case

export function CoachPanel({
  puzzle,
  committedPayload,
  coachAvailable,
  onCoachExplanationShown,
}: CoachPanelProps) {
  const target = targetFor(puzzle, committedPayload)
  const explainable =
    target !== null &&
    (puzzle.interaction === 'mcq' ||
      puzzle.interaction === 'tap-line' ||
      puzzle.interaction === 'swipe-binary')

  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  // Guards against onCoachExplanationShown firing twice for one commit (a
  // dev-mode double-effect, or a re-render before the fetch resolves) — same
  // convention as PuzzleCardShell's own autoAdvanceResolvedRef.
  const shownRef = useRef(false)

  useEffect(() => {
    shownRef.current = false
    // Spent meter (or an unexplainable interaction): never fetch — this is
    // both the bundle-discipline requirement and the closest thing this
    // layer has to access control (spec §5.2). Piece 3's free-tier
    // treatment renders directly from props, no state needed. Same
    // external-prop-driven, one-time-per-change posture as
    // PuzzleCardShell.tsx's own forcedCommit effect (see its doc comment)
    // — this is reacting to `coachAvailable`/`explainable` actually
    // changing, not redundantly re-deriving state React could compute
    // during render.
    if (!coachAvailable || !explainable) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ kind: 'unavailable' })
      return
    }
    setState({ kind: 'loading' })
    let cancelled = false
    loadCoachExplanationSet(puzzle.id)
      .then((set) => {
        if (cancelled) return
        const entry = set?.entries.find((e) => e.target === target)
        setState(entry ? { kind: 'ready', entry } : { kind: 'unavailable' })
      })
      .catch(() => {
        if (cancelled) return
        setState({ kind: 'unavailable' })
      })
    return () => {
      cancelled = true
    }
  }, [puzzle.id, target, coachAvailable, explainable])

  useEffect(() => {
    if (state.kind === 'ready' && !shownRef.current) {
      shownRef.current = true
      onCoachExplanationShown()
    }
    // onCoachExplanationShown intentionally excluded: callers pass a fresh
    // closure most renders, and shownRef already guards against refiring
    // for the same puzzle — including it would refire this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  if (!explainable) return null

  if (!coachAvailable) {
    return (
      <div className="mt-3 pt-3 border-t border-border">
        <p className="m-0 text-text-1 text-[0.8125rem] leading-[1.4]">
          You&apos;ve used your {WEEKLY_COACH_LIMIT} coach explanations this week. More next week.
        </p>
      </div>
    )
  }

  if (state.kind !== 'ready') return null

  return (
    <div className="mt-3 pt-3 border-t border-border flex flex-col gap-1.5">
      <p className="m-0 text-accent text-[0.75rem] font-bold uppercase tracking-wide">
        {MISCONCEPTION_LABELS[state.entry.misconception]}
      </p>
      <p className="m-0 text-text-0 text-[0.9375rem] leading-[1.45]">
        {renderInlineMarkdown(state.entry.why_wrong)}
      </p>
    </div>
  )
}
