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
 *
 * Desktop (>=1024px) sidebar: the main practice view (not the loading/error/
 * mastery-view branches) additionally renders `.app-shell__sidebar` with
 * StatusBar + a backless MasteryView, gated on useMediaQuery so mobile
 * mounts neither (no extra MasteryView attempt-fetch on phones). The mobile
 * "Mastery" nav link is hidden at desktop widths since the sidebar already
 * shows it persistently — a deliberate scope call for this phase (see the
 * Phase 6.5 plan's Task 1 notes); it stays fully functional on mobile.
 *
 * Desktop Browse (Phase 0 fix, routed in Phase 1a): a full-page takeover
 * used to fire unconditionally — on desktop that unmounted both
 * `.app-shell__sidebar` and the puzzle card, so Browse had no "puzzle view
 * on the right" to reflect a selection into (the reported bug). The early
 * return below is mobile-only (`&& !isDesktop`); on desktop, the sidebar's
 * own content instead swaps between PatternPicker and the normal
 * StatusBar+MasteryView pairing, so the puzzle in `.app-shell__main` is
 * never unmounted and stays interactive throughout. `usePracticeSession`'s
 * `setPatternFilter` already re-serves a puzzle synchronously on selection,
 * so no extra wiring was needed for "selecting a pattern immediately serves
 * a playable puzzle."
 *
 * `/browse` is a real route (v2 Phase 1a) rather than a fourth `view` value:
 * this component is mounted for both `/practice` and `/browse` (see
 * App.tsx's Switch — both routes render this same lazy chunk), and whether
 * the browse UI is showing is derived from the current location instead of
 * local state. Because Switch/Route only ever renders one matching child at
 * a time but that child is this same component type at the same tree
 * position on every render, React doesn't unmount/remount it when the
 * route flips between /practice and /browse — usePracticeSession's session
 * state (current puzzle, combo, solvedThisSession) survives the navigation
 * instead of resetting, which is what makes "selecting a pattern serves a
 * puzzle immediately" and "Back returns to the puzzle you were on" work.
 * `view === 'mastery'` stays local component state — it isn't a route in
 * this phase, and pulling it out too would be scope creep beyond the
 * routing extraction Phase 0 deferred here.
 */
import { AnimatePresence, motion } from 'framer-motion'
import { Link, useLocation, useSearch } from 'wouter'
import { PuzzleCardShell } from './PuzzleCardShell'
import { StatusBar } from './StatusBar'
import { PatternPicker } from './PatternPicker'
import { MasteryView } from './MasteryView'
import { usePracticeSession } from './usePracticeSession'
import { useMediaQuery } from '../useMediaQuery'
import { PATTERN_LABELS, PATTERN_SLUGS } from '../../content'
import type { PatternSlug } from '../../content'
import { CloseIcon } from '../Icons'
import { useEffect, useState } from 'react'
import './practicePage.css'

type View = 'practice' | 'mastery'

const PATTERN_SLUG_SET: ReadonlySet<string> = new Set(PATTERN_SLUGS)

export function PracticePage() {
  const [location, navigate] = useLocation()
  const search = useSearch()
  const isBrowseRoute = location === '/browse'
  const [view, setView] = useState<View>('practice')
  const session = usePracticeSession()
  const puzzleId = session.puzzle?.id
  const isDesktop = useMediaQuery('(min-width: 1024px)')

  // Applies a '/practice?pattern=<slug>' query param as the pattern filter —
  // the receiving end of PuzzlePage's (v2 Phase 1b) "practice more like
  // this" CTA on a shared /puzzle/:id link. Validated against PATTERN_SLUGS
  // rather than passed through: an unrecognized or absent param is silently
  // ignored, leaving the normal unfiltered pool rather than erroring.
  useEffect(() => {
    const pattern = new URLSearchParams(search).get('pattern')
    if (pattern && PATTERN_SLUG_SET.has(pattern)) {
      session.setPatternFilter(pattern as PatternSlug)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, session.setPatternFilter])

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
      <div className="practice-page app-shell__main">
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
      <div className="practice-page app-shell__main">
        <p className="practice-page__status">Loading your practice session…</p>
      </div>
    )
  }

  if (isBrowseRoute && !isDesktop) {
    return (
      <div className="practice-page app-shell__main">
        <PatternPicker
          onSelect={(pattern) => {
            session.setPatternFilter(pattern)
            navigate('/practice', { replace: true })
          }}
          onBack={() => {
            navigate('/practice', { replace: true })
          }}
        />
      </div>
    )
  }

  if (view === 'mastery') {
    return (
      <div className="practice-page app-shell__main">
        <MasteryView
          onBack={() => {
            setView('practice')
          }}
          refreshKey={session.attemptVersion}
          onSelectPattern={(pattern) => {
            session.setPatternFilter(pattern)
            setView('practice')
          }}
        />
      </div>
    )
  }

  return (
    <>
      <div className="practice-page app-shell__main">
        {!isDesktop && (
          <StatusBar
            rating={session.profile.rating}
            streak={session.profile.streak.currentStreak}
            combo={session.combo}
            solvedThisSession={session.solvedThisSession}
          />
        )}

        {/* Browse-patterns stays reachable at every width — NavRail doesn't
            carry a duplicate entry for it (see NavRail.tsx's doc comment),
            so this remains the one entry point on both mobile and desktop.
            A real <Link> to /browse (v2 Phase 1a) rather than a setView
            call, so cmd/middle-click opens it in a new tab. Mastery stays
            mobile-only since desktop already shows it persistently in the
            sidebar (below). */}
        <div className="practice-page__nav">
          <Link href="/browse" className="practice-page__browse">
            <span>Browse patterns</span>
            <svg
              aria-hidden="true"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="var(--accent)"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </Link>
          {!isDesktop && (
            <button
              type="button"
              className="practice-page__link"
              onClick={() => {
                setView('mastery')
              }}
            >
              Mastery
            </button>
          )}
        </div>

        {session.patternFilter && (
          <div className="practice-page__filter-banner">
            <span>Filtering: {PATTERN_LABELS[session.patternFilter]}</span>
            <button
              type="button"
              className="practice-page__filter-clear"
              onClick={() => {
                session.setPatternFilter(null)
              }}
            >
              <CloseIcon size={12} />
              All patterns
            </button>
          </div>
        )}

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

      {isDesktop && (
        <aside className="app-shell__sidebar practice-page__sidebar">
          {isBrowseRoute ? (
            <PatternPicker
              onSelect={(pattern) => {
                session.setPatternFilter(pattern)
                navigate('/practice', { replace: true })
              }}
              onBack={() => {
                navigate('/practice', { replace: true })
              }}
            />
          ) : (
            <>
              <StatusBar
                rating={session.profile.rating}
                streak={session.profile.streak.currentStreak}
                combo={session.combo}
                solvedThisSession={session.solvedThisSession}
              />
              <MasteryView
                refreshKey={session.attemptVersion}
                onSelectPattern={(pattern) => {
                  session.setPatternFilter(pattern)
                }}
              />
            </>
          )}
        </aside>
      )}
    </>
  )
}
