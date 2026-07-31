/**
 * Practice's clipboard share card — the same copy-to-clipboard mechanism as
 * Daily's ShareCard (src/app/daily/ShareCard.tsx) and Rush's RushShareCard,
 * reusing their `.share-card` classes directly rather than forking them
 * (global CSS, already loaded via dailyPage.css whenever the app bundle
 * loads). Only the text template differs — see ./shareText.ts. Fires
 * `share_click` (v2 Phase 1b, surface: 'practice') on the copy action.
 */
import { useState } from 'react'
import { buildPracticeShareText } from './shareText'
import { trackShareClick } from '../../telemetry'

export interface PracticeShareCardProps {
  puzzleId: string
  correct: boolean
}

export function PracticeShareCard({ puzzleId, correct }: PracticeShareCardProps) {
  const [copied, setCopied] = useState(false)
  const text = buildPracticeShareText({ puzzleId, correct })

  const handleCopy = () => {
    trackShareClick({ surface: 'practice', puzzle_id: puzzleId })
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
    })
  }

  return (
    <div className="share-card">
      <p className="share-card__text">{text}</p>
      <button type="button" className="share-card__button" onClick={handleCopy}>
        {copied ? 'Copied!' : 'Copy share text'}
      </button>
    </div>
  )
}
