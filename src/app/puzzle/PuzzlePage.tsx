/**
 * `/puzzle/:id` — Codoro's shareable puzzle link (v2 Phase 1b). Renders any
 * bundled puzzle from `puzzlePool` (the full union — every interaction type;
 * see content/index.ts's own doc comment for why that export exists
 * alongside `quizPool`/`scrubberPool`) in its native interaction, entirely
 * unrated: no `appendAttempt`, no `saveProfile`, no rating math that reaches
 * storage anywhere in this file. A displayed `ratingDelta` is always `null`
 * here, never a computed-but-discarded number.
 *
 * Split the same way TraceRunner.tsx is (outer owns the wouter param, inner
 * is pure props) so the dispatch/unrated logic is directly testable without
 * a Router wrapper: `PuzzlePage` reads `:id` via `useParams` and hands off
 * to the exported `PuzzlePageForId`.
 *
 * Dispatch: quiz interactions (mcq/swipe-binary/tap-line) go through the
 * same `PuzzleCardShell` Practice/Daily/Rush already use; `scrubber` reuses
 * `TraceRunnerPuzzle` (TraceRunner.tsx's exported, session-free inner
 * component) driven by local state instead of `useTraceSession`. Neither
 * shell is forked.
 *
 * `PuzzleCardShell`'s prop type deliberately stays `Puzzle` here (not
 * narrowed to `QuizPuzzle`, the alternative the build plan offered):
 * narrowing it would ripple into `resolvePool`'s generic signature and
 * three unrelated session hooks' state types (Practice/Daily/Rush), all
 * outside this phase's scope, to buy a compile-time guarantee this file's
 * own dispatch test already gives at runtime — it renders every puzzle in
 * the real, bundled `puzzlePool` and asserts nothing throws, the same class
 * of test that would have caught the Phase 2 corrective's P0. See the
 * Phase 1b build-plan amendment for the full reasoning.
 *
 * "Practice more like this": both branches render the same CTA into
 * `/practice?pattern=<slug>` below the puzzle — PracticePage reads that
 * query param once on mount and applies it as the pattern filter (see its
 * own doc comment). Both shells' own Continue button (`PuzzleCardShell`'s
 * `feedback-panel__continue`; `TraceRunnerPuzzle`'s equivalent) now
 * navigates to that same destination via `onContinue` — forking either
 * shell to hide the button was ruled out (still true), but an earlier
 * version of this file wired `onContinue` as a no-op, leaving a button
 * that looked actionable and did nothing. On a tall completed trace
 * puzzle the CTA sits far below the fold, so the dead Continue sat right
 * under the feedback panel and read as the obvious next action; on a
 * short quiz card the CTA was visible enough that the same dead button
 * went unnoticed. Same defect, different visibility — both branches are
 * fixed here, not just the one that was reported (Phase 5 Item 1).
 */
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'wouter'
import { puzzlePool } from '../../content'
import type { Puzzle, QuizPuzzle, ScrubberPuzzle } from '../../content'
import { scoreScrubberAttempt } from '../../engine'
import type { CheckpointResult } from '../../engine'
import { PuzzleCardShell } from '../practice/PuzzleCardShell'
import { TraceRunnerPuzzle } from '../trace/TraceRunner'
import { trackPuzzleLinkAttempt, trackPuzzleLinkView } from '../../telemetry'
import type { CommitPayload } from '../practice/interactionTypes'
import '../tokens.css'

// 2b.0: was `.puzzle-page` (puzzlePage.css, max-width breakpoint matches
// Tailwind's `lg` exactly) and `.puzzle-page__cta`. Not test-asserted
// (grep-verified).
const PAGE_SHELL_CLASS =
  'app-shell__main flex flex-col gap-4 w-full max-w-[var(--content-width-mobile)] lg:max-w-[var(--content-width-desktop)] mx-auto pt-[var(--space-4)] px-4 pb-4'
const CTA_CLASS =
  'inline-flex self-start items-center min-h-11 py-2 px-3 rounded-sm border border-border bg-surface-1 text-accent font-semibold no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

function isScrubberPuzzle(puzzle: Puzzle): puzzle is ScrubberPuzzle {
  return puzzle.interaction === 'scrubber'
}

interface PracticeMoreCtaProps {
  pattern: Puzzle['pattern']
}

function PracticeMoreCta({ pattern }: PracticeMoreCtaProps) {
  return (
    <Link href={`/practice?pattern=${pattern}`} className={CTA_CLASS}>
      Practice more like this
    </Link>
  )
}

