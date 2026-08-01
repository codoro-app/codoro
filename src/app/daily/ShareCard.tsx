/**
 * The Wordle-style clipboard share card, shown once today's Daily puzzle has
 * a recorded first attempt (see DailyPage). "Copied!" is local, ungated UI
 * feedback. Fires `share_click` (v2 Phase 1b) on the copy action itself —
 * the only record that a share affordance was used, per the build plan.
 */
import { useState } from 'react'
import { buildShareText } from './shareText'
import { trackShareClick } from '../../telemetry'
import './dailyPage.css'

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
    <div className="share-card">
      <p className="share-card__text">{text}</p>
      <button type="button" className="share-card__button" onClick={handleCopy}>
        {copied ? 'Copied!' : 'Copy share text'}
      </button>
    </div>
  )
}
