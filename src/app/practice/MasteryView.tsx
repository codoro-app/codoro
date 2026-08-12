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

// 2b.0: was `.mastery-row__accuracy--<state>` in practicePage.css. Only
// mastered/learning get a pill background (decision #10: "no pill
// background" for new/weak — those stay plain colored text).
function accuracyClass(state: MasteryState): string {
  if (state === 'mastered') return 'text-accent bg-accent-dim py-0.5 px-2 rounded-full'
  if (state === 'learning') return 'text-warn bg-warn-dim py-0.5 px-2 rounded-full'
  if (state === 'weak') return 'text-danger'
  return 'text-text-2'
}

// 2b.0: was `.progress-track__fill--<state>` in practicePage.css.
function fillClass(state: MasteryState): string {
  if (state === 'mastered') return 'bg-accent'
  if (state === 'learning') return 'bg-warn'
  if (state === 'weak') return 'bg-danger'
  return 'bg-border-strong'
}

// Reused verbatim from PatternPicker.tsx's "← Back" button (was the shared
// `.practice-page__link` classname).
const LINK_CLASS =
  'min-h-11 py-2 px-3 border-0 bg-transparent text-accent text-md font-semibold cursor-pointer'

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
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        {onBack && (
          <button type="button" className={LINK_CLASS} onClick={onBack}>
            ← Back
          </button>
        )}
        <h2 className="m-0 text-xl">Mastery by pattern</h2>
      </div>

      {rows === null ? (
        <p className="text-center text-text-1 py-8">Loading mastery…</p>
      ) : (
        <>
          {rows.every((row) => row.attemptCount === 0) && (
            <div className="text-center py-5 px-3 pb-6 border border-dashed border-border-strong rounded-md bg-surface-1">
              <div className="w-11 h-11 rounded-md bg-surface-2 flex items-center justify-center mx-auto">
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
              <p className="text-base font-bold m-0 mt-3">Build your mastery map</p>
              <p className="text-xs text-text-1 leading-[1.5] m-0 mt-1.5">
                Solve puzzles and each pattern fills in with your accuracy over time.
              </p>
            </div>
          )}

          <ul className="list-none m-0 p-0 flex flex-col gap-2">
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
              // `mastery-row`/`--weak` stay literal — practicePage.css's
              // compound-selector cascade (see its header comment) and
              // PracticePage.test.tsx's `toHaveClass('mastery-row')`.
              const rowClassName =
                state === 'weak'
                  ? 'mastery-row mastery-row--weak flex flex-col gap-2 min-h-11 w-full py-2.5 px-4 rounded-md border border-transparent bg-surface-0'
                  : 'mastery-row flex flex-col gap-2 min-h-11 w-full py-2.5 px-4 rounded-md border border-transparent bg-surface-0'

              const rowContent = (
                <>
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex-1 text-text-0 text-base">
                      {PATTERN_LABELS[row.pattern]}
                      {state === 'weak' && (
                        <span className="text-xs font-bold text-danger"> · weak</span>
                      )}
                    </span>
                    <span
                      className={`flex-none font-mono text-xs font-bold tabular-nums ${accuracyClass(state)}`}
                    >
                      {accuracyText}
                    </span>
                  </div>
                  <div className="h-[5px] rounded-[3px] bg-surface-2 overflow-hidden">
                    <div
                      className={`h-full rounded-[3px] ${fillClass(state)}`}
                      style={{ width: `${String(fillPct)}%` }}
                    />
                  </div>
                  {/* `mastery-row__count` stays literal — PracticePage.test.tsx
                      sums `.mastery-row__count` text across all rows. */}
                  <span className="mastery-row__count text-text-1 text-xs">{countText}</span>
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
