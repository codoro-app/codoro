/**
 * Daily mode: one puzzle per calendar date (engine's deterministic date
 * hash), first attempt rated, further attempts unrated retries via the same
 * PuzzleCardShell (see useDailySession's doc comment). Once today's puzzle
 * has a recorded first attempt, the share card stays visible alongside the
 * card so retries never hide or change the shareable result — "no re-taking
 * for a better share" per the build plan.
 */
import { PuzzleCardShell } from '../practice/PuzzleCardShell'
import { useDailySession } from './useDailySession'
import { ShareCard } from './ShareCard'
import './dailyPage.css'

export function DailyPage() {
  const session = useDailySession()

  if (session.status === 'error') {
    return (
      <div className="daily-page">
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
      <div className="daily-page">
        <p className="daily-page__status">Loading today&apos;s puzzle…</p>
      </div>
    )
  }

  if (session.status === 'empty' || session.puzzle === null) {
    return (
      <div className="daily-page">
        <p className="daily-page__status">No daily puzzle available right now.</p>
      </div>
    )
  }

  return (
    <div className="daily-page">
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
  )
}
