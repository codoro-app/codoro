/**
 * Top-level practice controller: wires usePracticeSession (engine/storage/
 * telemetry orchestration) to PuzzleCardShell (concern a/b's card + gesture
 * UI), plus the status bar, browse-by-pattern picker, and mastery view.
 *
 * Session-progress-bar decision (per the brief): Codoro's Practice mode is
 * continuous/endless, unlike Duolingo's fixed-length lessons, so there is no
 * natural "out of N" denominator for a bounded progress bar. Rather than
 * fabricate a fake ceiling, StatusBar shows an uncapped rolling count of
 * puzzles solved this session (`solvedThisSession`) — real progress
 * feedback without implying an endpoint that doesn't exist in this mode.
 *
 * `PuzzleCardShell` is keyed by `puzzle.id` (required fix from concern b):
 * its internal motion state does not reset on its own when consecutive
 * puzzles share the same interaction type, so a full remount on every
 * puzzle change is required — confirmed safe by PuzzleCardShell's own doc
 * comment.
 */
import { AnimatePresence, motion } from 'framer-motion'
import { PuzzleCardShell } from './PuzzleCardShell'
import { StatusBar } from './StatusBar'
import { PatternPicker } from './PatternPicker'
import { MasteryView } from './MasteryView'
import { usePracticeSession } from './usePracticeSession'
import { PATTERN_LABELS } from '../../content'
import { useEffect, useState } from 'react'
import './practicePage.css'

type View = 'practice' | 'patterns' | 'mastery'

export function PracticePage() {
  const [view, setView] = useState<View>('practice')
  const session = usePracticeSession()
  const puzzleId = session.puzzle?.id

  // The page (not a nested container — practicePage.css has no overflow-y
  // scroll region) scrolls with whatever height the previous puzzle's
  // feedback/explanation panel left behind. Without this, tapping Continue
  // can leave a new (shorter) puzzle rendered below the current scroll
  // position, showing blank space until the user manually scrolls back up.
  // Keyed on puzzle id specifically (not e.g. `view`) so this only fires
  // when a genuinely new puzzle is served — via Continue or a pattern
  // filter switch — not on every render.
  useEffect(() => {
    if (puzzleId) {
      window.scrollTo({ top: 0 })
    }
  }, [puzzleId])

  // Checked before the loading branch below: on a load failure, profile is
  // also null and status would otherwise fall through into "Loading your
  // practice session…" forever (the bug this branch fixes — see
  // usePracticeSession's SessionStatus doc comment).
  if (session.status === 'error') {
    return (
      <div className="practice-page">
        <p className="practice-page__status">
          We couldn&apos;t load your practice session. Please try again.
        </p>
        <button type="button" className="practice-page__link" onClick={session.retryLoad}>
          Try again
        </button>
      </div>
    )
  }

  if (session.status === 'loading' || session.profile === null) {
    return (
      <div className="practice-page">
        <p className="practice-page__status">Loading your practice session…</p>
      </div>
    )
  }

  if (view === 'patterns') {
    return (
      <div className="practice-page">
        <PatternPicker
          onSelect={(pattern) => {
            session.setPatternFilter(pattern)
            setView('practice')
          }}
          onBack={() => {
            setView('practice')
          }}
        />
      </div>
    )
  }

  if (view === 'mastery') {
    return (
      <div className="practice-page">
        <MasteryView
          onBack={() => {
            setView('practice')
          }}
        />
      </div>
    )
  }

  return (
    <div className="practice-page">
      <StatusBar
        rating={session.profile.rating}
        streak={session.profile.streak.currentStreak}
        combo={session.combo}
        solvedThisSession={session.solvedThisSession}
      />

      <div className="practice-page__nav">
        <button
          type="button"
          className="practice-page__link"
          onClick={() => {
            setView('patterns')
          }}
        >
          {session.patternFilter
            ? `Pattern: ${PATTERN_LABELS[session.patternFilter]}`
            : 'Browse patterns'}
        </button>
        <button
          type="button"
          className="practice-page__link"
          onClick={() => {
            setView('mastery')
          }}
        >
          Mastery
        </button>
      </div>

      {session.status === 'empty' || session.puzzle === null ? (
        <p className="practice-page__status">No puzzles available for this pattern yet.</p>
      ) : (
        <AnimatePresence mode="wait">
          <motion.div
            key={session.puzzle.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
          >
            <PuzzleCardShell
              key={session.puzzle.id}
              puzzle={session.puzzle}
              ratingDelta={session.ratingDelta}
              onAnswered={session.handleAnswered}
              onContinue={session.handleContinue}
            />
          </motion.div>
        </AnimatePresence>
      )}
    </div>
  )
}
