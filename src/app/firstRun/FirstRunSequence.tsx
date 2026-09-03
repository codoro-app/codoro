/**
 * Composes `useFirstRunSession` into the real, playable first-run loop —
 * rendered inline by `Home.tsx` in place of its normal JSX when the gate is
 * true (see Home.tsx's own doc comment; this is never a redirect, never a
 * separate route). Dispatches puzzles 1-2 (tap-line, drag-order) through
 * `PuzzleCardShell` and puzzle 3 (scrubber) through `TraceRunnerPuzzle` — the
 * exact same interaction-type dispatch `DailyPage.tsx` already uses for a
 * scrubber-day puzzle, since `PuzzleCardShell` structurally throws on
 * `interaction === 'scrubber'` (see its own doc comment). Once
 * `phase === 'ended'`, renders `FirstRunComplete` (the payoff screen)
 * instead of a puzzle.
 *
 * No desktop right-rail treatment (`sidebarSlot`, the `app-shell__sidebar`
 * companion every other mode page now has) — a deliberate scope decision,
 * not an oversight: first-run is a short, one-time, single-column onboarding
 * flow, and adding a second layout mode to it would cost more than a
 * first-time visitor's few minutes here are worth. Revisit if that turns out
 * wrong on a real desktop cold-start.
 */
import { PuzzleCardShell } from '../practice/PuzzleCardShell'
import { TraceRunnerPuzzle } from '../trace/TraceRunner'
import { useFirstRunSession } from './useFirstRunSession'
import { FirstRunComplete } from './FirstRunComplete'
import { useChallengerName } from '../useChallengerName'
import { saveProfile } from '../../storage'
import type { UserProfile } from '../../storage'

export interface FirstRunSequenceProps {
  /** Called once the player leaves the payoff screen (either CTA) — hands back the updated, already-persisted profile so Home's own state stays in sync. See FirstRunComplete.tsx's own doc comment for why this isn't fired automatically at phase === 'ended'. */
  onComplete: (updatedProfile: UserProfile) => void
}

const PAGE_SHELL_CLASS =
  'app-shell__main flex flex-col gap-4 w-full max-w-[var(--content-width-mobile)] lg:max-w-[var(--content-width-desktop)] mx-auto pt-[var(--space-4)] px-4 pb-4'

export function FirstRunSequence({ onComplete }: FirstRunSequenceProps) {
  const session = useFirstRunSession()
  // Challenge redesign: the payoff screen's ChallengeButton needs the same
  // name-prompt wiring every other surface's own ChallengeButton call site
  // already composes — see BossPage.tsx's identical `challenger` call.
  const challenger = useChallengerName(session.profile, async (updated) => {
    await saveProfile(updated)
  })

  if (session.status === 'error') {
    return (
      <div className={PAGE_SHELL_CLASS}>
        <p className="py-8 px-4 text-center text-text-1">
          We couldn&apos;t load your first puzzles. Please try again.
        </p>
        <button
          type="button"
          className="min-h-11 py-2 px-3 border-0 bg-transparent text-accent text-md font-semibold cursor-pointer"
          onClick={session.retryLoad}
        >
          Try again
        </button>
      </div>
    )
  }

  if (session.status === 'loading' || session.profile === null) {
    return (
      <div className={PAGE_SHELL_CLASS}>
        <p className="py-8 px-4 text-center text-text-1">Loading your first puzzles…</p>
      </div>
    )
  }

  if (session.status === 'empty') {
    return (
      <div className={PAGE_SHELL_CLASS}>
        <p className="py-8 px-4 text-center text-text-1">
          The first-run puzzles aren&apos;t available right now.
        </p>
      </div>
    )
  }

  if (session.phase === 'ended') {
    // Captured into a local const, not read as session.profile directly
    // inside onExit's closure below: the earlier `session.profile === null`
    // early return (this function's "loading" branch above) already proved
    // this non-null for the rest of THIS render, but a closure that reads
    // session.profile again defers that read until the actual click — by
    // then TS can no longer trust the outer narrowing (session.profile
    // could, as far as the type checker knows, have gone back to null).
    // Capturing the already-narrowed value into a const the closure captures
    // instead sidesteps that without an `as`/`!` assertion, which this
    // repo's eslint config forbids both of.
    const profile = session.profile
    return (
      <div className={PAGE_SHELL_CLASS}>
        <FirstRunComplete
          profile={profile}
          correctCount={session.correctCount}
          totalPuzzles={session.totalPuzzles}
          runAttempts={session.runAttempts}
          challengerName={challenger.name}
          onNameNeeded={challenger.setName}
          onExit={() => {
            onComplete(profile)
          }}
        />
      </div>
    )
  }

  if (session.puzzle === null) {
    return (
      <div className={PAGE_SHELL_CLASS}>
        <p className="py-8 px-4 text-center text-text-1">Loading your first puzzles…</p>
      </div>
    )
  }

  return (
    <div className={PAGE_SHELL_CLASS}>
      <p className="m-0 text-center text-sm font-bold text-text-2 uppercase tracking-[0.04em]">
        Puzzle {session.position} of {session.totalPuzzles}
      </p>

      {session.puzzle.interaction === 'scrubber' ? (
        <TraceRunnerPuzzle
          key={session.puzzle.id}
          puzzle={session.puzzle}
          checkpointResults={session.checkpointResults}
          isComplete={session.isComplete}
          solved={session.solved}
          ratingDelta={session.ratingDelta}
          onCheckpointAnswered={session.onCheckpointAnswered}
          onContinue={session.handleContinue}
          timed={false}
          continueLabel="See your results"
        />
      ) : (
        <PuzzleCardShell
          key={session.puzzle.id}
          puzzle={session.puzzle}
          ratingDelta={session.ratingDelta}
          onAnswered={session.handleAnswered}
          onContinue={session.handleContinue}
          continueDestination="next-puzzle"
        />
      )}
    </div>
  )
}
