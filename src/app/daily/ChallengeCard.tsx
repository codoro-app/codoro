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

// 2b.0: was `.share-card`/`.share-card__text`/`.share-card__button` in
// dailyPage.css — same duplicated markup as ShareCard.tsx/
// PracticeChallengeCard.tsx/PracticeShareCard.tsx (2b.4 is the planned
// consolidation into one ShareMenu; this pass is mechanical only).
const CARD_CLASS = 'flex flex-col gap-2 py-3.5 px-4 rounded-lg bg-surface-1 border border-border'
const TEXT_CLASS = 'm-0 font-mono text-md text-text-0 whitespace-pre-wrap break-words'
const BUTTON_CLASS =
  'min-h-11 border-0 rounded-sm bg-accent text-accent-ink font-bold cursor-pointer transition-[transform,opacity] duration-[0.05s] ease-out active:scale-[0.98] active:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

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
    <div className={CARD_CLASS}>
      <p className={TEXT_CLASS}>{text}</p>
      <button type="button" className={BUTTON_CLASS} onClick={handleCopy}>
        {copied ? 'Link copied!' : 'Challenge a friend'}
      </button>
    </div>
  )
}
