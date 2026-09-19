/**
 * Boss's `'playing'`-phase JSX (health-bar header, `PuzzleCardShell`),
 * extracted verbatim from `BossPage.tsx` — pure extraction, zero behavior
 * change (v3 Phase 2 build item 1: Missions' `BossStage` reuses this
 * directly rather than forking Boss's own presentation). `BossPage.tsx`
 * still owns the `'ended'` branch (Boss's own end-of-run summary/ghost-pace
 * text doesn't belong inside a mission's own stage-transition screen — see
 * `docs/superpowers/plans/2026-08-11-missions-definition-and-plan.md`,
 * mirroring `RushActivePlay.tsx`'s identical reasoning).
 *
 * `onContinue` is overridable so a mission's stage wrapper can intercept it
 * (check the shared stage clock before deciding to advance) without this
 * component or `useBossSession` itself needing to know Missions exist —
 * defaults to `session.handleContinue`, BossPage's own original behavior.
 */
import { createPortal } from 'react-dom'
import { useState } from 'react'
import { PuzzleCardShell } from '../practice/PuzzleCardShell'
import type { CommitPayload } from '../practice/interactionTypes'
import { DuckMascot } from '../Mascot'
import type { DuckPose } from '../Mascot'
import { ProgressIndicator } from '../ProgressIndicator'
import { BOSS_STRIKE_LIMIT } from '../../engine'
import type { BossSession } from './useBossSession'

export interface BossActivePlayProps {
  session: BossSession
  onContinue?: () => void
  /**
   * Desktop right-rail target (v4 Phase 4.5 — "the right rail"), same
   * `createPortal` pattern as RushActivePlay.tsx's identical prop. Portals
   * the character/health/position status row plus, forwarded through,
   * PuzzleCardShell's own post-commit feedback block. Omitted or `null`
   * falls back to the pre-existing inline placement for both.
   */
  sidebarSlot?: HTMLElement | null
}

/**
 * Redesign (2026-09-18): Boss's bespoke "Glitch" character (BOSS_NAME +
 * BossCharacterIcon, a local one-off SVG) is retired now that DuckMascot is
 * the single app-wide mascot — see docs/redesign/ui-redesign-audit-2026-09-17.md's
 * "Glitch vs. the duck" open decision, resolved. `answered` tracks whether
 * the CURRENT puzzle instance has been answered yet, reset whenever the
 * puzzle identity changes (a fresh puzzle always starts unanswered) — this
 * is the local signal `session` itself doesn't expose (`lastAnswerCorrect`
 * persists as the last answer's outcome across puzzles, it doesn't reset to
 * "unanswered" on its own), needed to tell "actively solving" (debugging)
 * apart from "just answered, showing feedback" (happy/sad).
 */
function useCharacterPose(session: BossSession): {
  pose: DuckPose
  wrapAnswered: (payload: CommitPayload) => void
} {
  const [answered, setAnswered] = useState(false)
  const [trackedPuzzleId, setTrackedPuzzleId] = useState(session.puzzle?.id)
  if (session.puzzle?.id !== trackedPuzzleId) {
    setTrackedPuzzleId(session.puzzle?.id)
    if (answered) setAnswered(false)
  }

  const pose: DuckPose = !session.puzzle
    ? 'idle'
    : !answered
      ? 'debugging'
      : session.lastAnswerCorrect
        ? 'happy'
        : 'sad'

  function wrapAnswered(payload: CommitPayload) {
    setAnswered(true)
    session.handleAnswered(payload)
  }

  return { pose, wrapAnswered }
}

export function BossActivePlay({ session, onContinue, sidebarSlot = null }: BossActivePlayProps) {
  const { pose, wrapAnswered } = useCharacterPose(session)
  // Health meter: 100% at 0 strikes, draining to 0% once BOSS_STRIKE_LIMIT
  // lands — same math as the original inline computation this replaces.
  const livesRemaining = BOSS_STRIKE_LIMIT - session.strikes

  const statusContent = (
    <>
      <div className="flex items-center gap-2" aria-hidden="true">
        <DuckMascot pose={pose} size={44} />
      </div>

      <div className="flex items-center justify-between gap-4">
        <ProgressIndicator
          value={livesRemaining}
          max={BOSS_STRIKE_LIMIT}
          variant="bar"
          tone="danger"
          label={`${String(session.strikes)} of ${String(BOSS_STRIKE_LIMIT)} strikes`}
        />
        <span className="text-sm text-text-1">
          Puzzle {session.position} of {session.totalPuzzles}
        </span>
      </div>

      {/* Decorative — the "Puzzle X of Y" text above stays as the
          accessible/exact readout several tests assert on. */}
      <ProgressIndicator value={session.position} max={session.totalPuzzles} variant="dots" />
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
          onAnswered={wrapAnswered}
          onContinue={onContinue ?? session.handleContinue}
          continueDestination={session.willEndOnContinue ? 'results' : 'next-puzzle'}
          sidebarSlot={sidebarSlot}
        />
      )}
    </>
  )
}
