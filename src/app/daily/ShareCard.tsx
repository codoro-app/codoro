/**
 * The Wordle-style clipboard share card, shown once today's Daily puzzle has
 * a recorded first attempt (see DailyPage). "Copied!" is local, ungated UI
 * feedback — no telemetry event for the copy action itself in this phase.
 */
import { useState } from 'react'
import { buildShareText } from './shareText'
import './dailyPage.css'

export interface ShareCardProps {
  dayNumber: number
  correct: boolean
  streak: number
}

export function ShareCard({ dayNumber, correct, streak }: ShareCardProps) {
  const [copied, setCopied] = useState(false)
  const text = buildShareText({ dayNumber, correct, streak })

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
