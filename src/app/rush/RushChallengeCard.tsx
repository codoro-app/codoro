/**
 * Rush's challenge card (v2 Phase 5c) — the same copy-to-clipboard mechanism
 * as RushShareCard, reusing its `.share-card` classes directly rather than
 * forking them (global CSS, already loaded whenever the app bundle loads —
 * see RushPage.tsx's doc comment), but the copied artifact is a /challenge
 * link replaying the finished run instead of share text. Fires
 * `challenge_create` (surface: 'rush') on the copy action, same as
 * ChallengeCard.
 *
 * `puzzle_count` reflects what the link actually encodes — the run truncated
 * to its last MAX_CHALLENGE_PUZZLES — not the raw run length, so a 10-puzzle
 * run still reports a 5-puzzle challenge.
 */
import { useState } from 'react'
import { buildRushChallengeText } from './shareText'
import { trackChallengeCreate } from '../../telemetry'
import { truncateToChallengeLimit } from '../../challenge'
import type { ChallengeAttemptInput } from '../../challenge'

export interface RushChallengeCardProps {
  solvedCount: number
  bestStreakThisRun: number
  /** The finished run's attempts, in play order — buildChallengePayload keeps the last MAX_CHALLENGE_PUZZLES. */
  attempts: readonly ChallengeAttemptInput[]
}

export function RushChallengeCard({
  solvedCount,
  bestStreakThisRun,
  attempts,
}: RushChallengeCardProps) {
  const [copied, setCopied] = useState(false)
  const text = buildRushChallengeText({ solvedCount, bestStreakThisRun, attempts })

  const handleCopy = () => {
    trackChallengeCreate({
      surface: 'rush',
      puzzle_count: truncateToChallengeLimit([...attempts]).length,
    })
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
    })
  }

  return (
    <div className="share-card">
      <p className="share-card__text">{text}</p>
      <button type="button" className="share-card__button" onClick={handleCopy}>
        {copied ? 'Link copied!' : 'Challenge a friend'}
      </button>
    </div>
  )
}
