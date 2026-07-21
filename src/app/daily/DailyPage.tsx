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
 * combo/solvedThisSession props Daily has no equivalent of) plus a backless
 * MasteryView, gated on useMediaQuery so mobile mounts neither.
 */
import { PuzzleCardShell } from '../practice/PuzzleCardShell'
import { MasteryView } from '../practice/MasteryView'
import { useDailySession } from './useDailySession'
import { useMediaQuery } from '../useMediaQuery'
import { ShareCard } from './ShareCard'
import './dailyPage.css'

export function DailyPage() {
  const session = useDailySession()
  const isDesktop = useMediaQuery('(min-width: 1024px)')

  if (session.status === 'error') {
    return (
      <div className="daily-page app-shell__main">
        <p className="daily-page__status">
          We couldn&apos;t load today&apos;s puzzle. Please try again.
        </p>
        <button type="button" className="daily-page__link" onClick={session.retryLoad}>
          Try again
        </button>
      </div>
    )
  }

  if (session.status === 'loading' || session.profile === null) {
    return (
      <div className="daily-page app-shell__main">
        <p className="daily-page__status">Loading today&apos;s puzzle…</p>
      </div>
    )
  }

  if (session.status === 'empty' || session.puzzle === null) {
    return (
      <div className="daily-page app-shell__main">
        <p className="daily-page__status">No daily puzzle available right now.</p>
      </div>
    )
  }

  return (
    <>
      <div className="daily-page app-shell__main">
        <p className="daily-page__heading">Codoro Daily #{session.dayNumber}</p>

        {session.completedToday && (
          <ShareCard
            dayNumber={session.dayNumber}
            correct={session.profile.dailyCompletion?.correct ?? false}
            streak={session.profile.streak.currentStreak}
          />
        )}

        <PuzzleCardShell
          key={`${session.puzzle.id}-${String(session.attemptNonce)}`}
          puzzle={session.puzzle}
          ratingDelta={session.ratingDelta}
          onAnswered={session.handleAnswered}
          onContinue={session.handleRetry}
        />
      </div>

      {isDesktop && (
        <aside className="app-shell__sidebar daily-page__sidebar">
          <div className="status-bar">
            <div className="status-bar__pill status-bar__pill--rating" title="Rating">
              <span aria-hidden="true">🏆</span>
              <span>{Math.round(session.profile.rating)}</span>
            </div>
            <div className="status-bar__pill status-bar__pill--streak" title="Daily streak">
              <span aria-hidden="true">🔥</span>
              <span>{session.profile.streak.currentStreak}</span>
            </div>
          </div>
          <MasteryView />
        </aside>
      )}
    </>
  )
}
