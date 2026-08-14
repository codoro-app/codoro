/**
 * Stats page (v3 Phase 2b.7) — reachable via a Home card only (no
 * NavRail/ModeSwitcher slot, direct user decision). Everything on this page
 * is derived from the existing Attempt log + UserProfile; no new persisted
 * data. This task builds the hero rating stat + windowed rating-history
 * graph + window toggle; Task 3 adds the weakest-pattern callout + pattern
 * heatmap, Task 4 adds the activity calendar + lifetime totals.
 *
 * Layout A (progress-forward) per the design record:
 * docs/superpowers/plans/2026-08-14-phase-2b7-stats-page-design.md
 */
import { useEffect, useRef, useState } from 'react'
import { loadProfile, listAttempts } from '../../storage'
import type { UserProfile, Attempt } from '../../storage'
import { getRatingHistory } from './statsData'
import type { RatingWindowDays, RatingHistoryPoint } from './statsData'

const PAGE_SHELL_CLASS =
  'app-shell__main flex flex-col gap-4 w-full max-w-[var(--content-width-mobile)] lg:max-w-[var(--content-width-desktop)] mx-auto pt-[calc(var(--space-4)+env(safe-area-inset-top))] px-4 pb-4'

const WINDOW_OPTIONS: { value: RatingWindowDays; label: string }[] = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: null, label: 'All' },
]

function toggleClass(active: boolean): string {
  const BASE = 'min-h-11 py-1.5 px-3 rounded-full text-sm font-bold border cursor-pointer'
  return active
    ? `${BASE} bg-accent text-accent-ink border-accent`
    : `${BASE} bg-transparent text-text-1 border-border`
}

/**
 * Maps rating-history points onto a fixed 300x70 SVG viewBox. `padding`
 * keeps the topmost/bottommost point's circle from clipping against the
 * viewBox edge. A single point renders as a lone dot (no line to draw); an
 * empty array renders nothing (caller decides the empty-state copy).
 */
function buildGraphPoints(
  points: RatingHistoryPoint[],
  width = 300,
  height = 70,
  padding = 6,
): { x: number; y: number; rating: number; date: string }[] {
  if (points.length === 0) return []
  const ratings = points.map((p) => p.rating)
  const min = Math.min(...ratings)
  const max = Math.max(...ratings)
  const span = max - min || 1
  const usableHeight = height - padding * 2

  return points.map((p, i) => {
    const x = points.length === 1 ? width / 2 : (i / (points.length - 1)) * width
    const y = padding + usableHeight - ((p.rating - min) / span) * usableHeight
    return { x, y, rating: p.rating, date: p.date }
  })
}

export function StatsPage() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [attempts, setAttempts] = useState<Attempt[]>([])
  // Named `ratingWindow`, not `window` — the latter shadows the global
  // `window` object, a real footgun (and an ESLint no-shadow-restricted-names
  // trip) even though this component happens not to need it.
  const [ratingWindow, setRatingWindow] = useState<RatingWindowDays>(7)
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    void (async () => {
      const [loadedProfile, loadedAttempts] = await Promise.all([loadProfile(), listAttempts()])
      if (cancelledRef.current) return
      setProfile(loadedProfile)
      setAttempts(loadedAttempts)
    })()
    return () => {
      cancelledRef.current = true
    }
  }, [])

  if (profile === null) {
    return (
      <div className={PAGE_SHELL_CLASS}>
        <p className="text-center text-text-1 py-8">Loading your stats…</p>
      </div>
    )
  }

  const nowIso = new Date().toISOString()
  const historyPoints = getRatingHistory(attempts, ratingWindow, nowIso)
  const graphPoints = buildGraphPoints(historyPoints)
  const first = historyPoints[0]
  const last = historyPoints[historyPoints.length - 1]
  const delta = first && last ? Math.round(last.rating - first.rating) : null

  return (
    <div className={PAGE_SHELL_CLASS}>
      <div className="flex flex-col gap-1">
        <span className="text-sm font-bold text-text-1 uppercase tracking-[0.04em]">Rating</span>
        <span className="text-4xl font-bold text-text-0 leading-none tabular-nums">
          {Math.round(profile.rating)}
        </span>
        {delta !== null && (
          <span
            className={`text-xs font-bold font-mono ${delta >= 0 ? 'text-accent' : 'text-danger'}`}
          >
            {delta >= 0 ? '▲' : '▼'} {delta >= 0 ? '+' : ''}
            {delta}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-2 p-4 rounded-md border border-border bg-surface-1">
        <div className="flex items-center gap-2" role="group" aria-label="Rating graph window">
          {WINDOW_OPTIONS.map((opt) => (
            <button
              key={opt.label}
              type="button"
              className={toggleClass(ratingWindow === opt.value)}
              aria-pressed={ratingWindow === opt.value}
              onClick={() => {
                setRatingWindow(opt.value)
              }}
            >
              {opt.label}
            </button>
          ))}
        </div>

        {graphPoints.length === 0 ? (
          <p className="text-sm text-text-1 py-4 text-center">
            Solve a few puzzles and your rating history will show up here.
          </p>
        ) : (
          <svg
            viewBox="0 0 300 70"
            width="100%"
            height="70"
            role="img"
            aria-label="Rating over time"
          >
            {graphPoints.length > 1 && (
              <polyline
                points={graphPoints.map((p) => `${String(p.x)},${String(p.y)}`).join(' ')}
                fill="none"
                stroke="var(--accent)"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {graphPoints.map((p) => (
              <circle key={p.date} cx={p.x} cy={p.y} r="3" fill="var(--accent)">
                <title>
                  {p.date}: {p.rating}
                </title>
              </circle>
            ))}
          </svg>
        )}
      </div>
    </div>
  )
}
