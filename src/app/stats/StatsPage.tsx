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
import { Link } from 'wouter'
import { loadProfile, listAttempts } from '../../storage'
import type { UserProfile, Attempt } from '../../storage'
import { getRatingHistory, getActivityCalendar, getLifetimeTotals } from './statsData'
import type { RatingWindowDays, RatingHistoryPoint, ActivityDay } from './statsData'
import { computeMastery, MIN_ATTEMPTS_FOR_MASTERY } from '../practice/mastery'
import type { PatternMastery } from '../practice/mastery'
import { PATTERN_LABELS, puzzlePool } from '../../content'

const PAGE_SHELL_CLASS =
  'app-shell__main flex flex-col gap-4 w-full max-w-[var(--content-width-mobile)] lg:max-w-[var(--content-width-desktop)] mx-auto pt-[var(--space-4)] px-4 pb-4'

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
  // A lone point or a flat stretch (every point sharing the same rating)
  // has no variance for the min/span formula below to distribute across —
  // it would divide out to 0 for every point and pin them all to the very
  // bottom of the chart instead of reading as "flat," so it's centered
  // vertically here as an explicit special case.
  const isFlat = max === min
  const span = max - min || 1
  const usableHeight = height - padding * 2

  return points.map((p, i) => {
    const x = points.length === 1 ? width / 2 : (i / (points.length - 1)) * width
    const y = isFlat
      ? padding + usableHeight / 2
      : padding + usableHeight - ((p.rating - min) / span) * usableHeight
    return { x, y, rating: p.rating, date: p.date }
  })
}

type MasteryState = 'new' | 'mastered' | 'learning' | 'weak'

function masteryState(row: PatternMastery): MasteryState {
  if (row.accuracy === null) return 'new'
  if (row.accuracy >= 0.8) return 'mastered'
  if (row.accuracy >= 0.4) return 'learning'
  return 'weak'
}

function heatCellClass(state: MasteryState): string {
  const BASE = 'aspect-square rounded-md flex items-center justify-center no-underline'
  if (state === 'mastered') return `${BASE} bg-accent-dim`
  if (state === 'learning') return `${BASE} bg-warn-dim`
  if (state === 'weak') return `${BASE} bg-danger-dim`
  return `${BASE} bg-surface-2`
}

function activityCellClass(active: boolean): string {
  return active
    ? 'aspect-square rounded-[2px] bg-accent'
    : 'aspect-square rounded-[2px] bg-surface-2'
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

  const masteryRows = computeMastery(attempts, puzzlePool)
  const weakest = masteryRows
    .filter((row) => row.accuracy !== null)
    .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0))[0]

  const activityDays = getActivityCalendar(attempts, nowIso)
  const totals = getLifetimeTotals(attempts, profile)

  return (
    <div className={PAGE_SHELL_CLASS}>
      {attempts.length === 0 && (
        <div className="flex items-center justify-between gap-3 p-4 rounded-md border border-accent bg-accent-dim">
          <p className="m-0 text-sm text-text-0">
            You haven't solved any puzzles yet — your stats will start filling in as soon as you do.
          </p>
          <Link
            href="/practice"
            className="shrink-0 flex items-center min-h-11 py-1.5 px-3 rounded-full text-sm font-bold bg-accent text-accent-ink no-underline"
          >
            Start practicing
          </Link>
        </div>
      )}

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

      {weakest ? (
        <Link
          href={`/practice?pattern=${weakest.pattern}`}
          className="flex items-center gap-3 p-4 rounded-md border border-danger bg-danger-dim no-underline text-text-0"
        >
          <span aria-hidden="true" className="text-xl">
            🎯
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-bold">Practice this next</span>
            <span className="text-xs text-text-1">
              {PATTERN_LABELS[weakest.pattern]} · {Math.round((weakest.accuracy ?? 0) * 100)}%
              accuracy
            </span>
          </span>
        </Link>
      ) : (
        // No pattern has cleared MIN_ATTEMPTS_FOR_MASTERY yet — keep this
        // card slot occupied rather than letting the section vanish, so a
        // new user gets a next action instead of a gap in the layout.
        <Link
          href="/practice"
          className="flex items-center gap-3 p-4 rounded-md border border-border bg-surface-1 no-underline text-text-0"
        >
          <span aria-hidden="true" className="text-xl">
            🎯
          </span>
          <span className="flex flex-col gap-0.5">
            <span className="text-sm font-bold">Practice a pattern</span>
            <span className="text-xs text-text-1">
              Solve a few puzzles and your weakest pattern will show up here.
            </span>
          </span>
        </Link>
      )}

      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-4">
        <div className="flex flex-col gap-2 p-4 rounded-md border border-border bg-surface-1">
          <p className="m-0 text-base font-bold">Mastery by pattern</p>
          <p className="m-0 text-xs text-text-2">
            Gray = not enough data yet. Solve puzzles to fill this in.
          </p>
          <div className="grid grid-cols-5 gap-1.5">
            {masteryRows.map((row) => {
              const state = masteryState(row)
              return (
                <Link
                  key={row.pattern}
                  href={`/practice?pattern=${row.pattern}`}
                  className={heatCellClass(state)}
                  title={`${PATTERN_LABELS[row.pattern]}: ${
                    row.accuracy === null
                      ? `not enough data (${String(row.attemptCount)}/${String(MIN_ATTEMPTS_FOR_MASTERY)})`
                      : `${String(Math.round(row.accuracy * 100))}%`
                  }`}
                >
                  <span className="sr-only">{PATTERN_LABELS[row.pattern]}</span>
                </Link>
              )
            })}
          </div>
        </div>
        <div className="flex flex-col gap-2 p-4 rounded-md border border-border bg-surface-1">
          <div className="flex items-center justify-between gap-2">
            <p className="m-0 text-base font-bold">Activity</p>
            <span className="font-mono text-xs font-bold text-warn">
              {profile.streak.currentStreak > 0
                ? `🔥 ${String(profile.streak.currentStreak)} day streak`
                : 'Start your streak today'}
            </span>
          </div>
          <div
            className="grid grid-cols-[repeat(12,1fr)] gap-1"
            role="img"
            aria-label="Activity calendar — the last 12 weeks"
          >
            {activityDays.map((day: ActivityDay) => (
              <div key={day.date} className={activityCellClass(day.active)} title={day.date} />
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 p-4 rounded-md border border-border bg-surface-1">
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-lg font-bold tabular-nums">{totals.solved}</span>
          <span className="text-[10px] text-text-2">Solved</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-lg font-bold tabular-nums">{totals.bestStreak}</span>
          <span className="text-[10px] text-text-2">Best streak</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-lg font-bold tabular-nums">
            {Math.round(totals.totalTimeMs / 3_600_000)}h
          </span>
          <span className="text-[10px] text-text-2">Practiced</span>
        </div>
        <div className="flex flex-col gap-0.5">
          <span className="font-mono text-lg font-bold tabular-nums">{totals.modesPlayed}</span>
          <span className="text-[10px] text-text-2">Modes</span>
        </div>
      </div>
    </div>
  )
}
