/**
 * Rush's `'playing'`-phase JSX (strikes/solved header, per-puzzle timer,
 * `PuzzleCardShell`), extracted verbatim from `RushPage.tsx` — pure
 * extraction, zero behavior change (v3 Phase 2 build item 1: Missions'
 * `SpeedStage` reuses this directly rather than forking Rush's own
 * presentation). `RushPage.tsx` still owns the `'ended'` branch
 * (`RushShareCard`/`RushChallengeCard` are Rush-standalone-specific and
 * don't belong inside a mission's own stage-transition screen — see
 * `docs/superpowers/plans/2026-08-11-missions-definition-and-plan.md`).
 *
 * `onContinue` is overridable so a mission's stage wrapper can intercept it
 * (check the shared stage clock before deciding to advance) without this
 * component or `useRushSession` itself needing to know Missions exist —
 * defaults to `session.handleContinue`, RushPage's own original behavior.
 */
import { PuzzleCardShell } from '../practice/PuzzleCardShell'
import { RushIcon } from '../Icons'
import { RUSH_PUZZLE_TIME_LIMIT_MS } from './useRushSession'
import type { RushSession } from './useRushSession'

export interface RushActivePlayProps {
  session: RushSession
  onContinue?: () => void
}

export function RushActivePlay({ session, onContinue }: RushActivePlayProps) {
  return (
    <>
      <div className="rush-header">
        <div
          className="rush-strikes"
          role="status"
          aria-label={`${String(session.strikes)} of 3 strikes`}
        >
          {[0, 1, 2].map((slot) => (
            <span
              key={slot}
              className={`rush-strikes__slot${
                slot < session.strikes ? ' rush-strikes__slot--missed' : ''
              }`}
              aria-hidden="true"
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1.5 text-text-1 text-sm" title="Solved this run">
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
            <span>{session.solvedCount} solved</span>
          </div>
          {session.currentStreak >= 2 && (
            <div className="status-bar__combo flex items-center gap-1.5 min-h-11 py-1.5 px-3 rounded-full bg-ok-dim text-accent font-bold">
              <RushIcon size={14} />
              <span>{session.currentStreak} in a row</span>
            </div>
          )}
        </div>
      </div>
      <div className="rush-timer-row">
        <div
          className="rush-timer"
          role="progressbar"
          aria-label="Time remaining for this puzzle"
          aria-valuemin={0}
          aria-valuemax={RUSH_PUZZLE_TIME_LIMIT_MS}
          aria-valuenow={Math.round(session.remainingMs)}
        >
          <div
            className="rush-timer__fill"
            style={{
              width: `${String((session.remainingMs / RUSH_PUZZLE_TIME_LIMIT_MS) * 100)}%`,
            }}
          />
        </div>
        <span className="rush-timer__seconds" aria-hidden="true">
          {Math.ceil(session.remainingMs / 1000)}s
        </span>
      </div>

      {session.puzzle && (
        <PuzzleCardShell
          key={session.puzzle.id}
          puzzle={session.puzzle}
          ratingDelta={null}
          onAnswered={session.handleAnswered}
          onContinue={onContinue ?? session.handleContinue}
          forcedCommit={session.forcedCommit}
        />
      )}
    </>
  )
}