interface QuizLinkPuzzleProps {
  puzzle: QuizPuzzle
}

function QuizLinkPuzzle({ puzzle }: QuizLinkPuzzleProps) {
  const [, navigate] = useLocation()
  const servedAtRef = useRef(0)
  useEffect(() => {
    servedAtRef.current = Date.now()
  }, [])

  const handleAnswered = (payload: CommitPayload) => {
    trackPuzzleLinkAttempt({
      puzzle_id: puzzle.id,
      interaction: puzzle.interaction,
      correct: payload.correct,
      time_ms: Math.max(0, Date.now() - servedAtRef.current),
    })
  }

  return (
    <>
      <PuzzleCardShell
        puzzle={puzzle}
        ratingDelta={null}
        onAnswered={handleAnswered}
        onContinue={() => {
          navigate(`/practice?pattern=${puzzle.pattern}`)
        }}
      />
      <PracticeMoreCta pattern={puzzle.pattern} />
    </>
  )
}

interface ScrubberLinkPuzzleProps {
  puzzle: ScrubberPuzzle
}

function ScrubberLinkPuzzle({ puzzle }: ScrubberLinkPuzzleProps) {
  const [, navigate] = useLocation()
  const [checkpointResults, setCheckpointResults] = useState<CheckpointResult[]>([])
  const servedAtRef = useRef(0)
  useEffect(() => {
    servedAtRef.current = Date.now()
  }, [])

  // Source of truth for "how many checkpoints answered so far", mutated
  // synchronously — mirrors useTraceSession's own checkpointResultsRef.
  // setState updaters must stay pure (React may invoke one more than once
  // for a single logical update, and this app renders under StrictMode,
  // which does so deliberately in development); telemetry is a side
  // effect, so it can't live inside the updater the way it used to.
  const checkpointResultsRef = useRef<CheckpointResult[]>([])

  const isComplete = checkpointResults.length >= puzzle.checkpoints.length
  const solved = isComplete ? scoreScrubberAttempt(checkpointResults) : null

  const handleCheckpointAnswered = (result: CheckpointResult) => {
    if (checkpointResultsRef.current.length >= puzzle.checkpoints.length) return // already complete — mirrors useTraceSession's no-op guard

    const next = [...checkpointResultsRef.current, result]
    checkpointResultsRef.current = next
    setCheckpointResults(next)

    if (next.length >= puzzle.checkpoints.length) {
      trackPuzzleLinkAttempt({
        puzzle_id: puzzle.id,
        interaction: puzzle.interaction,
        correct: scoreScrubberAttempt(next),
        time_ms: Math.max(0, Date.now() - servedAtRef.current),
      })
    }
  }

  return (
    <>
      <TraceRunnerPuzzle
        puzzle={puzzle}
        checkpointResults={checkpointResults}
        isComplete={isComplete}
        solved={solved}
        ratingDelta={null}
        onCheckpointAnswered={handleCheckpointAnswered}
        onContinue={() => {
          navigate(`/practice?pattern=${puzzle.pattern}`)
        }}
        timed={false}
      />
      <PracticeMoreCta pattern={puzzle.pattern} />
    </>
  )
}

export interface PuzzlePageForIdProps {
  id: string
}

/** Pure, props-driven inner component — exported so tests can drive it directly against the real puzzlePool without a Router wrapper. */
export function PuzzlePageForId({ id }: PuzzlePageForIdProps) {
  const puzzle = puzzlePool.find((candidate) => candidate.id === id)

  useEffect(() => {
    trackPuzzleLinkView({
      puzzle_id: id,
      interaction: puzzle?.interaction ?? null,
      found: puzzle !== undefined,
    })
    // Fire once per id, not on every render/puzzle-object-identity-change —
    // puzzlePool entries are stable module-level objects, so `id` alone is
    // the correct dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  if (!puzzle) {
    return (
      <div className={PAGE_SHELL_CLASS}>
        <p className="text-center text-text-1 py-8">
          We couldn&apos;t find that puzzle — the link may be wrong, or the puzzle was removed.
        </p>
        <Link href="/practice" className={CTA_CLASS}>
          Go to Practice
        </Link>
      </div>
    )
  }

  return (
    <div className={PAGE_SHELL_CLASS}>
      {isScrubberPuzzle(puzzle) ? (
        <ScrubberLinkPuzzle puzzle={puzzle} />
      ) : (
        <QuizLinkPuzzle puzzle={puzzle} />
      )}
    </div>
  )
}

export function PuzzlePage() {
  const { id } = useParams<{ id: string }>()
  return <PuzzlePageForId id={id} />
}
