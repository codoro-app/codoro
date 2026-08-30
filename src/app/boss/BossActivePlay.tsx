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
import { PuzzleCardShell } from '../practice/PuzzleCardShell'
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
 * Boss's fixed identity (2b.2 game-feel pass, direct user decision: one
 * character reused across every run/set — not one per BOSS_SETS entry).
 * No commissioned art: a simple reactive SVG icon, styled like the rest of
 * `../Icons.tsx`'s icon set but kept local since it's single-use here.
 */
const BOSS_NAME = 'Glitch'

function BossCharacterIcon() {
  return (
    <svg
      aria-hidden="true"
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="6" width="16" height="14" rx="3" />
      <path d="M9 2l1.5 4M15 2l-1.5 4" />
      <circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none" />
      <path d="M9 16.5c1-1 5-1 6 0" />
    </svg>
  )
}

/** `--hit` on a correct answer (landed a hit), `--struck` on a wrong one — mirrors the health bar's own `key`-remount trick (see the fill's own comment below) so each answer replays its reaction from scratch. */
function characterReactionClass(lastAnswerCorrect: boolean | null): string {
  const base =
    'boss-character__icon flex items-center justify-center w-11 h-11 rounded-full bg-accent-dim text-accent'
  if (lastAnswerCorrect === true) return `${base} boss-character__icon--hit`
  if (lastAnswerCorrect === false) return `${base} boss-character__icon--struck`
  return base
}

export function BossActivePlay({ session, onContinue, sidebarSlot = null }: BossActivePlayProps) {
  // Health-bar fill: 100% at 0 strikes, draining to 0% once BOSS_STRIKE_LIMIT
  // lands — same math as BossPage.tsx's own original inline computation.
  const healthPercent = ((BOSS_STRIKE_LIMIT - session.strikes) / BOSS_STRIKE_LIMIT) * 100

  const statusContent = (
    <>
      <div className="boss-character flex items-center gap-2" aria-hidden="true">
        <span
          key={session.answerNonce}
          className={characterReactionClass(session.lastAnswerCorrect)}
        >
          <BossCharacterIcon />
        </span>
        <span className="text-sm font-bold text-text-0">{BOSS_NAME}</span>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div
          className="flex-1 h-1.5 rounded-full bg-surface-2 overflow-hidden"
          role="status"
          aria-label={`${String(session.strikes)} of ${String(BOSS_STRIKE_LIMIT)} strikes`}
        >
          {/* key={session.strikes}: forces a remount on every strike so
              the CSS hit-reaction animation (bossPage.css) restarts each
              time, without any new component state — see that file's
              own doc comment. boss-strikes__fill/--hit stay literal —
              BossPage.test.tsx asserts on them directly, and --hit still
              needs its @keyframes from bossPage.css. */}
          <div
            key={session.strikes}
            className={`boss-strikes__fill h-full rounded-full bg-danger transition-[width] duration-[0.25s] ease-out${session.strikes > 0 ? ' boss-strikes__fill--hit' : ''}`}
            style={{ width: `${String(healthPercent)}%` }}
            aria-hidden="true"
          />
        </div>
        <span className="text-sm text-text-1">
          Puzzle {session.position} of {session.totalPuzzles}
        </span>
      </div>

      {/* Segmented pip-style progress (2b.2): the plain "Puzzle X of Y"
          text above stays (kept as the accessible/exact readout — several
          tests assert on its exact wording), but the pips are the primary
          at-a-glance visual now. */}
      <div className="flex gap-1" aria-hidden="true">
        {Array.from({ length: session.totalPuzzles }, (_, i) => {
          const state =
            i < session.position - 1 ? 'done' : i === session.position - 1 ? 'current' : 'upcoming'
          return <span key={i} className={`boss-progress__pip boss-progress__pip--${state}`} />
        })}
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
          continueDestination={session.willEndOnContinue ? 'results' : 'next-puzzle'}
          sidebarSlot={sidebarSlot}
        />
      )}
    </>
  )
}
