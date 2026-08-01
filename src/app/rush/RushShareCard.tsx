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
    <div className="share-card">
      <p className="share-card__text">{text}</p>
      <button type="button" className="share-card__button" onClick={handleCopy}>
        {copied ? 'Copied!' : 'Copy share text'}
      </button>
    </div>
  )
}
