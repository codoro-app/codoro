/**
 * Rush's clipboard share card — the same copy-to-clipboard mechanism as
 * Daily's ShareCard (src/app/daily/ShareCard.tsx), reusing its `.share-card`
 * classes directly rather than forking them (they're global CSS, already
 * loaded whenever the app bundle loads — see RushPage.tsx's doc comment).
 * Only the text template differs — see ./shareText.ts.
 */
import { useState } from 'react'
import { buildRushShareText } from './shareText'

export interface RushShareCardProps {
  solvedCount: number
  bestStreakThisRun: number
}

export function RushShareCard({ solvedCount, bestStreakThisRun }: RushShareCardProps) {
  const [copied, setCopied] = useState(false)
  const text = buildRushShareText({ solvedCount, bestStreakThisRun })

  const handleCopy = () => {
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
