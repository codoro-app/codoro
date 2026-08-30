/**
 * Rush's `'playing'`-phase JSX (strikes/solved header, per-puzzle timer,
 * `PuzzleCardShell`), extracted verbatim from `RushPage.tsx` — pure
 * extraction, zero behavior change (v3 Phase 2 build item 1: Missions'
 * `SpeedStage` reuses this directly rather than forking Rush's own
 * presentation). `RushPage.tsx` still owns the `'ended'` branch (its
 * `ShareMenu` usage is Rush-standalone-specific and doesn't belong inside a
 * mission's own stage-transition screen — see
 * `docs/superpowers/plans/2026-08-11-missions-definition-and-plan.md`).
 *
 * `onContinue` is overridable so a mission's stage wrapper can intercept it
 * (check the shared stage clock before deciding to advance) without this
 * component or `useRushSession` itself needing to know Missions exist —
 * defaults to `session.handleContinue`, RushPage's own original behavior.
 */
import { createPortal } from 'react-dom'
import { PuzzleCardShell } from '../practice/PuzzleCardShell'
import { RushIcon } from '../Icons'
import { RUSH_PUZZLE_TIME_LIMIT_MS } from './useRushSession'
import type { RushSession } from './useRushSession'

export interface RushActivePlayProps {
  session: RushSession
  onContinue?: () => void
  /**
   * Desktop right-rail target (v4 Phase 4.5 — "the right rail"), same
   * `createPortal` pattern as PuzzleCardShell.tsx's identical prop. Two
   * pieces portal here when set: the strikes/solved/timer status row
   * (moved) and, forwarded straight through, PuzzleCardShell's own
   * post-commit feedback block. Omitted or `null` falls back to the
   * pre-existing inline placement for both — every existing caller
   * (RushPage.tsx, Missions' SpeedStage) keeps working unchanged.
   */
  sidebarSlot?: HTMLElement | null
}

export function RushActivePlay({ session, onContinue, sidebarSlot = null }: RushActivePlayProps) {
  const statusContent = (
    <>
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div
          className="flex gap-2"
          role="status"
          aria-label={`${String(session.strikes)} of 3 strikes`}
        >
          {[0, 1, 2].map((slot) => (
            <span
              key={slot}
              className={
                slot < session.strikes
                  ? 'w-3.5 h-3.5 rounded-full border-2 border-danger bg-danger'
                  : 'w-3.5 h-3.5 rounded-full border-2 border-border-strong bg-transparent'
              }
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
      <div className="flex items-center gap-2">
        <div
          className="flex-1 h-1.5 rounded-full bg-surface-2 overflow-hidden"
          role="progressbar"
          aria-label="Time remaining for this puzzle"
          aria-valuemin={0}
          aria-valuemax={RUSH_PUZZLE_TIME_LIMIT_MS}
          aria-valuenow={Math.round(session.remainingMs)}
        >
          <div
            className="h-full bg-accent transition-[width] duration-100 ease-linear"
            style={{
              width: `${String((session.remainingMs / RUSH_PUZZLE_TIME_LIMIT_MS) * 100)}%`,
            }}
          />
        </div>
        <span
          className="flex-none min-w-[2ch] text-right font-mono text-sm text-text-1"
          aria-hidden="true"
        >
          {Math.ceil(session.remainingMs / 1000)}s
        </span>
      </div>
    </>
  )

  return (
    <>
      {!sidebarSlot && statusContent}
      {sidebarSlot && createPortal(statusContent, sidebarSlot)}

      {session.puzzle && (
        <PuzzleCardShell
          key={session.puzzle.id}
          puzzle={session.puzzle}
          ratingDelta={null}
          onAnswered={session.handleAnswered}
          onContinue={onContinue ?? session.handleContinue}
          forcedCommit={session.forcedCommit}
          continueDestination={session.willEndOnContinue ? 'results' : 'next-puzzle'}
          sidebarSlot={sidebarSlot}
        />
      )}
    </>
  )
}
