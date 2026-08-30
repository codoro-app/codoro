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
 * StatusBar + a `MasteryTeaser` (2b.7: weakest pattern + a link to the full
 * /stats page — the per-pattern list that used to live here now lives
 * there), gated on useMediaQuery so mobile mounts neither (no extra
 * attempt-fetch on phones). The mobile "Mastery" nav link is hidden at
 * desktop widths since the sidebar already shows it persistently — a
 * deliberate scope call for this phase (see the Phase 6.5 plan's Task 1
 * notes); it stays fully functional on mobile.
 *
 * Desktop Browse (Phase 0 fix, routed in Phase 1a): a full-page takeover
 * used to fire unconditionally — on desktop that unmounted both
 * `.app-shell__sidebar` and the puzzle card, so Browse had no "puzzle view
 * on the right" to reflect a selection into (the reported bug). The early
 * return below is mobile-only (`&& !isDesktop`); on desktop, the sidebar's
 * own content instead swaps between PatternPicker and the normal
 * StatusBar+MasteryTeaser pairing, so the puzzle in `.app-shell__main` is
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
import { MasteryTeaser } from './MasteryTeaser'
import { buildPracticeShareText, buildPracticeChallengeText } from './shareText'
import { usePracticeSession } from './usePracticeSession'
import { useMediaQuery } from '../useMediaQuery'
import { RouteSkeleton } from '../RouteSkeleton'
import { StreakPause } from '../StreakPause'
import { PATTERN_LABELS, PATTERN_SLUGS } from '../../content'
import type { PatternSlug } from '../../content'
import { CloseIcon } from '../Icons'
import { ShareMenu } from '../ShareMenu'
import type { ShareAction } from '../ShareMenu'
import { trackShareClick, trackChallengeCreate } from '../../telemetry'
import { truncateToChallengeLimit } from '../../challenge'
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
  'practice-page app-shell__main flex flex-col gap-4 w-full max-w-[var(--content-width-mobile)] lg:max-w-[var(--content-width-desktop)] mx-auto pt-[var(--space-4)] px-4 pb-4'

// Was the shared `.practice-page__link` classname (also used verbatim in
// MasteryView.tsx/PatternPicker.tsx's "← Back" buttons).
const LINK_CLASS =
  'min-h-11 py-2 px-3 border-0 bg-transparent text-accent text-md font-semibold cursor-pointer'

// 2b.9 (space bug, 2026-08-21): Browse-patterns + Mastery used to stack
// full-width (flex-col), each independently paying the 44px min-tap-target
// floor — ~100px of vertical space for two one-line labels. Same row now
// (see the `flex gap-2` wrapper below), Browse-patterns growing via
// `flex-1` and this button sized to its own label via `flex-none`, so both
// still clear min-h-11 but share one row's height instead of two. Not
// LINK_CLASS (that's the borderless, no-min-height "text-only" pattern
// shared with MasteryView/PatternPicker's "← Back" — a different visual
// weight than the bordered box this needs to read as a sibling of
// Browse-patterns, not a stray label under it).
const MASTERY_INLINE_CLASS =
  'flex items-center justify-center min-h-11 py-[13px] px-4 border border-border-strong rounded-sm bg-transparent text-accent font-sans text-base font-bold no-underline cursor-pointer whitespace-nowrap'

