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
import { PracticeShareCard } from './PracticeShareCard'
import { PracticeChallengeCard } from './PracticeChallengeCard'
import { usePracticeSession } from './usePracticeSession'
import { useMediaQuery } from '../useMediaQuery'
import { StreakPause } from '../StreakPause'
import { PATTERN_LABELS, PATTERN_SLUGS } from '../../content'
import type { PatternSlug } from '../../content'
import { CloseIcon } from '../Icons'
import { useEffect, useRef, useState } from 'react'
import type { CommitPayload } from './interactionTypes'
import { QUIZ_INTERACTIONS, QUIZ_INTERACTION_LABELS } from './interactionTypes'
import './practicePage.css'

type View = 'practice' | 'mastery'

const PATTERN_SLUG_SET: ReadonlySet<string> = new Set(PATTERN_SLUGS)
const QUIZ_INTERACTION_SET: ReadonlySet<string> = new Set(QUIZ_INTERACTIONS)

interface LastAnswer {
  puzzleId: string
  correct: boolean
}

// 2b.0: was `.practice-page` in practicePage.css (max-width breakpoint
// matches Tailwind's `lg` exactly). `practice-page` stays literal —
// App.test.tsx uses it as a root-container marker
// (`querySelector('.practice-page')`) to confirm this page mounted.
const PAGE_SHELL_CLASS =
  'practice-page app-shell__main flex flex-col gap-4 w-full max-w-[var(--content-width-mobile)] lg:max-w-[var(--content-width-desktop)] mx-auto pt-[calc(var(--space-4)+env(safe-area-inset-top))] px-4 pb-4'

// Was the shared `.practice-page__link` classname (also used verbatim in
// MasteryView.tsx/PatternPicker.tsx's "← Back" buttons).
const LINK_CLASS =
  'min-h-11 py-2 px-3 border-0 bg-transparent text-accent text-md font-semibold cursor-pointer'

