/**
 * Rush's clipboard share card — the same copy-to-clipboard mechanism as
 * Daily's ShareCard (src/app/daily/ShareCard.tsx), reusing its `.share-card`
 * classes directly rather than forking them (they're global CSS, already
 * loaded whenever the app bundle loads — see RushPage.tsx's doc comment).
 * Only the text template differs — see ./shareText.ts. Fires `share_click`
 * (v2 Phase 1b) on the copy action, same as ShareCard.
 */
import { useState } from 'react'
import { buildRushShareText } from './shareText'
import { trackShareClick } from '../../telemetry'

// 2b.0: was `.share-card`/`.share-card__text`/`.share-card__button` in
// dailyPage.css — same duplicated markup as daily/ChallengeCard.tsx/
// ShareCard.tsx/practice/PracticeChallengeCard.tsx/PracticeShareCard.tsx.
const CARD_CLASS = 'flex flex-col gap-2 py-3.5 px-4 rounded-lg bg-surface-1 border border-border'
const TEXT_CLASS = 'm-0 font-mono text-md text-text-0 whitespace-pre-wrap break-words'
const BUTTON_CLASS =
  'min-h-11 border-0 rounded-sm bg-accent text-accent-ink font-bold cursor-pointer transition-[transform,opacity] duration-[0.05s] ease-out active:scale-[0.98] active:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

export interface RushShareCardProps {
  solvedCount: number
  bestStreakThisRun: number
  puzzleId: string
}

export function RushShareCard({ solvedCount, bestStreakThisRun, puzzleId }: RushShareCardProps) {
  const [copied, setCopied] = useState(false)
  const text = buildRushShareText({ solvedCount, bestStreakThisRun, puzzleId })

  const handleCopy = () => {
    trackShareClick({ surface: 'rush', puzzle_id: puzzleId })
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
    })
  }

  return (
    <div className={CARD_CLASS}>
      <p className={TEXT_CLASS}>{text}</p>
      <button type="button" className={BUTTON_CLASS} onClick={handleCopy}>
        {copied ? 'Copied!' : 'Copy share text'}
      </button>
    </div>
  )
}
