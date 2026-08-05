/**
 * Practice's challenge card (v2 Phase 5c) — the same copy-to-clipboard
 * mechanism as PracticeShareCard, reusing its `.share-card` classes
 * (imported from dailyPage.css here, so Practice's own lazy chunk is
 * self-sufficient for a cold, Daily-never-visited load — same rationale as
 * PracticeShareCard's own self-import), but the copied artifact is a
 * /challenge link replaying the live streak instead of share text. Fires
 * `challenge_create` (surface: 'practice') on the copy action.
 *
 * `puzzle_count` reflects what the link actually encodes — the streak
 * truncated to its last MAX_CHALLENGE_PUZZLES — not the raw streak length.
 */
import { useState } from 'react'
import { buildPracticeChallengeText } from './shareText'
import { trackChallengeCreate } from '../../telemetry'
import { truncateToChallengeLimit } from '../../challenge'
import type { ChallengeAttemptInput } from '../../challenge'
import '../daily/dailyPage.css'

export interface PracticeChallengeCardProps {
  /** The live streak's correct answers, in play order — buildChallengePayload keeps the last MAX_CHALLENGE_PUZZLES. */
  attempts: readonly ChallengeAttemptInput[]
}

export function PracticeChallengeCard({ attempts }: PracticeChallengeCardProps) {
  const [copied, setCopied] = useState(false)
  const text = buildPracticeChallengeText({ attempts })

  const handleCopy = () => {
    trackChallengeCreate({
      surface: 'practice',
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
