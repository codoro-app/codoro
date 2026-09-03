/**
 * `/challenge` — Codoro's shared challenge links (v2 Phase 5c). The whole
 * challenge lives in the URL fragment (`/challenge#<base64url>`, decoded by
 * src/challenge's codec), so this is a plain static route: no wouter param,
 * no DYNAMIC_ROUTES entry, and — because a fragment never reaches Cloudflare
 * or the SW — no special hosting/SW handling beyond the literal `_redirects`
 * line and denylist alternative every static route gets.
 *
 * Split the same way PuzzlePage.tsx and TraceRunner.tsx are (outer owns
 * reading the location, inner is pure props) so the decode/broken-link/
 * sequencing logic is directly testable without a Router wrapper:
 * `ChallengePage` reads the fragment straight from window.location.hash (NOT
 * wouter's useLocation — that hook is pathname-only, see its own bug note
 * below) and hands the fragment content off to the exported
 * `ChallengePageForHash`, keyed by hash so a hash change (editing the URL)
 * remounts a fresh session rather than needing a reset effect.
 *
 * Dispatch is identical to `/puzzle/:id`'s: quiz interactions
 * (mcq/swipe-binary/tap-line/drag-order) go through the same
 * `PuzzleCardShell`; `scrubber` reuses `TraceRunnerPuzzle` driven by the
 * session hook's local state. Neither shell is forked; `ratingDelta` is
 * always `null` because challenge play is structurally unrated — no
 * `appendAttempt`, no `saveProfile`, no rating math anywhere (the storage
 * boundary is asserted in ChallengePage.test.tsx).
 *
 * A payload that doesn't decode, or whose ids don't all resolve to real
 * bundled puzzles, renders the same legible broken-link state (reject
 * wholesale, matching the codec's standard). The recipient's per-puzzle
 * results accumulate in the hook and drive both the comparison screen and a
 * counter-challenge, which re-encodes the recipient's own run as a fresh
 * challenge link.
 *
 * Challenge redesign: `status === 'intro'` renders a landing hero ahead of
 * puzzle 1 — named greeting (`payload.challengerName`, nullable — "Joe
 * challenged you!" vs "A friend challenged you!"), puzzle count/pattern
 * chips (from `session.puzzles`, not `payload.ids` alone — the payload
 * carries no pattern metadata), and "Accept Challenge →", which calls
 * `session.handleAccept` — the moment that actually starts puzzle 1's clock
 * (see `useChallengeSession`'s own doc comment). This is what fixes the
 * second of the two real gaps the redesign's design record names: dropping
 * a recipient straight into puzzle 1 with zero framing.
 */
import { Link } from 'wouter'
import { useEffect, useState } from 'react'
import { useChallengeSession } from './useChallengeSession'
import { ChallengeComparison } from './ChallengeComparison'
import { PuzzleCardShell } from '../practice/PuzzleCardShell'
import { TraceRunnerPuzzle } from '../trace/TraceRunner'
import { useMediaQuery } from '../useMediaQuery'
import { PATTERN_LABELS } from '../../content'
import '../tokens.css'

// 2b.0: was `.challenge-page` (challengePage.css, max-width breakpoint
// matches Tailwind's `lg` exactly). Not test-asserted (grep-verified).
const PAGE_SHELL_CLASS =
  'app-shell__main flex flex-col gap-4 w-full max-w-[var(--content-width-mobile)] lg:max-w-[var(--content-width-desktop)] mx-auto pt-[var(--space-4)] px-4 pb-4'
const CTA_CLASS =
  'inline-flex self-start items-center min-h-11 py-2 px-3 rounded-sm border border-border bg-surface-1 text-accent font-semibold no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'
// Same "prominent accent card" register as DailyPage.tsx's `.daily-hero`
// treatment (reused verbatim by Rush/Boss's own end-of-run cards) — the
// intro hero is this same visual language's first use ahead of a run
// instead of after one.
const INTRO_HERO_CLASS =
  'flex flex-col items-center gap-4 p-4 lg:py-[28px] lg:px-[30px] rounded-xl border-[1.5px] border-accent [background:linear-gradient(160deg,var(--accent-dim),var(--surface-1))] text-center'
const CHIP_CLASS =
  'inline-flex items-center min-h-8 py-1 px-3 rounded-full bg-surface-0 border border-border text-text-1 text-sm font-semibold'
const ACCEPT_BUTTON_CLASS =
  'min-h-11 py-2 px-5 border-0 rounded-sm bg-accent text-accent-ink font-bold cursor-pointer transition-[transform,opacity] duration-[0.05s] ease-out active:scale-[0.98] active:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

/** Pure, props-driven inner component — exported so tests can drive it directly against a raw fragment without a Router wrapper. */
export interface ChallengePageForHashProps {
  /** Fragment content with no leading '#', e.g. what `window.location.hash` yields after stripping the '#'. */
  hash: string
}

