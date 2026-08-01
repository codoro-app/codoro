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
          <>
            <div
              className={`daily-hero daily-hero--${
                session.profile.dailyCompletion?.correct ? 'correct' : 'wrong'
              }`}
            >
              <div className="daily-hero__top">
                <div
                  className={`daily-hero__icon daily-hero__icon--${
                    session.profile.dailyCompletion?.correct ? 'correct' : 'wrong'
                  }`}
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
                <div className="daily-hero__copy">
                  <p className="daily-hero__verdict">
                    {session.profile.dailyCompletion?.correct
                      ? 'Solved on first try'
                      : "Missed today's puzzle"}
                  </p>
                  {session.ratingDelta !== null && (
                    <span className="daily-hero__delta">
                      {session.ratingDelta > 0
                        ? `+${String(session.ratingDelta)}`
                        : String(session.ratingDelta)}{' '}
                      rating
                    </span>
                  )}
                </div>
              </div>

              <div className="daily-hero__stats">
                <div className="daily-hero__stat">
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
                  <span className="daily-hero__stat-value">
                    {Math.round(session.profile.rating)}
                  </span>
                  <span className="daily-hero__stat-label">Rating</span>
                </div>
                <div className="daily-hero__stat">
                  <svg
                    aria-hidden="true"
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke={
                      session.profile.streak.currentStreak > 0 ? 'var(--warn)' : 'var(--text-2)'
                    }
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
                  </svg>
                  <span className="daily-hero__stat-value">
                    {session.profile.streak.currentStreak}
                  </span>
                  <span className="daily-hero__stat-label">Streak</span>
                </div>
              </div>
            </div>

            <ShareCard
              dayNumber={session.dayNumber}
              correct={session.profile.dailyCompletion?.correct ?? false}
              streak={session.profile.streak.currentStreak}
              puzzleId={session.puzzle.id}
            />
          </>
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
            <div className="status-bar__pill status-bar__pill--streak" title="Daily streak">
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
          <MasteryView refreshKey={session.attemptVersion} />
        </aside>
      )}
    </>
  )
}
