/**
 * The comparison screen at the end of a `/challenge` run (v2 Phase 5c): the
 * recipient's just-finished run vs. the challenger's payload — "You got 4/5
 * in 63s — they got 5/5 in 48s" — with the win/lose/tie verdict resolved by
 * the pure `resolveChallengeOutcome` (correct count first, total time as the
 * tiebreaker; a tie counts as not beating the challenger), plus the plan's
 * two CTAs.
 *
 * CTA 1, counter-challenge: re-encodes the recipient's own run as a fresh
 * challenge link (`buildChallengeUrl(buildChallengePayload(yours))`) and
 * copies it to the clipboard — the same copy-button pattern as the surfaces'
 * ShareCards, and fires `challenge_create` with `surface: 'challenge'` since
 * the counter-challenge is its own calling mode. CTA 2, "practice more like
 * this": a plain /practice link — a challenge spans up to five puzzles
 * across potentially different patterns, so there's no single pattern to
 * filter on (unlike /puzzle/:id's per-puzzle CTA).
 */
import { useState } from 'react'
import { Link } from 'wouter'
import { buildChallengePayload, buildChallengeUrl } from '../../challenge'
import type { ChallengeAttemptInput, ChallengePayload } from '../../challenge'
import { trackChallengeCreate } from '../../telemetry'
import { resolveChallengeOutcome } from './challengeOutcome'
import type { ChallengeOutcome } from './challengeOutcome'

function formatSeconds(totalMs: number): string {
  return `${String(Math.round(totalMs / 1000))}s`
}

function verdictCopy(outcome: ChallengeOutcome): string {
  switch (outcome) {
    case 'won':
      return 'You beat the challenge!'
    case 'lost':
      return 'Your friend beat you'
    case 'tied':
      return 'It’s a tie'
  }
}

export interface ChallengeComparisonProps {
  /** The challenger's payload — the decoded `/challenge#...` link. */
  theirs: ChallengePayload
  /** The recipient's accumulated per-puzzle results, in play order (same puzzles, same length). */
  yours: readonly ChallengeAttemptInput[]
}

export function ChallengeComparison({ theirs, yours }: ChallengeComparisonProps) {
  const [copied, setCopied] = useState(false)

  const yoursCorrect = yours.filter((result) => result.correct).length
  const theirsCorrect = theirs.results.filter((result) => result.correct).length
  const yoursTotalMs = yours.reduce((sum, result) => sum + result.time_ms, 0)
  const outcome = resolveChallengeOutcome(
    { correct: yoursCorrect, totalMs: yoursTotalMs },
    { correct: theirsCorrect, totalMs: theirs.totalMs },
  )

  const handleCounterChallenge = () => {
    const counterUrl = buildChallengeUrl(buildChallengePayload([...yours]))
    trackChallengeCreate({ surface: 'challenge', puzzle_count: yours.length })
    void navigator.clipboard.writeText(counterUrl).then(() => {
      setCopied(true)
    })
  }

  return (
    <div className="challenge-comparison">
      <p className="challenge-comparison__verdict">{verdictCopy(outcome)}</p>
      <p className="challenge-comparison__line">
        You got {yoursCorrect}/{yours.length} in {formatSeconds(yoursTotalMs)} — they got{' '}
        {theirsCorrect}/{theirs.ids.length} in {formatSeconds(theirs.totalMs)}
      </p>
      <div className="challenge-comparison__actions">
        <button
          type="button"
          className="challenge-comparison__button"
          onClick={handleCounterChallenge}
        >
          {copied ? 'Link copied!' : 'Copy counter-challenge link'}
        </button>
        <Link href="/practice" className="challenge-comparison__link">
          Practice more like this
        </Link>
      </div>
    </div>
  )
}
