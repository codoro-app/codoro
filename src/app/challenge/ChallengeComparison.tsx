/**
 * The comparison screen at the end of a `/challenge` run (v2 Phase 5c): the
 * recipient's just-finished run vs. the challenger's payload — "You got 4/5
 * in 63s — they got 5/5 in 48s" — with the win/lose/tie verdict resolved by
 * the pure `resolveChallengeOutcome` (correct count first, total time as the
 * tiebreaker; a tie counts as not beating the challenger), plus the plan's
 * two CTAs.
 *
 * CTA 1, counter-challenge: re-encodes the recipient's own run as a fresh
 * challenge link (`buildChallengeUrl(buildChallengePayload(yours))`) via the
 * shared `ShareMenu` (v3 Phase 2b.4) in its single-action form — native
 * share on mobile, clipboard-copy fallback on desktop — and fires
 * `challenge_create` with `surface: 'challenge'` since the counter-challenge
 * is its own calling mode. CTA 2, "practice more like this": a plain
 * /practice link — a challenge spans up to five puzzles across potentially
 * different patterns, so there's no single pattern to filter on (unlike
 * /puzzle/:id's per-puzzle CTA).
 */
import { Link } from 'wouter'
import { buildChallengePayload, buildChallengeUrl } from '../../challenge'
import type { ChallengeAttemptInput, ChallengePayload } from '../../challenge'
import { trackChallengeCreate } from '../../telemetry'
import { resolveChallengeOutcome } from './challengeOutcome'
import type { ChallengeOutcome } from './challengeOutcome'
import { ShareMenu } from '../ShareMenu'
import type { ShareAction } from '../ShareMenu'

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
  const yoursCorrect = yours.filter((result) => result.correct).length
  const theirsCorrect = theirs.results.filter((result) => result.correct).length
  const yoursTotalMs = yours.reduce((sum, result) => sum + result.time_ms, 0)
  const outcome = resolveChallengeOutcome(
    { correct: yoursCorrect, totalMs: yoursTotalMs },
    { correct: theirsCorrect, totalMs: theirs.totalMs },
  )

  const shareActions: ShareAction[] = [
    {
      id: 'counter-challenge',
      label: 'Share counter-challenge',
      copiedLabel: 'Link copied!',
      copyAriaLabel: 'Copy counter-challenge link',
      text: buildChallengeUrl(buildChallengePayload([...yours])),
      onShared: () => {
        trackChallengeCreate({ surface: 'challenge', puzzle_count: yours.length })
      },
    },
  ]

  const ctaClass =
    'inline-flex items-center min-h-11 py-2 px-3 rounded-sm border border-border bg-surface-1 text-accent font-semibold no-underline text-[0.9375rem] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

  return (
    <div className="flex flex-col gap-3 text-center py-4">
      <p className="text-text-1 font-bold text-[1.125rem] m-0">{verdictCopy(outcome)}</p>
      <p className="text-text-2 m-0">
        You got {yoursCorrect}/{yours.length} in {formatSeconds(yoursTotalMs)} — they got{' '}
        {theirsCorrect}/{theirs.ids.length} in {formatSeconds(theirs.totalMs)}
      </p>
      <div className="flex flex-wrap gap-3 justify-center mt-2">
        <ShareMenu actions={shareActions} />
        <Link href="/practice" className={ctaClass}>
          Practice more like this
        </Link>
      </div>
    </div>
  )
}
