/**
 * Daily's challenge card (v2 Phase 5c) — the same copy-to-clipboard
 * mechanism as ShareCard (src/app/daily/ShareCard.tsx), reusing its
 * `.share-card` classes, but the copied artifact is a /challenge link
 * replaying the day's first attempt instead of share text. Fires
 * `challenge_create` (surface: 'daily') on the copy action itself — the
 * only record that a challenge link was made, per the build plan.
 *
 * Session-only: the `attempt` prop is the day's first (rated) result and is
 * never replaced by an unrated retry — the same "no re-taking for a better
 * share" rule as the ShareCard (see useDailySession's challengeAttempt).
 */
import { useState } from 'react'
import { buildDailyChallengeText } from './shareText'
import { trackChallengeCreate } from '../../telemetry'
import type { ChallengeAttemptInput } from '../../challenge'
import './dailyPage.css'

export interface ChallengeCardProps {
  dayNumber: number
  /** The day's first (rated) attempt — the challenge link replays this exact puzzle. */
  attempt: ChallengeAttemptInput
}

export function ChallengeCard({ dayNumber, attempt }: ChallengeCardProps) {
  const [copied, setCopied] = useState(false)
  const text = buildDailyChallengeText({ dayNumber, attempt })

  const handleCopy = () => {
    // Daily is always exactly one puzzle — the day's first attempt.
    trackChallengeCreate({ surface: 'daily', puzzle_count: 1 })
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