export function PracticePage() {
  const [location, navigate] = useLocation()
  const search = useSearch()
  const isBrowseRoute = location === '/browse'
  const [view, setView] = useState<View>('practice')
  const session = usePracticeSession()
  const puzzleId = session.puzzle?.id
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  // Scroll target for the new-puzzle effect below — the motion.div wrapping
  // PuzzleCardShell, not PuzzleCardShell itself (which forwards no ref).
  const puzzleCardRef = useRef<HTMLDivElement>(null)

  // v4 Phase 4.5 ("the right rail"): desktop's portal target for
  // PuzzleCardShell's post-commit Continue+feedback block — see
  // PuzzleCardShell.tsx's `sidebarSlot` doc comment. A ref callback stored
  // in state (not a bare useRef) because the portal needs the *element* to
  // exist before PuzzleCardShell's first render that could commit; a plain
  // ref's `.current` mutation wouldn't trigger the re-render that hands
  // PuzzleCardShell the real node. Mobile never reads this — PuzzleCardShell
  // ignores `sidebarSlot` whenever `!isDesktop`.
  const [sidebarSlotEl, setSidebarSlotEl] = useState<HTMLDivElement | null>(null)

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
  //
  // Scrolls the card itself into view, not just the page top (bug report,
  // 2026-08-18): on mobile, StatusBar + the Browse-patterns/Mastery links +
  // filter chips all render above the puzzle card, so a bare
  // `window.scrollTo({ top: 0 })` still leaves the question below the fold
  // — "scrolled to the top of the page" isn't "scrolled to the question".
  // Falls back to the page-top behavior when the ref isn't mounted yet (the
  // loading/error/empty branches below render no puzzle card at all) or in
  // an environment without `scrollIntoView` (jsdom, this project's test
  // environment, doesn't implement it — same `typeof === 'function'`
  // feature-detection convention as SwipeBinary.tsx/DragOrder.tsx's
  // pointer-capture guards, rather than a jsdom-only special case here).
  //
  // Only scrolls when the card is actually out of view (todo 25, v4 Phase
  // 4.0): on desktop the new puzzle usually renders in the same spot as the
  // old one, so forcing scrollIntoView unconditionally on every puzzleId
  // change yanked StatusBar/Browse-patterns/filter-chip rows (which render
  // above the card) out of view on every single "Next puzzle" click, even
  // though nothing needed scrolling. Gating on the card's own
  // getBoundingClientRect().top preserves the 2026-08-18 fix's actual
  // purpose (bring an off-screen — above or below the viewport — card into
  // view) without re-scrolling a card that's already visible.
  useEffect(() => {
    if (!puzzleId) return
    const card = puzzleCardRef.current
    if (card && typeof card.scrollIntoView === 'function') {
      const { top } = card.getBoundingClientRect()
      const outOfView = top < 0 || top >= window.innerHeight
      if (outOfView) {
        card.scrollIntoView({ block: 'start' })
      }
    } else {
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

  // True cold boot only (content-metadata-lazy-load Task 5): status stays
  // 'loading' until the very first puzzle of the session has ever been
  // displayed — every subsequent puzzle change is stale-while-revalidate
  // (usePracticeSession.ts keeps showing the previous puzzle), so this
  // branch is not re-entered on a Continue/filter change. RouteSkeleton, not
  // a bespoke loading message, per the locked "one shared skeleton" pattern
  // — see RouteSkeleton.tsx's own doc comment.
  if (session.status === 'loading' || session.profile === null) {
    return <RouteSkeleton />
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
        <div className="flex items-center gap-2">
          <button
            type="button"
            className={LINK_CLASS}
            onClick={() => {
              setView('practice')
            }}
          >
            ← Back
          </button>
          <h2 className="m-0 text-xl">Mastery</h2>
        </div>
        <MasteryTeaser refreshKey={session.attemptVersion} />
      </div>
    )
  }

  // Shared by the filter banner and the empty-state message below, so both
  // describe the exact same active-filter combination the same way.
  const activeFilterLabels = [
    session.interactionFilter ? QUIZ_INTERACTION_LABELS[session.interactionFilter] : null,
    session.patternFilter ? PATTERN_LABELS[session.patternFilter] : null,
  ].filter((label): label is string => label !== null)

  // 2b.4: was separate PracticeShareCard/PracticeChallengeCard components
  // (deleted) — one ShareMenu now covers both, empty until `answer` matches
  // the currently displayed puzzle, same gate the old cards shared.
  const answer = lastAnswer && lastAnswer.puzzleId === session.puzzle?.id ? lastAnswer : null
  const shareActions: ShareAction[] = answer
    ? [
        {
          id: 'puzzle',
          label: 'Share puzzle',
          copiedLabel: 'Copied!',
          copyAriaLabel: 'Copy puzzle link',
          description: 'Copy a link to this exact puzzle',
          text: buildPracticeShareText({ puzzleId: answer.puzzleId, correct: answer.correct }),
          onShared: () => {
            trackShareClick({ surface: 'practice', puzzle_id: answer.puzzleId })
          },
        },
        ...(session.streakAttempts.length > 0
          ? [
              {
                id: 'challenge',
                label: 'Share challenge',
                copiedLabel: 'Link copied!',
                copyAriaLabel: 'Copy challenge link',
                description: `Challenge a friend to beat your streak of ${String(session.streakAttempts.length)}`,
                text: buildPracticeChallengeText({ attempts: session.streakAttempts }),
                onShared: () => {
                  trackChallengeCreate({
                    surface: 'practice',
                    puzzle_count: truncateToChallengeLimit([...session.streakAttempts]).length,
                  })
                },
              },
            ]
          : []),
      ]
    : []

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
        <div className="flex gap-2">
          <Link
            href="/browse"
            className="flex flex-1 items-center justify-between gap-2 min-h-11 py-[13px] px-[14px] border border-border-strong rounded-sm bg-transparent text-text-0 font-sans text-base font-bold no-underline cursor-pointer"
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
              className={MASTERY_INLINE_CLASS}
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
            clears both at once.

            2b.9 (space bug, 2026-08-21): one row, `overflow-x-auto` instead
            of `flex-wrap` — four chips at this padding/font-size don't
            reliably fit one row on a phone-width viewport, so wrapping put
            "Drag to reorder" alone on its own second line, spending a full
            row of height on one label. Each chip gets `flex-none` (never
            shrinks/wraps its own text) + `whitespace-nowrap`; the outer
            `-wrap` div + `.interaction-filter-scroll(-wrap)` (practicePage.css)
            hide the scrollbar and fade the trailing edge as the
            "there's more" affordance instead of a visible scrollbar. */}
        <div className="interaction-filter-scroll-wrap">
          <div
            className="interaction-filter-scroll flex flex-nowrap gap-2 overflow-x-auto"
            role="group"
            aria-label="Filter by interaction type"
          >
            {QUIZ_INTERACTIONS.map((interaction) => {
              const active = session.interactionFilter === interaction
              const chipClass = active
                ? 'flex-none min-h-11 py-1.5 px-3 border border-accent rounded-full bg-accent-dim text-text-0 text-sm font-semibold whitespace-nowrap cursor-pointer'
                : 'flex-none min-h-11 py-1.5 px-3 border border-border rounded-full bg-surface-1 text-text-1 text-sm font-semibold whitespace-nowrap cursor-pointer'
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
              ref={puzzleCardRef}
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
                shareActions={shareActions}
                sidebarSlot={sidebarSlotEl}
              />
            </motion.div>
          </AnimatePresence>
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
              {/* v4 Phase 4.5 ("the right rail"): PuzzleCardShell portals its
                  post-commit Continue+feedback block in here (via
                  `sidebarSlotEl` above) instead of rendering it inline below
                  the card — this is what keeps the card's height constant
                  across an answer. `empty:hidden` drops it (and the gap it'd
                  otherwise claim in this flex column) out of layout entirely
                  while nothing has portaled into it yet. Share moved down
                  here too — 2b.11's mobile trigger still lives inside
                  PuzzleCardShell's own drawer footer via `shareActions`
                  above; ShareMenu.tsx self-hides on an empty actions array,
                  so mounting it unconditionally here is safe before an
                  answer exists. */}
              <div ref={setSidebarSlotEl} className="empty:hidden flex flex-col gap-3" />
              <ShareMenu actions={shareActions} />
              <StatusBar
                rating={session.profile.rating}
                streak={session.profile.streak.currentStreak}
                combo={session.combo}
                solvedThisSession={session.solvedThisSession}
              />
              <MasteryTeaser refreshKey={session.attemptVersion} />
            </>
          )}
        </aside>
      )}
    </>
  )
}
