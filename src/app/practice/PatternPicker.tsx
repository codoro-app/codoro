/**
 * Browse-by-pattern entry point: pick a single bug pattern to practice, or
 * go back to the full pool. Filtering itself happens in usePracticeSession
 * (setPatternFilter) — this component is presentation only for the
 * navigation itself, but per the v2 design (decision #11 in the UI v2
 * Arena plan) it also surfaces per-pattern mastery — an accuracy badge,
 * progress track, and attempt-count caption — so Browse "reads as the same
 * design" as the rest of the mastery-aware UI rather than a bare name list.
 *
 * The mastery fetch below is a straight copy of MasteryView.tsx's
 * useEffect/cancelledRef/listAttempts/computeMastery pattern (see that
 * file's doc comment for why the ref, not a plain closure var, is needed).
 * Unlike MasteryView this view never gates rendering on the fetch: every
 * pattern card renders immediately using a zero-attempt fallback row, then
 * updates in place once the real attempt history resolves — Browse is a
 * navigation surface first, and the label/click-through must never wait on
 * an IndexedDB round trip.
 */
import { useEffect, useRef, useState } from 'react'
import { listAttempts } from '../../storage'
import type { Attempt } from '../../storage'
import { PATTERN_LABELS, PATTERN_SLUGS, puzzlePool } from '../../content'
import type { PatternSlug } from '../../content'
import { computeMastery, MIN_ATTEMPTS_FOR_MASTERY } from './mastery'
import type { PatternMastery } from './mastery'
import './practicePage.css'

export interface PatternPickerProps {
  onSelect: (pattern: PatternSlug | null) => void
  onBack: () => void
}

/** Decision #10's four accuracy-state buckets (UI v2 Arena plan). */
type MasteryState = 'new' | 'mastered' | 'learning' | 'weak'

function masteryState(row: PatternMastery): MasteryState {
  if (row.accuracy === null) return 'new'
  if (row.accuracy >= 0.8) return 'mastered'
  if (row.accuracy >= 0.4) return 'learning'
  return 'weak'
}

function emptyRow(pattern: PatternSlug): PatternMastery {
  return { pattern, attemptCount: 0, accuracy: null }
}

export function PatternPicker({ onSelect, onBack }: PatternPickerProps) {
  const [rows, setRows] = useState<PatternMastery[] | null>(null)

  const cancelledRef = useRef(false)
  useEffect(() => {
    cancelledRef.current = false
    void (async () => {
      const attempts: Attempt[] = await listAttempts()
      if (cancelledRef.current) return
      setRows(computeMastery(attempts, puzzlePool))
    })()
    return () => {
      cancelledRef.current = true
    }
  }, [])

  return (
    <div className="pattern-picker">
      <div className="pattern-picker__header">
        <button type="button" className="practice-page__link" onClick={onBack}>
          ← Back
        </button>
        <h2 className="pattern-picker__title">Practice by pattern</h2>
      </div>

      <button
        type="button"
        className="pattern-picker__all"
        onClick={() => {
          onSelect(null)
        }}
      >
        Practice all patterns
      </button>

      <div className="pattern-picker__grid">
        {PATTERN_SLUGS.map((slug) => {
          const row = rows?.find((candidate) => candidate.pattern === slug) ?? emptyRow(slug)
          const state = masteryState(row)
          const accuracyText =
            row.accuracy === null
              ? `Not enough data (${String(row.attemptCount)}/${String(MIN_ATTEMPTS_FOR_MASTERY)})`
              : `${String(Math.round(row.accuracy * 100))}%`
          const captionText = `${String(row.attemptCount)}/${String(MIN_ATTEMPTS_FOR_MASTERY)} · ${state}`
          const fillPct = Math.min(100, (row.attemptCount / MIN_ATTEMPTS_FOR_MASTERY) * 100)

          return (
            <button
              key={slug}
              type="button"
              className={`pattern-picker__button pattern-picker__button--${state}`}
              onClick={() => {
                onSelect(slug)
              }}
            >
              <div className="pattern-picker__row">
                <span className="pattern-picker__name">{PATTERN_LABELS[slug]}</span>
                <span className={`pattern-picker__badge pattern-picker__badge--${state}`}>
                  {accuracyText}
                </span>
              </div>
              <div className="progress-track">
                <div
                  className={`progress-track__fill progress-track__fill--${state}`}
                  style={{ width: `${String(fillPct)}%` }}
                />
              </div>
              <span className="pattern-picker__caption">{captionText}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
