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

// 2b.0: was `.share-card`/`.share-card__text`/`.share-card__button` in
// dailyPage.css — same duplicated markup as RushShareCard.tsx and the
// daily/practice challenge/share cards.
const CARD_CLASS = 'flex flex-col gap-2 py-3.5 px-4 rounded-lg bg-surface-1 border border-border'
const TEXT_CLASS = 'm-0 font-mono text-md text-text-0 whitespace-pre-wrap break-words'
const BUTTON_CLASS =
  'min-h-11 border-0 rounded-sm bg-accent text-accent-ink font-bold cursor-pointer transition-[transform,opacity] duration-[0.05s] ease-out active:scale-[0.98] active:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

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
    <div className={CARD_CLASS}>
      <p className={TEXT_CLASS}>{text}</p>
      <button type="button" className={BUTTON_CLASS} onClick={handleCopy}>
        {copied ? 'Link copied!' : 'Challenge a friend'}
      </button>
    </div>
  )
}
