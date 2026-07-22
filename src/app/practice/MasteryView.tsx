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

/**
 * Decision #10's four accuracy-state buckets (UI v2 Arena plan) — mirrors
 * PatternPicker.tsx's identical `masteryState` helper verbatim so both
 * mastery-aware surfaces bucket rows the same way. Not extracted to a
 * shared module: this task's file list is scoped to MasteryView.tsx +
 * practicePage.css only.
 */
type MasteryState = 'new' | 'mastered' | 'learning' | 'weak'

function masteryState(row: PatternMastery): MasteryState {
  if (row.accuracy === null) return 'new'
  if (row.accuracy >= 0.8) return 'mastered'
  if (row.accuracy >= 0.4) return 'learning'
  return 'weak'
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
        <>
          {rows.every((row) => row.attemptCount === 0) && (
            <div className="mastery-view__empty">
              <div className="mastery-view__empty-icon">
                <svg
                  width="22"
                  height="22"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M3 3v18h18" />
                  <path d="m19 9-5 5-4-4-3 3" />
                </svg>
              </div>
              <p className="mastery-view__empty-title">Build your mastery map</p>
              <p className="mastery-view__empty-copy">
                Solve puzzles and each pattern fills in with your accuracy over time.
              </p>
            </div>
          )}

          <ul className="mastery-view__list">
            {rows.map((row) => {
              const state = masteryState(row)
              const accuracyText =
                row.accuracy === null
                  ? `Not enough data (${String(row.attemptCount)}/${String(MIN_ATTEMPTS_FOR_MASTERY)})`
                  : `${String(Math.round(row.accuracy * 100))}%`
              const countText = `${String(row.attemptCount)} attempts`
              // Below the data threshold there's no accuracy yet, so the
              // track fills toward "enough data collected" instead (same
              // formula PatternPicker.tsx uses for its own cards) — matches
              // the reference's 2l partial-data rows (2/5 attempts -> 40%
              // fill, not accuracy-based).
              const fillPct =
                row.accuracy === null
                  ? Math.min(100, (row.attemptCount / MIN_ATTEMPTS_FOR_MASTERY) * 100)
                  : row.accuracy * 100
              const rowClassName =
                state === 'weak' ? 'mastery-row mastery-row--weak' : 'mastery-row'

              const rowContent = (
                <>
                  <div className="mastery-row__top">
                    <span className="mastery-row__label">
                      {PATTERN_LABELS[row.pattern]}
                      {state === 'weak' && <span className="mastery-row__weak-tag"> · weak</span>}
                    </span>
                    <span className={`mastery-row__accuracy mastery-row__accuracy--${state}`}>
                      {accuracyText}
                    </span>
                  </div>
                  <div className="progress-track">
                    <div
                      className={`progress-track__fill progress-track__fill--${state}`}
                      style={{ width: `${String(fillPct)}%` }}
                    />
                  </div>
                  <span className="mastery-row__count">{countText}</span>
                </>
              )

              return (
                <li key={row.pattern}>
                  {onSelectPattern ? (
                    <button
                      type="button"
                      className={rowClassName}
                      onClick={() => {
                        onSelectPattern(row.pattern)
                      }}
                    >
                      {rowContent}
                    </button>
                  ) : (
                    <div className={rowClassName}>{rowContent}</div>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
