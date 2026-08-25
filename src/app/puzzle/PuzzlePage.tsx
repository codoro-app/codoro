/**
 * `/puzzle/:id` — Codoro's shareable puzzle link (v2 Phase 1b). Renders any
 * bundled puzzle (the full union — every interaction type) in its native
 * interaction, entirely unrated: no `appendAttempt`, no `saveProfile`, no
 * rating math that reaches storage anywhere in this file. A displayed
 * `ratingDelta` is always `null` here, never a computed-but-discarded number.
 *
 * Puzzle bodies are fetched on demand via `getPuzzleBody` (Task 6 of the
 * content-metadata-lazy-load follow-up) rather than read from the eager
 * `puzzlePool` — a genuine async hop, so this file renders three distinct
 * terminal states the synchronous lookup never needed: loading, a retryable
 * "couldn't load" state for a rejected fetch, and the pre-existing not-found
 * state for a genuinely missing id (`getPuzzleBody` resolving `undefined`).
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
import { getPuzzleBody } from '../../content'
import type { Puzzle, QuizPuzzle, ScrubberPuzzle } from '../../content'
import { scoreScrubberAttempt } from '../../engine'
import type { CheckpointResult } from '../../engine'
import { PuzzleCardShell } from '../practice/PuzzleCardShell'
import { TraceRunnerPuzzle } from '../trace/TraceRunner'
import { trackError, trackPuzzleLinkAttempt, trackPuzzleLinkView } from '../../telemetry'
import type { CommitPayload } from '../practice/interactionTypes'
import '../tokens.css'

// 2b.0: was `.puzzle-page` (puzzlePage.css, max-width breakpoint matches
// Tailwind's `lg` exactly) and `.puzzle-page__cta`. Not test-asserted
// (grep-verified).
const PAGE_SHELL_CLASS =
  'app-shell__main flex flex-col gap-4 w-full max-w-[var(--content-width-mobile)] lg:max-w-[var(--content-width-desktop)] mx-auto pt-[var(--space-4)] px-4 pb-4'
const CTA_CLASS =
  'inline-flex self-start items-center min-h-11 py-2 px-3 rounded-sm border border-border bg-surface-1 text-accent font-semibold no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'
// The "Try again" button on the load-failure state — same classname
// DailyPage/RushPage use for theirs, so every retry affordance in the app
// reads identically.
const RETRY_CLASS =
  'min-h-11 py-2 px-3 border-0 bg-transparent text-accent text-md font-semibold cursor-pointer'

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

/** Pure, props-driven inner component — exported so tests can drive it directly, by id, without a Router wrapper. */
export function PuzzlePageForId({ id }: PuzzlePageForIdProps) {
  // Task 6 (content-metadata-lazy-load follow-up): was a synchronous
  // `puzzlePool.find(...)` against the eager pool. `getPuzzleBody` is a
  // genuine async hop, so lookup state and "not found" state must render
  // distinctly — `puzzle === undefined` alone can't tell "still loading" from
  // "genuinely missing" the way it could when the lookup was synchronous.
  const [puzzle, setPuzzle] = useState<Puzzle | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  // Final-review finding: a rejected `getPuzzleBody` used to fall through to
  // the not-found state below, telling a player their link was "wrong, or the
  // puzzle was removed" when the real cause was usually a dropped connection.
  // This surface is a *shared link* destination — arriving on mobile, on a
  // flaky network, is its most common case, not an edge case — and that copy
  // is both wrong and unactionable there (it sends them away from a link that
  // works fine). Tracked separately from `puzzle === undefined` so the two
  // genuinely different failures can render differently; every other surface
  // this branch converted (Boss/Practice/Trace/Rush/Daily) already has this
  // distinction via its session hook's `status: 'error'`.
  const [failed, setFailed] = useState(false)
  // Bumped by the "Try again" button; part of the effect's dep array, so
  // incrementing it re-runs the whole fetch. The lightweight equivalent of
  // useBossSession's `retryLoad` — this page has one fetch and no session
  // state to reset, so it needs no shared load()/retryLoad() machinery.
  const [retryCount, setRetryCount] = useState(0)
  // Review fix (post-Task-6): a single shared `useRef(false)`, reset to
  // `false` at the TOP of every effect run and set `true` only in that
  // run's own cleanup, cannot distinguish "the run that got cancelled" from
  // "the run that replaced it" — when `id` changes, React runs the OLD
  // run's cleanup (sets the shared ref true) and then the NEW run's setup
  // (immediately resets that same shared ref back to false), which
  // re-arms the guard the old run's own in-flight fetch was relying on. A
  // slower-to-resolve fetch for an earlier id can then land AFTER a
  // faster-to-resolve fetch for a later id and win, rendering the wrong
  // puzzle at the current URL (this route has no `key`, so a link-to-link
  // navigation changes `id` without a remount — App.tsx's
  // `<Route path="/puzzle/:id">` — so this is reachable in the real app,
  // not just synthetically).
  //
  // Fix: an ever-incrementing counter. Each run captures its own token by
  // incrementing it in setup; each run's cleanup ALSO increments it — so
  // an older run's token can never again equal the counter's current
  // value, whether it was superseded by a newer run (whose own setup
  // bumps the counter again right after) or the component simply
  // unmounted (nothing else will ever bump the counter again, but this
  // run's own cleanup already did). Comparing "is my token still the
  // latest" — not a boolean flag — is what makes this survive re-runs,
  // repeats (React StrictMode's dev-only double-invoke of the same id
  // produces two distinct tokens too, so only the second, "real", run's
  // fetch can ever pass the check and fire trackPuzzleLinkView below).
  const runTokenRef = useRef(0)

  useEffect(() => {
    const token = ++runTokenRef.current
    void (async () => {
      // The loading/puzzle reset lives here, as the first synchronous work
      // inside the async callback (not as the effect body's own first
      // statement) — react-hooks/set-state-in-effect reads a bare
      // "first-statement setState" as the resetting-state-on-prop-change
      // anti-pattern react.dev warns about. This still runs synchronously,
      // in the same tick as every other call in this effect (JS runs an
      // async function's body up to its first `await` immediately) — same
      // timing, different syntactic position.
      setLoading(true)
      setPuzzle(undefined)
      setFailed(false)
      try {
        const result = await getPuzzleBody(id)
        if (runTokenRef.current !== token) return // superseded — see runTokenRef's doc comment
        setPuzzle(result)
        setLoading(false)
        // Fires once per id, the instant its lookup settles (found or
        // not) — same "once per id" contract as before, just decided
        // after the fetch resolves instead of synchronously against the
        // eager puzzlePool.
        trackPuzzleLinkView({
          puzzle_id: id,
          interaction: result?.interaction ?? null,
          found: result !== undefined,
        })
      } catch (error) {
        // getPuzzleBody can reject (a failed dynamic import — offline, or a
        // deploy-invalidated chunk — or the zod validation throw on
        // invalid content, which now runs in production too, unlike
        // ./pools's puzzlePool's DEV-only validation). Without this catch
        // the page would hang in `loading` forever. Renders the retryable
        // error state, NOT the not-found state — see `failed`'s comment.
        // Note there's no trackPuzzleLinkView here: the lookup never
        // settled, so "found: false" would be a lie, and a retry that
        // succeeds fires the real view event then.
        if (runTokenRef.current !== token) return
        trackError(error, 'PuzzlePage: getPuzzleBody failed')
        setFailed(true)
        setLoading(false)
      }
    })()
    return () => {
      // Bump the token here too, not just in the next run's own setup:
      // setup-side bumping alone handles the re-run case (a new id) fine,
      // but on a genuine unmount no further setup ever runs to invalidate
      // this run's token — this cleanup is the only chance to do that.
      runTokenRef.current += 1
    }
  }, [id, retryCount])

  if (loading) {
    return (
      <div className={PAGE_SHELL_CLASS}>
        <p className="text-center text-text-1 py-8">Loading puzzle…</p>
      </div>
    )
  }

  if (failed) {
    return (
      <div className={PAGE_SHELL_CLASS}>
        <p className="text-center text-text-1 py-8">
          We couldn&apos;t load this puzzle. Please check your connection and try again.
        </p>
        <button
          type="button"
          className={RETRY_CLASS}
          onClick={() => {
            setRetryCount((count) => count + 1)
          }}
        >
          Try again
        </button>
      </div>
    )
  }

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
