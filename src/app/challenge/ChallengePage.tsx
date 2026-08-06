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
 */
import { Link } from 'wouter'
import { useEffect, useState } from 'react'
import { useChallengeSession } from './useChallengeSession'
import { ChallengeComparison } from './ChallengeComparison'
import { PuzzleCardShell } from '../practice/PuzzleCardShell'
import { TraceRunnerPuzzle } from '../trace/TraceRunner'
import '../tokens.css'
import './challengePage.css'

/** Pure, props-driven inner component — exported so tests can drive it directly against a raw fragment without a Router wrapper. */
export interface ChallengePageForHashProps {
  /** Fragment content with no leading '#', e.g. what `window.location.hash` yields after stripping the '#'. */
  hash: string
}

export function ChallengePageForHash({ hash }: ChallengePageForHashProps) {
  const session = useChallengeSession(hash)

  if (session.status === 'broken') {
    return (
      <div className="challenge-page app-shell__main">
        <p className="challenge-page__status">
          This challenge link is broken — it may have been copied incorrectly, or one of its puzzles
          was removed.
        </p>
        <Link href="/practice" className="challenge-page__cta">
          Go to Practice
        </Link>
      </div>
    )
  }

  if (session.status === 'done' && session.payload) {
    return (
      <div className="challenge-page app-shell__main">
        <ChallengeComparison theirs={session.payload} yours={session.results} />
      </div>
    )
  }

  const puzzle = session.puzzle
  if (!puzzle) return null

  return (
    <div className="challenge-page app-shell__main">
      {puzzle.interaction === 'scrubber' ? (
        // keyed by puzzle.id so TraceRunnerPuzzle's internal stepIndex
        // resets when the session advances to the next challenge puzzle —
        // same keyed-remount convention TraceRunner itself uses.
        <TraceRunnerPuzzle
          key={puzzle.id}
          puzzle={puzzle}
          checkpointResults={session.checkpointResults}
          isComplete={session.isComplete}
          solved={session.solved}
          ratingDelta={null}
          onCheckpointAnswered={session.handleCheckpointAnswered}
          onContinue={session.handleContinue}
          timed={false}
        />
      ) : (
        <PuzzleCardShell
          key={puzzle.id}
          puzzle={puzzle}
          ratingDelta={null}
          onAnswered={session.handleAnswered}
          onContinue={session.handleContinue}
        />
      )}
    </div>
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
