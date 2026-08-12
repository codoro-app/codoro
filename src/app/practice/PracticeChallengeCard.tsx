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

// 2b.0: was `.share-card`/`.share-card__text`/`.share-card__button` in
// dailyPage.css — same duplicated markup as ChallengeCard.tsx/
// ShareCard.tsx/PracticeShareCard.tsx.
const CARD_CLASS = 'flex flex-col gap-2 py-3.5 px-4 rounded-lg bg-surface-1 border border-border'
const TEXT_CLASS = 'm-0 font-mono text-md text-text-0 whitespace-pre-wrap break-words'
const BUTTON_CLASS =
  'min-h-11 border-0 rounded-sm bg-accent text-accent-ink font-bold cursor-pointer transition-[transform,opacity] duration-[0.05s] ease-out active:scale-[0.98] active:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

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
    <div className={CARD_CLASS}>
      <p className={TEXT_CLASS}>{text}</p>
      <button type="button" className={BUTTON_CLASS} onClick={handleCopy}>
        {copied ? 'Link copied!' : 'Challenge a friend'}
      </button>
    </div>
  )
}