export function ChallengePageForHash({ hash }: ChallengePageForHashProps) {
  const session = useChallengeSession(hash)
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  // v4 Phase 4.5 ("the right rail") — same ref-callback-in-state portal
  // target as PracticePage.tsx's identical `sidebarSlotEl`.
  const [sidebarSlotEl, setSidebarSlotEl] = useState<HTMLDivElement | null>(null)

  // Task 6 (content-metadata-lazy-load follow-up): puzzle bodies now resolve
  // via getPuzzleBody, a genuine async hop the eager puzzlePool never had —
  // this must render distinctly from 'broken' so an unresolved-yet id isn't
  // briefly mistaken for a dead link. Same plain-text-in-the-page-shell
  // pattern BossPage.tsx already uses for its own profile-load window.
  if (session.status === 'loading') {
    return (
      <div className={PAGE_SHELL_CLASS}>
        <p className="text-center text-text-1 py-8">Loading challenge…</p>
      </div>
    )
  }

  if (session.status === 'broken') {
    return (
      <div className={PAGE_SHELL_CLASS}>
        <p className="text-center text-text-1 py-8">
          This challenge link is broken — it may have been copied incorrectly, or one of its puzzles
          was removed.
        </p>
        <Link href="/practice" className={CTA_CLASS}>
          Go to Practice
        </Link>
      </div>
    )
  }

  if (session.status === 'intro' && session.payload) {
    const puzzleCount = session.payload.ids.length
    // Deduplicated, in first-appearance order — a repeated pattern across
    // several puzzles (or a challenge that legally repeats the same puzzle
    // id back-to-back, see useChallengeSession's `puzzleIndex` doc comment)
    // shows one chip, not one per puzzle.
    const patterns = Array.from(new Set((session.puzzles ?? []).map((p) => p.pattern)))
    return (
      <div className={PAGE_SHELL_CLASS}>
        <div className={INTRO_HERO_CLASS}>
          <p className="m-0 text-xl font-bold text-text-0">
            {session.payload.challengerName ?? 'A friend'} challenged you!
          </p>
          <div className="flex flex-wrap gap-2 justify-center">
            <span className={CHIP_CLASS}>
              {puzzleCount} puzzle{puzzleCount === 1 ? '' : 's'}
            </span>
            {patterns.map((pattern) => (
              <span key={pattern} className={CHIP_CLASS}>
                {PATTERN_LABELS[pattern]}
              </span>
            ))}
          </div>
          <button type="button" className={ACCEPT_BUTTON_CLASS} onClick={session.handleAccept}>
            Accept Challenge →
          </button>
        </div>
      </div>
    )
  }

  if (session.status === 'done' && session.payload) {
    return (
      <div className={PAGE_SHELL_CLASS}>
        <ChallengeComparison theirs={session.payload} yours={session.results} />
      </div>
    )
  }

  const puzzle = session.puzzle
  if (!puzzle) return null

  // session.payload is guaranteed non-null once status reaches 'playing'
  // (see useChallengeSession's Resolution type) — `?? 1` only humors TS's
  // narrowing here, never an observed 0 in practice.
  const totalPuzzles = session.payload?.ids.length ?? 1

  return (
    <>
      <div className={PAGE_SHELL_CLASS}>
        {puzzle.interaction === 'scrubber' ? (
          // Keyed by puzzleIndex (position), not puzzle.id: a challenge
          // payload can legally repeat the same id back-to-back (see
          // useChallengeSession's puzzleIndex doc), and keying by id would
          // reuse the same instance across both occurrences instead of
          // resetting TraceRunnerPuzzle's internal stepIndex for the second
          // one.
          <TraceRunnerPuzzle
            key={session.puzzleIndex}
            puzzle={puzzle}
            checkpointResults={session.checkpointResults}
            isComplete={session.isComplete}
            solved={session.solved}
            ratingDelta={null}
            onCheckpointAnswered={session.handleCheckpointAnswered}
            onContinue={session.handleContinue}
            timed={false}
            sidebarSlot={sidebarSlotEl}
          />
        ) : (
          // Keyed by position for the same reason: PuzzleCardShell's
          // self-reset guard compares commit.puzzleId === puzzle.id, which
          // can't tell two occurrences of the same id apart. Keying by
          // puzzleIndex forces a real remount on every advance, duplicate id
          // or not.
          <PuzzleCardShell
            key={session.puzzleIndex}
            puzzle={puzzle}
            ratingDelta={null}
            onAnswered={session.handleAnswered}
            onContinue={session.handleContinue}
            sidebarSlot={sidebarSlotEl}
          />
        )}
      </div>

      {isDesktop && (
        // v4 Phase 4.5 ("the right rail") — new sidebar, Challenge had none
        // before. Progress line is page-owned (session already exposes the
        // numbers); the feedback/Continue block below it portals in from
        // whichever shell is active above.
        <aside className="app-shell__sidebar flex flex-col gap-4 py-6 px-4 border-l border-border self-start">
          <p className="m-0 text-sm font-bold text-text-1">
            Puzzle {session.puzzleIndex + 1} of {totalPuzzles}
          </p>
          <div ref={setSidebarSlotEl} className="empty:hidden flex flex-col gap-4" />
        </aside>
      )}
    </>
  )
}

export function ChallengePage() {
  // wouter's useLocation is pathname-only (use-browser-location.js:
  // `currentPathname = () => location.pathname`) — the fragment never appears
  // in it, so the first shipped version's `location.split('#')[1]` was always
  // '' and every real challenge link rendered the broken state. This bug was
  // invisible to the suite because ChallengePage.test.tsx drove
  // ChallengePageForHash with a raw hash prop, never this wrapper — the
  // Finding 4 class of "only a real browser load shows it". Read the fragment
  // directly from window.location.hash, and subscribe to hashchange so
  // editing the URL (the one way this link-only route changes) remounts a
  // fresh session via the key below.
  const [hash, setHash] = useState(() => window.location.hash.replace(/^#/, ''))
  useEffect(() => {
    const onHashChange = () => {
      setHash(window.location.hash.replace(/^#/, ''))
    }
    window.addEventListener('hashchange', onHashChange)
    return () => {
      window.removeEventListener('hashchange', onHashChange)
    }
  }, [])
  return <ChallengePageForHash key={hash} hash={hash} />
}
