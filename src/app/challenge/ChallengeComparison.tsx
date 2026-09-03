/**
 * The comparison screen at the end of a `/challenge` run (v2 Phase 5c): the
 * recipient's just-finished run vs. the challenger's payload — "You got 4/5
 * in 63s — Joe got 5/5 in 48s" — with the win/lose/tie verdict resolved by
 * the pure `resolveChallengeOutcome` (correct count first, total time as the
 * tiebreaker; a tie counts as not beating the challenger), plus the plan's
 * two CTAs.
 *
 * Challenger-name copy (challenge redesign): `theirs.challengerName`
 * (`ChallengePayload`'s own v2 field — see src/challenge/schema.ts) is read
 * straight off the `theirs` prop already passed in, not threaded through as
 * a second, redundant `challengerName` prop — `theirs` already carries it.
 * `verdictCopy`'s "lost" case and the stats line both substitute it for the
 * old generic "Your friend"/"they" wherever the challenger is referenced,
 * falling back to that same generic copy when `challengerName` is `null`
 * (never set, or skipped — see ChallengerNameSheet.tsx).
 *
 * CTA 1, counter-challenge: `ChallengeButton` (challenge redesign — replaces
 * the old hand-rolled single-action `ShareMenu` row) re-encodes the
 * recipient's own run as a fresh challenge link, fed `yours` and
 * `surface: 'challenge'` — the counter-challenge is its own calling mode,
 * same as before. Since `useChallengeSession` is deliberately storage-free
 * (challenge play is structurally unrated — see its own module doc
 * comment), THIS component owns the small, separate concern of loading the
 * recipient's own `challengerName` for their counter-challenge — the only
 * reason this screen ever touches storage at all, and only a read (plus a
 * write if the recipient sets a name here for the first time), never an
 * attempt/rating write. CTA 2, "practice more like this": a plain /practice
 * link — a challenge spans up to five puzzles across potentially different
 * patterns, so there's no single pattern to filter on (unlike /puzzle/:id's
 * per-puzzle CTA).
 */
import { useEffect, useState } from 'react'
import { Link } from 'wouter'
import type { ChallengeAttemptInput, ChallengePayload } from '../../challenge'
import { loadProfile, saveProfile } from '../../storage'
import type { UserProfile } from '../../storage'
import { trackError } from '../../telemetry'
import { resolveChallengeOutcome } from './challengeOutcome'
import type { ChallengeOutcome } from './challengeOutcome'
import { ChallengeButton } from '../ChallengeButton'
import { useChallengerName } from '../useChallengerName'

function formatSeconds(totalMs: number): string {
  return `${String(Math.round(totalMs / 1000))}s`
}

/** Sentence-start fallback ("Your friend beat you") — capitalized, used only when `challengerName` is null. */
function verdictCopy(outcome: ChallengeOutcome, challengerName: string | null): string {
  switch (outcome) {
    case 'won':
      return 'You beat the challenge!'
    case 'lost':
      return `${challengerName ?? 'Your friend'} beat you`
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

  // The recipient's OWN profile, for their own counter-challenge's
  // `challengerName` — entirely separate from `theirs.challengerName` above
  // (the ORIGINAL challenger's name). Read-mostly: loaded once on mount,
  // written only if the recipient sets a name here for the first time (via
  // ChallengeButton's name-prompt sheet) — see this file's own module doc
  // comment for why that one read/write is in scope despite the challenge
  // domain's otherwise storage-free stance.
  const [profile, setProfileState] = useState<UserProfile | null>(null)
  useEffect(() => {
    let cancelled = false
    loadProfile()
      .then((loaded) => {
        if (!cancelled) setProfileState(loaded)
      })
      .catch((error: unknown) => {
        trackError(error, 'ChallengeComparison: loadProfile failed')
      })
    return () => {
      cancelled = true
    }
  }, [])
  const challenger = useChallengerName(profile, async (updated) => {
    setProfileState(updated)
    await saveProfile(updated)
  })

  const ctaClass =
    'inline-flex items-center min-h-11 py-2 px-3 rounded-sm border border-border bg-surface-1 text-accent font-semibold no-underline text-[0.9375rem] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

  return (
    <div className="flex flex-col gap-3 text-center py-4">
      <p className="text-text-1 font-bold text-[1.125rem] m-0">
        {verdictCopy(outcome, theirs.challengerName)}
      </p>
      <p className="text-text-2 m-0">
        You got {yoursCorrect}/{yours.length} in {formatSeconds(yoursTotalMs)} —{' '}
        {theirs.challengerName ?? 'they'} got {theirsCorrect}/{theirs.ids.length} in{' '}
        {formatSeconds(theirs.totalMs)}
      </p>
      <div className="flex flex-wrap gap-3 justify-center mt-2">
        <ChallengeButton
          attempts={yours}
          surface="challenge"
          introLabel="beat my counter-challenge"
          challengerName={challenger.name}
          onNameNeeded={challenger.setName}
        />
        <Link href="/practice" className={ctaClass}>
          Practice more like this
        </Link>
      </div>
    </div>
  )
}
