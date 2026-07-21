/**
 * Per-pattern mastery view: fetches the full attempt history, runs it
 * through mastery.ts's pure computeMastery, and renders one row per pattern
 * (label, accuracy or "not enough data", attempt count considered).
 *
 * `onBack` is optional: the mobile "Mastery" nav view (PracticePage) passes
 * it to return to the practice view; the desktop always-visible sidebar
 * copy (PracticePage/DailyPage, >=1024px) omits it since there's nowhere to
 * "go back" from a persistent panel — the header simply drops the button.
 *
 * `refreshKey` is optional: the attempt fetch is otherwise mount-only, so
 * without it this view goes stale the moment an attempt is recorded
 * elsewhere in the tree (usePracticeSession/useDailySession own the attempt
 * data, this component doesn't). Callers pass their session's
 * `attemptVersion` (bumped on every recorded attempt) so a changed value
 * re-triggers the fetch — the minimal lift needed to keep two siblings in
 * sync without a state library.
 *
 * `onSelectPattern` is optional: when provided (PracticePage only — Daily
 * has no pattern-filtered practice), tapping a row starts practicing that
 * pattern via the same path PatternPicker already uses.
 */
import { useEffect, useRef, useState } from 'react'
import { listAttempts } from '../../storage'
import type { Attempt } from '../../storage'
import { PATTERN_LABELS, puzzlePool } from '../../content'
import type { PatternSlug } from '../../content'
import { computeMastery, MIN_ATTEMPTS_FOR_MASTERY } from './mastery'
import type { PatternMastery } from './mastery'
import './practicePage.css'

export interface MasteryViewProps {
  onBack?: () => void
  refreshKey?: number
  onSelectPattern?: (pattern: PatternSlug) => void
}

export function MasteryView({ onBack, refreshKey, onSelectPattern }: MasteryViewProps) {
  const [rows, setRows] = useState<PatternMastery[] | null>(null)

  // A ref, not a plain `let` closure var — see usePracticeSession.ts's
  // identical pattern for why (typescript-eslint no-unnecessary-condition
  // false positive on a `let` read inside the same closure it's set in).
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
  }, [refreshKey])

  return (
    <div className="mastery-view">
      <div className="mastery-view__header">
        {onBack && (
          <button type="button" className="practice-page__link" onClick={onBack}>
            ← Back
          </button>
        )}
        <h2 className="mastery-view__title">Mastery by pattern</h2>
      </div>

      {rows === null ? (
        <p className="practice-page__status">Loading mastery…</p>
      ) : (
        <ul className="mastery-view__list">
          {rows.map((row) => {
            const accuracyText =
              row.accuracy === null
                ? `Not enough data (${String(row.attemptCount)}/${String(MIN_ATTEMPTS_FOR_MASTERY)})`
                : `${String(Math.round(row.accuracy * 100))}%`
            const countText = `${String(row.attemptCount)} attempts`

            return (
              <li key={row.pattern}>
                {onSelectPattern ? (
                  <button
                    type="button"
                    className="mastery-row"
                    onClick={() => {
                      onSelectPattern(row.pattern)
                    }}
                  >
                    <span className="mastery-row__label">{PATTERN_LABELS[row.pattern]}</span>
                    <span className="mastery-row__accuracy">{accuracyText}</span>
                    <span className="mastery-row__count">{countText}</span>
                  </button>
                ) : (
                  <div className="mastery-row">
                    <span className="mastery-row__label">{PATTERN_LABELS[row.pattern]}</span>
                    <span className="mastery-row__accuracy">{accuracyText}</span>
                    <span className="mastery-row__count">{countText}</span>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
