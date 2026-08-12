/**
 * The Wordle-style clipboard share card, shown once today's Daily puzzle has
 * a recorded first attempt (see DailyPage). "Copied!" is local, ungated UI
 * feedback. Fires `share_click` (v2 Phase 1b) on the copy action itself —
 * the only record that a share affordance was used, per the build plan.
 */
import { useState } from 'react'
import { buildShareText } from './shareText'
import { trackShareClick } from '../../telemetry'

// 2b.0: was `.share-card`/`.share-card__text`/`.share-card__button` in
// dailyPage.css — same duplicated markup as ChallengeCard.tsx/
// PracticeChallengeCard.tsx/PracticeShareCard.tsx.
const CARD_CLASS = 'flex flex-col gap-2 py-3.5 px-4 rounded-lg bg-surface-1 border border-border'
const TEXT_CLASS = 'm-0 font-mono text-md text-text-0 whitespace-pre-wrap break-words'
const BUTTON_CLASS =
  'min-h-11 border-0 rounded-sm bg-accent text-accent-ink font-bold cursor-pointer transition-[transform,opacity] duration-[0.05s] ease-out active:scale-[0.98] active:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

export interface ShareCardProps {
  dayNumber: number
  correct: boolean
  streak: number
  puzzleId: string
}

export function ShareCard({ dayNumber, correct, streak, puzzleId }: ShareCardProps) {
  const [copied, setCopied] = useState(false)
  const text = buildShareText({ dayNumber, correct, streak, puzzleId })

  const handleCopy = () => {
    trackShareClick({ surface: 'daily', puzzle_id: puzzleId })
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
