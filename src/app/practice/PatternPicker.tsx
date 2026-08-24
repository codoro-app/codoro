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
import { PATTERN_LABELS, PATTERN_SLUGS, puzzleMeta } from '../../content'
import type { PatternSlug } from '../../content'
import { computeMastery, MIN_ATTEMPTS_FOR_MASTERY } from './mastery'
import type { PatternMastery } from './mastery'
import './practicePage.css'

export interface PatternPickerProps {
  onSelect: (pattern: PatternSlug | null) => void
  onBack: () => void
  /**
   * 2b.0: was `.practice-page__sidebar .pattern-picker__grid { grid-template-columns: 1fr }`
   * in practicePage.css — the >=1024px 2-up grid (below) assumes a
   * full-width main column; inside the fixed-width desktop sidebar there's
   * only room for one. Defaults to false (the mobile full-page takeover's
   * own 2-up grid at >=1024px, unchanged).
   */
  singleColumn?: boolean
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

// 2b.0: was `.pattern-picker__badge` (base) + `--new`/`--mastered`/
// `--learning`/`--weak` in practicePage.css.
function badgeClass(state: MasteryState): string {
  const BASE = 'flex-none font-mono text-xs font-bold rounded-full py-[3px] px-2'
  if (state === 'mastered') return `${BASE} text-accent bg-accent-dim`
  if (state === 'learning') return `${BASE} text-warn bg-warn-dim`
  if (state === 'weak') return `${BASE} text-danger`
  return `${BASE} text-text-2`
}

// 2b.0: was `.progress-track__fill--<state>` in practicePage.css.
function fillClass(state: MasteryState): string {
  if (state === 'mastered') return 'bg-accent'
  if (state === 'learning') return 'bg-warn'
  if (state === 'weak') return 'bg-danger'
  return 'bg-border-strong'
}

export function PatternPicker({ onSelect, onBack, singleColumn = false }: PatternPickerProps) {
  const [rows, setRows] = useState<PatternMastery[] | null>(null)

  const cancelledRef = useRef(false)
  useEffect(() => {
    cancelledRef.current = false
    void (async () => {
      const attempts: Attempt[] = await listAttempts()
      if (cancelledRef.current) return
      setRows(computeMastery(attempts, puzzleMeta))
    })()
    return () => {
      cancelledRef.current = true
    }
  }, [])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="min-h-11 py-2 px-3 border-0 bg-transparent text-accent text-md font-semibold cursor-pointer"
          onClick={onBack}
        >
          ← Back
        </button>
        <h2 className="m-0 text-xl">Practice by pattern</h2>
      </div>

      <button
        type="button"
        className="min-h-11 py-3 px-4 border-0 rounded-md bg-accent text-accent-ink font-bold cursor-pointer transition-[transform,opacity] duration-[0.05s] ease-out active:scale-[0.98] active:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
        onClick={() => {
          onSelect(null)
        }}
      >
        Practice all patterns
      </button>

      <div
        className={
          singleColumn
            ? 'flex flex-col gap-2'
            : 'flex flex-col gap-2 lg:grid lg:grid-cols-2 lg:gap-3'
        }
      >
        {PATTERN_SLUGS.map((slug) => {
          const row = rows?.find((candidate) => candidate.pattern === slug) ?? emptyRow(slug)
          const state = masteryState(row)
          const accuracyText =
            row.accuracy === null
              ? `Not enough data (${String(row.attemptCount)}/${String(MIN_ATTEMPTS_FOR_MASTERY)})`
              : `${String(Math.round(row.accuracy * 100))}%`
          const captionText = `${String(row.attemptCount)}/${String(MIN_ATTEMPTS_FOR_MASTERY)} · ${state}`
          const fillPct = Math.min(100, (row.attemptCount / MIN_ATTEMPTS_FOR_MASTERY) * 100)
          // Weak (accuracy < 0.4) is the only state that recolors the whole
          // card (decision #10, UI v2 Arena plan) — was `.pattern-picker__button--weak`.
          const buttonClass =
            state === 'weak'
              ? 'min-h-11 w-full py-3 px-4 rounded-md border border-danger bg-danger-dim text-text-0 text-left text-md flex flex-col gap-3 cursor-pointer'
              : 'min-h-11 w-full py-3 px-4 rounded-md border border-border bg-surface-1 text-text-0 text-left text-md flex flex-col gap-3 cursor-pointer'

          return (
            <button
              key={slug}
              type="button"
              className={buttonClass}
              onClick={() => {
                onSelect(slug)
              }}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-base text-text-0">{PATTERN_LABELS[slug]}</span>
                <span className={badgeClass(state)}>{accuracyText}</span>
              </div>
              <div className="h-[5px] rounded-[3px] bg-surface-2 overflow-hidden">
                <div
                  className={`h-full rounded-[3px] ${fillClass(state)}`}
                  style={{ width: `${String(fillPct)}%` }}
                />
              </div>
              <span className="font-mono text-xs text-text-2">{captionText}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