export function PracticePage() {
  const [location, navigate] = useLocation()
  const search = useSearch()
  const isBrowseRoute = location === '/browse'
  const [view, setView] = useState<View>('practice')
  const session = usePracticeSession()
  const puzzleId = session.puzzle?.id
  const isDesktop = useMediaQuery('(min-width: 1024px)')

  // Tracks the puzzle's own solve state for the share card below (v2 Phase
  // 1b) — usePracticeSession's onAnswered callback doesn't expose committed
  // state to the caller (it lives inside PuzzleCardShell), so this wraps it
  // rather than reaching into the shell. Compared against session.puzzle.id
  // at render time (not just "is there a lastAnswer") so the card
  // disappears the instant Continue serves a genuinely new puzzle, without
  // needing a separate reset effect.
  const [lastAnswer, setLastAnswer] = useState<LastAnswer | null>(null)
  const handleAnswered = (payload: CommitPayload) => {
    if (session.puzzle) {
      setLastAnswer({ puzzleId: session.puzzle.id, correct: payload.correct })
    }
    session.handleAnswered(payload)
  }

  // Applies '/practice?pattern=<slug>' and '/practice?interaction=<type>'
  // query params as filters — the former is the receiving end of
  // PuzzlePage's (v2 Phase 1b) "practice more like this" CTA on a shared
  // /puzzle/:id link; the latter is new (Phase 5 Item 4), same shape. Both
  // are validated against their known-value sets rather than passed
  // through: an unrecognized or absent param is silently ignored, leaving
  // that filter unset rather than erroring. Filters combine (AND) — both
  // can apply from the same URL (?pattern=off-by-one&interaction=mcq).
  //
  // Applied exactly once each, gated on session.profile being available (v2
  // Phase 1b corrective, Finding 1). This used to depend only on
  // `session.setPatternFilter`, whose identity churns on every call — it
  // calls serveNext, which unconditionally calls setProfile with a brand
  // new object, so calling it once produces a new setPatternFilter, which
  // re-fires this effect, which calls it again: an infinite render loop. A
  // bare `useRef` latch alone is NOT sufficient: setPatternFilter no-ops
  // while `profile` is still null (loadProfile hasn't resolved on the
  // first render), so latching on that first no-op run would mark the
  // filter "applied" and it would then never actually apply. Gating on
  // `session.profile !== null` before setting the latch preserves the
  // retry-until-profile-exists behavior the runaway dependency used to
  // provide by accident, on purpose instead. One shared latch (not two)
  // since both params are read from the same URLSearchParams instance and
  // must apply together as a single combined filter call, not two separate
  // serveNext calls that would each discard the other's selection.
  const appliedFiltersFromUrlRef = useRef(false)
  useEffect(() => {
    if (appliedFiltersFromUrlRef.current || session.profile === null) return
    appliedFiltersFromUrlRef.current = true
    const params = new URLSearchParams(search)
    const pattern = params.get('pattern')
    const interaction = params.get('interaction')
    const validPattern = pattern && PATTERN_SLUG_SET.has(pattern) ? (pattern as PatternSlug) : null
    const validInteraction =
      interaction && QUIZ_INTERACTION_SET.has(interaction)
        ? (interaction as (typeof QUIZ_INTERACTIONS)[number])
        : null
    // One call, not two sequential setter calls — see setFilters's doc
    // comment in usePracticeSession.ts for why that would silently drop one
    // filter from the puzzle actually served on a combined URL.
    if (validPattern || validInteraction) {
      session.setFilters(validPattern, validInteraction)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, session.profile, session.setFilters])

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
      <div className={PAGE_SHELL_CLASS}>
        <p className="text-center text-text-1 py-8">
          We couldn&apos;t load your practice session. Please try again.
        </p>
        <button type="button" className={LINK_CLASS} onClick={session.retryLoad}>
          Try again
        </button>
      </div>
    )
  }

  if (session.status === 'loading' || session.profile === null) {
    return (
      <div className={PAGE_SHELL_CLASS}>
        <p className="text-center text-text-1 py-8">Loading your practice session…</p>
      </div>
    )
  }

  if (isBrowseRoute && !isDesktop) {
    return (
      <div className={PAGE_SHELL_CLASS}>
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
      <div className={PAGE_SHELL_CLASS}>
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

  // Shared by the filter banner and the empty-state message below, so both
  // describe the exact same active-filter combination the same way.
  const activeFilterLabels = [
    session.interactionFilter ? QUIZ_INTERACTION_LABELS[session.interactionFilter] : null,
    session.patternFilter ? PATTERN_LABELS[session.patternFilter] : null,
  ].filter((label): label is string => label !== null)

  return (
    <>
      {session.streakPause && (
        <StreakPause
          streak={session.streakPause.streak}
          isNewBest={session.streakPause.isNewBest}
          onKeepGoing={session.handleStreakPauseKeepGoing}
          onDoneForNow={session.handleStreakPauseDoneForNow}
        />
      )}

      <div className={PAGE_SHELL_CLASS}>
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
        <div className="flex flex-col gap-2">
          <Link
            href="/browse"
            className="flex items-center justify-between gap-2 w-full min-h-11 py-[13px] px-[14px] border border-border-strong rounded-sm bg-transparent text-text-0 font-sans text-base font-bold no-underline cursor-pointer"
          >
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
              className={LINK_CLASS}
              onClick={() => {
                setView('mastery')
              }}
            >
              Mastery
            </button>
          )}
        </div>

        {/* Interaction-type filter chips (Phase 5 Item 4) — combines (AND)
            with the pattern filter below, not mutually exclusive. Clicking
            an already-active chip clears just that filter; the banner below
            clears both at once. */}
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by interaction type">
          {QUIZ_INTERACTIONS.map((interaction) => {
            const active = session.interactionFilter === interaction
            const chipClass = active
              ? 'min-h-11 py-1.5 px-3 border border-accent rounded-full bg-accent-dim text-text-0 text-sm font-semibold cursor-pointer'
              : 'min-h-11 py-1.5 px-3 border border-border rounded-full bg-surface-1 text-text-1 text-sm font-semibold cursor-pointer'
            return (
              <button
                key={interaction}
                type="button"
                className={chipClass}
                aria-pressed={active}
                onClick={() => {
                  session.setInteractionFilter(active ? null : interaction)
                }}
              >
                {QUIZ_INTERACTION_LABELS[interaction]}
              </button>
            )
          })}
        </div>

        {activeFilterLabels.length > 0 && (
          <div className="inline-flex items-center gap-2 min-h-11 py-1.5 pl-3 pr-2 rounded-full bg-accent-dim border border-accent text-text-0 text-sm">
            <span>Filtering: {activeFilterLabels.join(' + ')}</span>
            <button
              type="button"
              className="flex items-center gap-1 min-h-8 py-1 px-2.5 border-0 rounded-full bg-surface-0 text-text-0 text-xs font-bold cursor-pointer"
              onClick={() => {
                session.setFilters(null, null)
              }}
            >
              <CloseIcon size={12} />
              Clear filters
            </button>
          </div>
        )}

        {session.status === 'empty' || session.puzzle === null ? (
          <p className="text-center text-text-1 py-8">
            {activeFilterLabels.length > 0
              ? `No puzzles available for ${activeFilterLabels.join(' + ')} yet.`
              : 'No puzzles available yet.'}
          </p>
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
                onAnswered={handleAnswered}
                onContinue={session.handleContinue}
              />
            </motion.div>
          </AnimatePresence>
        )}

        {lastAnswer && lastAnswer.puzzleId === session.puzzle?.id && (
          <PracticeShareCard puzzleId={lastAnswer.puzzleId} correct={lastAnswer.correct} />
        )}

        {session.streakAttempts.length > 0 &&
          lastAnswer &&
          lastAnswer.puzzleId === session.puzzle?.id && (
            <PracticeChallengeCard attempts={session.streakAttempts} />
          )}
      </div>

      {isDesktop && (
        // 2b.0: was `.practice-page__sidebar, .daily-page__sidebar` in
        // practicePage.css (shared with DailyPage.tsx's own sidebar, same
        // utility string reapplied there — see that cluster's conversion).
        <aside className="app-shell__sidebar flex flex-col gap-4 py-6 px-4 border-l border-border self-start">
          {isBrowseRoute ? (
            <PatternPicker
              singleColumn
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
