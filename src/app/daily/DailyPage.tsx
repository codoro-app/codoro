/**
 * Daily mode: one puzzle per calendar date (engine's deterministic date
 * hash), first attempt rated, further attempts unrated retries via the same
 * PuzzleCardShell (see useDailySession's doc comment). Once today's puzzle
 * has a recorded first attempt, the share card stays visible alongside the
 * card so retries never hide or change the shareable result — "no re-taking
 * for a better share" per the build plan.
 *
 * Desktop (>=1024px) sidebar: rating/streak pills (reusing status-bar's
 * pill classes directly, not the StatusBar component — StatusBar requires
 * combo/solvedThisSession props Daily has no equivalent of) plus a
 * MasteryTeaser (2b.7: weakest pattern + a link to the full /stats page —
 * the per-pattern list that used to live here now lives there), gated on
 * useMediaQuery so mobile mounts neither.
 *
 * Task 7 (v4 Phase 4.3): a scrubber-day puzzle renders via `TraceRunnerPuzzle`
 * (`../trace/TraceRunner`) instead of `PuzzleCardShell` — `PuzzleCardShell`
 * has an explicit `case 'scrubber': throw` (it structurally only ever serves
 * Practice/Rush/Boss/Puzzle/Challenge's quiz interactions), but
 * `DAILY_CALENDAR` can and does include scrubber entries. `useDailySession`'s
 * `checkpointResults`/`isComplete`/`solved`/`onCheckpointAnswered` exist
 * purely to feed this branch — see its own doc comment for how they commit
 * through the same rating/streak/persistence/telemetry path as
 * `handleAnswered`.
 */
import { useState } from 'react'
import { PuzzleCardShell } from '../practice/PuzzleCardShell'
import { MasteryTeaser } from '../practice/MasteryTeaser'
import { TraceRunnerPuzzle } from '../trace/TraceRunner'
import { useDailySession } from './useDailySession'
import { useMediaQuery } from '../useMediaQuery'
import { ShareMenu } from '../ShareMenu'
import type { ShareAction } from '../ShareMenu'
import { RouteSkeleton } from '../RouteSkeleton'
import { buildShareText, buildDailyChallengeText } from './shareText'
import { trackShareClick, trackChallengeCreate } from '../../telemetry'

// 2b.0: was `.daily-page` in dailyPage.css (max-width breakpoint matches
// Tailwind's `lg` exactly). None of `.daily-page*`/`.daily-hero*` are
// test-asserted (grep-verified), so no literal marker classnames needed.
const PAGE_SHELL_CLASS =
  'app-shell__main flex flex-col gap-4 w-full max-w-[var(--content-width-mobile)] lg:max-w-[var(--content-width-desktop)] mx-auto pt-[var(--space-4)] px-4 pb-4'

// Was the shared `.daily-page__link`/`.practice-page__link` classname (also
// reused verbatim in RushPage.tsx's "Try again" button).
const LINK_CLASS =
  'min-h-11 py-2 px-3 border-0 bg-transparent text-accent text-md font-semibold cursor-pointer'

// 2b.0: was `.daily-hero`/`--wrong` + `.daily-hero__icon`/`--wrong` in
// dailyPage.css — reused verbatim in RushPage.tsx's run-ended card (always
// the "correct"/accent styling there, never wrong).
function heroClass(correct: boolean): string {
  const BASE = 'flex flex-col gap-4 p-4 lg:py-[28px] lg:px-[30px] rounded-xl border-[1.5px]'
  return correct
    ? `${BASE} border-accent [background:linear-gradient(160deg,var(--accent-dim),var(--surface-1))]`
    : `${BASE} border-danger [background:linear-gradient(160deg,var(--danger-dim),var(--surface-1))]`
}
function heroIconClass(correct: boolean): string {
  const BASE = 'flex items-center justify-center shrink-0 w-11 h-11 rounded-md'
  return correct ? `${BASE} bg-accent` : `${BASE} bg-danger`
}

export function DailyPage() {
  const session = useDailySession()
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  // v4 Phase 4.5 ("the right rail") — same ref-callback-in-state portal
  // target as PracticePage.tsx's identical `sidebarSlotEl`, for a retry
  // attempt's own feedback/Continue block.
  const [sidebarSlotEl, setSidebarSlotEl] = useState<HTMLDivElement | null>(null)

  if (session.status === 'error') {
    return (
      <div className={PAGE_SHELL_CLASS}>
        <p className="text-center text-text-1 py-8">
          We couldn&apos;t load today&apos;s puzzle. Please try again.
        </p>
        <button type="button" className={LINK_CLASS} onClick={session.retryLoad}>
          Try again
        </button>
      </div>
    )
  }

  // True cold boot only (content-metadata-lazy-load Task 5b) — see
  // usePracticeSession.ts's identical branch/RouteSkeleton reasoning.
  if (session.status === 'loading' || session.profile === null) {
    return <RouteSkeleton />
  }

  if (session.status === 'empty' || session.puzzle === null) {
    return (
      <div className={PAGE_SHELL_CLASS}>
        <p className="text-center text-text-1 py-8">No daily puzzle available right now.</p>
      </div>
    )
  }

  // 2b.4: was separate ShareCard/ChallengeCard components (deleted) — one
  // ShareMenu now covers both, degrading to a single button when the
  // challenge attempt isn't ready yet, same conditional this list replaces.
  // `puzzleId` is captured locally because TS doesn't retain narrowing of
  // `session.puzzle` across the closures below.
  const puzzleId = session.puzzle.id
  const shareActions: ShareAction[] = session.completedToday
    ? [
        {
          id: 'puzzle',
          label: 'Share puzzle',
          copiedLabel: 'Copied!',
          copyAriaLabel: 'Copy puzzle link',
          description: `Copy a link to today's puzzle`,
          text: buildShareText({
            dayNumber: session.dayNumber,
            correct: session.profile.dailyCompletion?.correct ?? false,
            streak: session.profile.streak.currentStreak,
            puzzleId,
          }),
          onShared: () => {
            trackShareClick({ surface: 'daily', puzzle_id: puzzleId })
          },
        },
        ...(session.challengeAttempt
          ? [
              {
                id: 'challenge',
                label: 'Share challenge',
                copiedLabel: 'Link copied!',
                copyAriaLabel: 'Copy challenge link',
                description: 'Challenge a friend to beat your result',
                text: buildDailyChallengeText({
                  dayNumber: session.dayNumber,
                  attempt: session.challengeAttempt,
                }),
                onShared: () => {
                  trackChallengeCreate({ surface: 'daily', puzzle_count: 1 })
                },
              },
            ]
          : []),
      ]
    : []

  // v4 Phase 4.5 ("the right rail"): the result hero + Share used to render
  // full-width in the main column below the day title (pushing the puzzle
  // card down on a retry) — moved into the desktop sidebar below, computed
  // here as a variable purely because a `<>{cond && <>...</>}</>` fragment
  // is just as valid an expression bound to a name as it is inlined; the
  // JSX itself is unchanged from what used to render inline.
  const dailyHero = session.completedToday ? (
    <>
      <div className={heroClass(session.profile.dailyCompletion?.correct ?? false)}>
        <div className="flex items-center gap-3">
          <div
            className={heroIconClass(session.profile.dailyCompletion?.correct ?? false)}
            aria-hidden="true"
          >
            {session.profile.dailyCompletion?.correct ? (
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--accent-ink)"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg
                width="22"
                height="22"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--text-0)"
                strokeWidth="2.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            )}
          </div>
          <div className="flex flex-col gap-1">
            <p className="m-0 text-lg font-bold text-text-0">
              {session.profile.dailyCompletion?.correct
                ? 'Solved on first try'
                : "Missed today's puzzle"}
            </p>
            {session.ratingDelta !== null && (
              <span className="font-mono text-sm font-semibold text-accent">
                {session.ratingDelta > 0
                  ? `+${String(session.ratingDelta)}`
                  : String(session.ratingDelta)}{' '}
                rating
              </span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col items-center gap-1 p-3 rounded-md bg-surface-0 border border-border">
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
              <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
              <path d="M4 22h16" />
              <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
            </svg>
            <span className="text-lg font-bold text-text-0">
              {Math.round(session.profile.rating)}
            </span>
            <span className="text-xs text-text-2">Rating</span>
          </div>
          <div className="flex flex-col items-center gap-1 p-3 rounded-md bg-surface-0 border border-border">
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke={session.profile.streak.currentStreak > 0 ? 'var(--warn)' : 'var(--text-2)'}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
            </svg>
            <span className="text-lg font-bold text-text-0">
              {session.profile.streak.currentStreak}
            </span>
            <span className="text-xs text-text-2">Streak</span>
          </div>
          {/* Puzzle difficulty, revealed only here — inside the
              completedToday block, which flips true synchronously in the
              same commit as the first answer (useDailySession's
              handleAnswered calls setProfile before this renders). Never
              rendered, not even hidden, before that — a rating a player
              could find pre-attempt (devtools, a title attr) would anchor
              the attempt, which is the whole point of revealing it only
              after (Phase 5 Item 3). */}
          <div className="flex flex-col items-center gap-1 p-3 rounded-md bg-surface-0 border border-border">
            <svg
              aria-hidden="true"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--text-2)"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
              <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
              <path d="M4 22h16" />
              <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
            </svg>
            <span className="text-lg font-bold text-text-0">
              {Math.round(session.puzzle.difficulty_rating)}
            </span>
            <span className="text-xs text-text-2">Puzzle rating</span>
          </div>
        </div>
      </div>

      <ShareMenu actions={shareActions} />
    </>
  ) : null

  return (
    <>
      <div className={PAGE_SHELL_CLASS}>
        <p className="m-0 text-center text-xl font-bold text-text-0">
          Codoro Daily #{session.dayNumber}
        </p>

        {/* Mobile never had a sidebar to move this into — only desktop
            relocates it below. */}
        {!isDesktop && dailyHero}

        {session.puzzle.interaction === 'scrubber' ? (
          <TraceRunnerPuzzle
            key={`${session.puzzle.id}-${String(session.attemptNonce)}`}
            puzzle={session.puzzle}
            checkpointResults={session.checkpointResults}
            isComplete={session.isComplete}
            solved={session.solved}
            ratingDelta={session.ratingDelta}
            onCheckpointAnswered={session.onCheckpointAnswered}
            onContinue={session.handleRetry}
            timed={false}
            continueLabel="Try again"
            sidebarSlot={sidebarSlotEl}
          />
        ) : (
          <PuzzleCardShell
            key={`${session.puzzle.id}-${String(session.attemptNonce)}`}
            puzzle={session.puzzle}
            ratingDelta={session.ratingDelta}
            onAnswered={session.handleAnswered}
            onContinue={session.handleRetry}
            continueDestination="retry"
            sidebarSlot={sidebarSlotEl}
          />
        )}
      </div>

      {/* 2b.0: was `.practice-page__sidebar, .daily-page__sidebar` in
          practicePage.css — same utility string PracticePage.tsx's own
          sidebar reapplies. */}
      {isDesktop && (
        <aside className="app-shell__sidebar flex flex-col gap-4 py-6 px-4 border-l border-border self-start">
          {dailyHero}
          {/* Retry attempts (PuzzleCardShell/TraceRunnerPuzzle above) portal
              their own feedback/Continue block in here — see
              `sidebarSlotEl`'s doc comment. */}
          <div ref={setSidebarSlotEl} className="empty:hidden flex flex-col gap-4" />
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="flex items-center gap-1.5 min-h-11 py-1.5 px-3 rounded-full bg-surface-1 border border-border text-text-0 font-bold tabular-nums"
              title="Rating"
            >
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                <path d="M4 22h16" />
                <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
              </svg>
              <span>{Math.round(session.profile.rating)}</span>
            </div>
            <div
              className="flex items-center gap-1.5 min-h-11 py-1.5 px-3 rounded-full bg-surface-1 border border-border text-text-0 font-bold tabular-nums"
              title="Daily streak"
            >
              <svg
                aria-hidden="true"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke={session.profile.streak.currentStreak > 0 ? 'var(--warn)' : 'var(--text-2)'}
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
              </svg>
              <span>{session.profile.streak.currentStreak}</span>
            </div>
          </div>
          <MasteryTeaser refreshKey={session.attemptVersion} />
        </aside>
      )}
    </>
  )
}
