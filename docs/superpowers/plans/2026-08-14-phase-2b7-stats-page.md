# v3 Phase 2b.7 — Stats Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new `/stats` page — reachable via a Home card — that turns the existing local attempt history into five "worth checking out" views: a windowed rating-history graph, a weakest-pattern callout, a per-pattern accuracy heatmap, a GitHub-style activity calendar, and a lifetime-totals stat row. Retire `MasteryView` (its per-pattern list is fully absorbed into the new heatmap).

**Architecture:** New `src/app/stats/` folder (matches the existing one-folder-per-mode convention: `daily/`, `practice/`, `rush/`, etc.) holding pure derived-data functions (`statsData.ts`, no React) and the page component (`StatsPage.tsx`), lazy-routed at `/stats` the same way every other mode is registered in `App.tsx`. Zero new persisted fields — every number on the page is computed from the existing `Attempt` log (already fetched via `listAttempts()`) plus `UserProfile.streak.longestStreak` (already persisted). `MasteryView.tsx`'s per-pattern accuracy logic (`mastery.ts`'s `computeMastery`) is reused unchanged, not reimplemented — only its _rendering_ (a list) is replaced (a grid, on the new page) and its two host call sites (`PracticePage.tsx`'s desktop sidebar + mobile "Mastery" view, `DailyPage.tsx`'s desktop sidebar) shrink to a compact teaser linking out to `/stats`.

**Tech Stack:** React, Tailwind v4 utility classes (no new CSS file, matching this repo's post-2b.0 convention), inline SVG for the rating-history line (no charting library — this repo has none, and one series doesn't warrant adding one), Vitest + Testing Library (tests).

**Spec:** `docs/superpowers/plans/2026-08-14-phase-2b7-stats-page-design.md` — the plan below implements every locked decision in that doc; read it first for the _why_ behind each call here.

## Global Constraints

- `pnpm validate` (typecheck + lint + test + validate:content + build) must stay green after every task.
- No hardcoded hex/rgb color values — every color is an existing Tailwind color utility already aliased onto `src/index.css`'s tokens (`bg-accent-dim`, `text-danger`, etc.), same rule 2b.1 established and every phase since has held to.
- No new `UserProfile` schema field, no `CURRENT_SCHEMA_VERSION` bump, no migration — this phase is entirely read-side (design doc's "Why no new persisted data").
- Pattern heatmap and weakest-pattern callout use `computeMastery()` from `src/app/practice/mastery.ts` as-is — do not duplicate its accuracy math.
- Chart/grid colors reuse the existing four-bucket status language (`mastered`/`learning`/`weak`/`new` → accent/warn/danger/neutral) that `MasteryView.tsx`/`PatternPicker.tsx` already use — no new sequential color ramp (design doc's "Chart/visual treatment" section).
- **Scoped-down from the design doc's "hover crosshair + tooltip" ideal**: the rating-graph's per-point interaction is a native SVG `<title>` tooltip on each point (accessible, zero extra state), not a synced crosshair + floating tooltip layer. Flagging this explicitly as a deliberate scope cut for a single-series line on a first version, not a silent omission — revisit if the graph gets a second series or Thomas asks for richer hover behavior later.

---

## Task 1: `statsData.ts` — pure derived-data functions

**Files:**

- Create: `src/app/stats/statsData.ts`
- Test: `src/app/stats/statsData.test.ts`

**Interfaces:**

- Produces: `RatingHistoryPoint { date: string; rating: number }`, `RatingWindowDays = 7 | 30 | null`, `getRatingHistory(attempts: readonly Attempt[], windowDays: RatingWindowDays, nowIso: string): RatingHistoryPoint[]`, `ActivityDay { date: string; active: boolean }`, `ACTIVITY_CALENDAR_WEEKS = 12`, `getActivityCalendar(attempts: readonly Attempt[], nowIso: string): ActivityDay[]`, `LifetimeTotals { solved: number; bestStreak: number; totalTimeMs: number; modesPlayed: number }`, `getLifetimeTotals(attempts: readonly Attempt[], profile: UserProfile): LifetimeTotals`. Task 2/3/4 (`StatsPage.tsx`) are the consumers.

- [ ] **Step 1: Write the failing tests**

Create `src/app/stats/statsData.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  getRatingHistory,
  getActivityCalendar,
  getLifetimeTotals,
  ACTIVITY_CALENDAR_WEEKS,
} from './statsData'
import type { Attempt, UserProfile } from '../../storage'

const NOW_ISO = '2026-08-14T12:00:00.000Z'

function attempt(overrides: Partial<Attempt> & Pick<Attempt, 'id' | 'localDateString'>): Attempt {
  return {
    puzzleId: `puzzle-${overrides.id}`,
    puzzleRating: 1200,
    mode: 'practice',
    correct: true,
    time_ms: 4000,
    choice_index: null,
    checkpoint_results: null,
    userRatingBefore: 1200,
    userRatingAfter: 1210,
    createdAt: `${overrides.localDateString}T10:00:00.000Z`,
    ...overrides,
  }
}

function profile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    schema_version: 9,
    rating: 1250,
    ratedAttemptCount: 40,
    streak: { currentStreak: 3, longestStreak: 12, lastActiveDate: '2026-08-14' },
    requeueState: [],
    storagePersisted: null,
    dailyCompletion: null,
    rushStats: null,
    bestRunStreak: 0,
    bossStats: null,
    missionProgress: null,
    missionStats: null,
    anonId: 'test-anon-id',
    ...overrides,
  }
}

describe('getRatingHistory', () => {
  it('returns no points when there are no attempts', () => {
    expect(getRatingHistory([], null, NOW_ISO)).toEqual([])
  })

  it("collapses same-day attempts to that day's last userRatingAfter", () => {
    const attempts = [
      attempt({ id: '1', localDateString: '2026-08-10', userRatingAfter: 1205 }),
      attempt({ id: '2', localDateString: '2026-08-10', userRatingAfter: 1198 }),
      attempt({ id: '3', localDateString: '2026-08-10', userRatingAfter: 1212 }),
    ]
    expect(getRatingHistory(attempts, null, NOW_ISO)).toEqual([
      { date: '2026-08-10', rating: 1212 },
    ])
  })

  it('returns one point per day, sorted ascending by date', () => {
    const attempts = [
      attempt({ id: '1', localDateString: '2026-08-12', userRatingAfter: 1220 }),
      attempt({ id: '2', localDateString: '2026-08-10', userRatingAfter: 1205 }),
      attempt({ id: '3', localDateString: '2026-08-11', userRatingAfter: 1215 }),
    ]
    expect(getRatingHistory(attempts, null, NOW_ISO)).toEqual([
      { date: '2026-08-10', rating: 1205 },
      { date: '2026-08-11', rating: 1215 },
      { date: '2026-08-12', rating: 1220 },
    ])
  })

  it('a 7-day window excludes points older than 7 days before nowIso', () => {
    const attempts = [
      attempt({ id: '1', localDateString: '2026-08-06', userRatingAfter: 1190 }),
      attempt({ id: '2', localDateString: '2026-08-08', userRatingAfter: 1200 }),
    ]
    expect(getRatingHistory(attempts, 7, NOW_ISO)).toEqual([{ date: '2026-08-08', rating: 1200 }])
  })

  it('a null window returns all-time history, unfiltered', () => {
    const attempts = [attempt({ id: '1', localDateString: '2025-01-01', userRatingAfter: 1000 })]
    expect(getRatingHistory(attempts, null, NOW_ISO)).toEqual([
      { date: '2025-01-01', rating: 1000 },
    ])
  })
})

describe('getActivityCalendar', () => {
  it(`returns exactly ${String(ACTIVITY_CALENDAR_WEEKS * 7)} days ending on nowIso's local date`, () => {
    const days = getActivityCalendar([], NOW_ISO)
    expect(days).toHaveLength(ACTIVITY_CALENDAR_WEEKS * 7)
    expect(days[days.length - 1]).toEqual({ date: '2026-08-14', active: false })
  })

  it('marks a day active when an attempt shares its localDateString, others stay inactive', () => {
    const days = getActivityCalendar([attempt({ id: '1', localDateString: '2026-08-12' })], NOW_ISO)
    expect(days.find((d) => d.date === '2026-08-12')?.active).toBe(true)
    expect(days.find((d) => d.date === '2026-08-11')?.active).toBe(false)
  })
})

describe('getLifetimeTotals', () => {
  it('returns all zeros for a fresh profile with no attempts', () => {
    const fresh = profile({ streak: { currentStreak: 0, longestStreak: 0, lastActiveDate: null } })
    expect(getLifetimeTotals([], fresh)).toEqual({
      solved: 0,
      bestStreak: 0,
      totalTimeMs: 0,
      modesPlayed: 0,
    })
  })

  it('sums solved count and total time, counts distinct modes, reads bestStreak from the profile', () => {
    const attempts = [
      attempt({ id: '1', localDateString: '2026-08-10', mode: 'practice', time_ms: 3000 }),
      attempt({ id: '2', localDateString: '2026-08-11', mode: 'daily', time_ms: 5000 }),
      attempt({ id: '3', localDateString: '2026-08-12', mode: 'practice', time_ms: 4000 }),
    ]
    expect(getLifetimeTotals(attempts, profile())).toEqual({
      solved: 3,
      bestStreak: 12,
      totalTimeMs: 12000,
      modesPlayed: 2,
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/app/stats/statsData.test.ts`
Expected: FAIL — `Cannot find module './statsData'` (file doesn't exist yet).

- [ ] **Step 3: Write the implementation**

Create `src/app/stats/statsData.ts`:

```ts
/**
 * Stats page (v3 Phase 2b.7): pure derived-data functions over the existing
 * Attempt log + UserProfile — no new persisted fields, same "derive, don't
 * store" approach `../homeActivity.ts` already established for Home's
 * recent-activity/rating-trend summaries. Kept in its own module (not
 * homeActivity.ts) since these shapes are Stats-page-specific.
 *
 * `dateString` duplicates Home.tsx's/usePracticeSession.ts's own local
 * helper of the same shape verbatim (local calendar date, not UTC) rather
 * than extracting a shared util — matches this repo's established
 * convention of small per-consumer date helpers (useDailySession.ts,
 * useRushSession.ts, useBossSession.ts, useTraceSession.ts each keep their
 * own copy too).
 */
import type { Attempt, UserProfile } from '../../storage'

function dateString(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(year)}-${month}-${day}`
}

export interface RatingHistoryPoint {
  date: string
  rating: number
}

/** 7 or 30 trailing days, or `null` for all-time — the Stats page's window toggle. */
export type RatingWindowDays = 7 | 30 | null

/**
 * One point per calendar day with >=1 attempt: that day's *last* recorded
 * `userRatingAfter` (a "daily close"), not one point per attempt — keeps the
 * line readable after hundreds of solves. `attempts` must already be in
 * chronological (oldest-first) order, matching `listAttempts()`'s contract
 * (the same assumption `mastery.ts`'s `computeMastery` makes) — this
 * function does not re-sort its input. Returned points are sorted ascending
 * by date.
 */
export function getRatingHistory(
  attempts: readonly Attempt[],
  windowDays: RatingWindowDays,
  nowIso: string,
): RatingHistoryPoint[] {
  const dailyClose = new Map<string, number>()
  for (const a of attempts) {
    dailyClose.set(a.localDateString, a.userRatingAfter)
  }

  const cutoff =
    windowDays === null ? null : new Date(nowIso).getTime() - windowDays * 24 * 60 * 60 * 1000

  return Array.from(dailyClose.entries())
    .map(([date, rating]) => ({ date, rating }))
    .filter((point) => cutoff === null || new Date(point.date).getTime() >= cutoff)
    .sort((a, b) => a.date.localeCompare(b.date))
}

export interface ActivityDay {
  date: string
  active: boolean
}

/** Trailing weeks shown in the activity calendar (12 * 7 = 84 days, ending today). */
export const ACTIVITY_CALENDAR_WEEKS = 12

/**
 * Exactly `ACTIVITY_CALENDAR_WEEKS * 7` entries, oldest first, ending on
 * `nowIso`'s local calendar date. `active` is true when >=1 attempt shares
 * that day's `localDateString`.
 */
export function getActivityCalendar(attempts: readonly Attempt[], nowIso: string): ActivityDay[] {
  const activeDates = new Set(attempts.map((a) => a.localDateString))
  const totalDays = ACTIVITY_CALENDAR_WEEKS * 7
  const now = new Date(nowIso)

  const days: ActivityDay[] = []
  for (let i = totalDays - 1; i >= 0; i -= 1) {
    const day = new Date(now)
    day.setDate(day.getDate() - i)
    const date = dateString(day)
    days.push({ date, active: activeDates.has(date) })
  }
  return days
}

export interface LifetimeTotals {
  solved: number
  bestStreak: number
  totalTimeMs: number
  modesPlayed: number
}

/**
 * `bestStreak` reads `profile.streak.longestStreak` directly — already
 * persisted, not re-derived from attempts.
 */
export function getLifetimeTotals(
  attempts: readonly Attempt[],
  profile: UserProfile,
): LifetimeTotals {
  return {
    solved: attempts.length,
    bestStreak: profile.streak.longestStreak,
    totalTimeMs: attempts.reduce((sum, a) => sum + a.time_ms, 0),
    modesPlayed: new Set(attempts.map((a) => a.mode)).size,
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/app/stats/statsData.test.ts`
Expected: PASS, all 8 tests.

- [ ] **Step 5: Commit**

```bash
git add src/app/stats/statsData.ts src/app/stats/statsData.test.ts
git commit -m "v3 Phase 2b.7: add statsData.ts (rating history, activity calendar, lifetime totals)"
```

---

## Task 2: `StatsPage` skeleton — hero, rating graph, window toggle, route + Home entry

**Files:**

- Create: `src/app/stats/StatsPage.tsx`
- Create: `src/app/stats/StatsPage.test.tsx`
- Modify: `src/app/routes.ts`
- Modify: `src/app/App.tsx`
- Modify: `src/app/Icons.tsx`
- Modify: `src/app/Home.tsx`
- Modify: `src/app/Home.test.tsx`

**Interfaces:**

- Consumes: `getRatingHistory`, `RatingWindowDays` (Task 1); `listAttempts`, `loadProfile` from `../../storage`.
- Produces: `export function StatsPage()` — default export target for the lazy route. Tasks 3/4 extend this same file/component with more sections.

- [ ] **Step 1: Write the failing tests**

Create `src/app/stats/StatsPage.test.tsx`:

```tsx
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StatsPage } from './StatsPage'
import { loadProfile, listAttempts } from '../../storage'
import type { UserProfile, Attempt } from '../../storage'

vi.mock('../../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../storage')>()
  return { ...actual, loadProfile: vi.fn(), listAttempts: vi.fn() }
})

function attempt(overrides: Partial<Attempt> & Pick<Attempt, 'id' | 'localDateString'>): Attempt {
  return {
    puzzleId: `puzzle-${overrides.id}`,
    puzzleRating: 1200,
    mode: 'practice',
    correct: true,
    time_ms: 4000,
    choice_index: null,
    checkpoint_results: null,
    userRatingBefore: 1200,
    userRatingAfter: 1210,
    createdAt: `${overrides.localDateString}T10:00:00.000Z`,
    ...overrides,
  }
}

function baseProfile(): UserProfile {
  return {
    schema_version: 9,
    rating: 1487,
    ratedAttemptCount: 40,
    streak: { currentStreak: 12, longestStreak: 23, lastActiveDate: '2026-08-14' },
    requeueState: [],
    storagePersisted: null,
    dailyCompletion: null,
    rushStats: null,
    bestRunStreak: 0,
    bossStats: null,
    missionProgress: null,
    missionStats: null,
    anonId: 'test-anon-id',
  }
}

describe('StatsPage', () => {
  beforeEach(() => {
    vi.mocked(loadProfile).mockReset()
    vi.mocked(listAttempts).mockReset()
    vi.mocked(listAttempts).mockResolvedValue([])
  })

  it('shows a loading state before the profile resolves', () => {
    vi.mocked(loadProfile).mockReturnValue(new Promise(() => {}))
    render(<StatsPage />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('shows the current rating once loaded', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    render(<StatsPage />)
    await waitFor(() => {
      expect(screen.getByText('1487')).toBeInTheDocument()
    })
  })

  it('defaults the rating-graph window to 7 days and switches on toggle click', async () => {
    vi.mocked(loadProfile).mockResolvedValue(baseProfile())
    vi.mocked(listAttempts).mockResolvedValue([
      attempt({ id: '1', localDateString: '2026-08-01', userRatingAfter: 1400 }),
      attempt({ id: '2', localDateString: '2026-08-13', userRatingAfter: 1487 }),
    ])
    const user = userEvent.setup()
    render(<StatsPage />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'true')
    })
    // The 2026-08-01 point falls outside a 7-day window (nowIso is real
    // Date.now() here, so this only asserts the toggle's own pressed state
    // changes — point-count assertions against a live clock live in
    // statsData.test.ts, which injects nowIso explicitly).
    await user.click(screen.getByRole('button', { name: 'All' }))
    expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '7d' })).toHaveAttribute('aria-pressed', 'false')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/app/stats/StatsPage.test.tsx`
Expected: FAIL — `Cannot find module './StatsPage'`.

- [ ] **Step 3: Add the `StatsIcon`**

In `src/app/Icons.tsx`, add after `CopyIcon` (end of file):

```tsx
// Authored fresh for Stats (v3 Phase 2b.7): a simple ascending bar chart —
// reads as "progress/analytics" at a glance, distinct from RatingIcon
// (a trophy/cup shape, already used for the rating pill elsewhere) so the
// two aren't confused on the same Home screen.
export function StatsIcon({ size = 20 }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="4" y1="20" x2="20" y2="20" />
      <rect x="6" y="14" width="3" height="6" />
      <rect x="11" y="9" width="3" height="11" />
      <rect x="16" y="4" width="3" height="16" />
    </svg>
  )
}
```

- [ ] **Step 4: Write `StatsPage.tsx`**

Create `src/app/stats/StatsPage.tsx`:

```tsx
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
```

- [ ] **Step 5: Wire the `/stats` route**

In `src/app/routes.ts`, add to the `ROUTES` object (after `missions`, before `legal`):

```ts
  stats: { path: '/stats', label: 'Stats' },
```

Add to `ROUTE_META` (after the `/missions` entry):

```ts
  '/stats': {
    title: 'Stats — Codoro',
    description: 'Your rating history, pattern accuracy, and activity — all in one place.',
  },
```

In `src/app/App.tsx`, add the importer + lazy component (alongside the existing ones, after `missionsImporter`/`MissionsPage`):

```ts
const statsImporter = () => import('./stats/StatsPage')
```

```ts
const StatsPage = lazy(async () => ({ default: (await statsImporter()).StatsPage }))
```

Add the route (after the `/missions` `<Route>`):

```tsx
<Route path="/stats">
  <StatsPage />
</Route>
```

- [ ] **Step 6: Add the Home card**

In `src/app/Home.tsx`, add `StatsIcon` to the import from `./Icons`:

```tsx
import {
  BossIcon,
  DailyIcon,
  MissionIcon,
  PracticeIcon,
  RushIcon,
  StatsIcon,
  StreakIcon,
  TraceIcon,
} from './Icons'
```

Add the new card to the secondary-cards grid (after the Missions `<Link>`, still inside the same grid `<div>`):

```tsx
<Link href={ROUTES.stats.path} className={CARD_SECONDARY}>
  <span className={ICON_SECONDARY}>
    <StatsIcon size={20} />
  </span>
  <span className={TITLE_SECONDARY}>Stats</span>
  <span className="text-sm text-inherit opacity-85">Rating history and pattern accuracy</span>
</Link>
```

Update the grid's own sizing comment and floor value — currently:

```tsx
      {/* 2b.0: was `.home__cards-secondary` — grid only kicks in >=640px
       * (Tailwind `sm`, exact match), auto-fit/minmax(75px,1fr) so
       * Daily/Rush/Trace/Boss/Missions (5 same-tier cards) share one row
       * evenly instead of a fixed 2-column split. The 75px floor is tuned
       * to this card's own container: 480px (--content-width-mobile) minus
       * 2x16px (px-4) padding = 448px, minus 4x12px (gap-3) column gaps =
       * 400px for 5 tracks, i.e. 80px/track — 75px leaves ~25px slack for
       * rounding. Re-derive this number if a 6th mode card is ever added;
       * at >=1024px (--content-width-desktop, 608px available) 5 tracks
       * still fit and grow evenly via `1fr` regardless of this floor. */}
      <div className="flex flex-col gap-3 sm:grid sm:grid-cols-[repeat(auto-fit,minmax(75px,1fr))]">
```

Replace with (6 tracks now that Stats joined the row — floor re-derived per that same comment's own instruction):

```tsx
      {/* 2b.0: was `.home__cards-secondary` — grid only kicks in >=640px
       * (Tailwind `sm`, exact match), auto-fit/minmax(60px,1fr) so
       * Daily/Rush/Trace/Boss/Missions/Stats (6 same-tier cards, 2b.7 added
       * Stats) share one row evenly instead of a fixed 2-column split. The
       * 60px floor is tuned to this card's own container: 480px
       * (--content-width-mobile) minus 2x16px (px-4) padding = 448px, minus
       * 5x12px (gap-3) column gaps = 388px for 6 tracks, i.e. ~64.7px/track
       * — 60px leaves ~28px slack for rounding (same convention the
       * original 5-track 75px floor used). Re-derive this number again if a
       * 7th mode card is ever added; at >=1024px (--content-width-desktop,
       * 608px available) 6 tracks still fit and grow evenly via `1fr`
       * regardless of this floor. */}
      <div className="flex flex-col gap-3 sm:grid sm:grid-cols-[repeat(auto-fit,minmax(60px,1fr))]">
```

- [ ] **Step 7: Add a Home test for the new card**

In `src/app/Home.test.tsx`, add (inside the existing `describe('Home', ...)` block):

```tsx
it('links to /stats via a Stats card', async () => {
  vi.mocked(loadProfile).mockResolvedValue(baseProfile())
  render(<Home />)
  const link = await screen.findByRole('link', { name: /stats/i })
  expect(link).toHaveAttribute('href', '/stats')
})
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `pnpm vitest run src/app/stats/StatsPage.test.tsx src/app/Home.test.tsx`
Expected: PASS, all tests including the new ones.

- [ ] **Step 9: Run the full suite (regression check)**

Run: `pnpm vitest run`
Expected: PASS, same or higher test count, no regressions.

- [ ] **Step 10: Commit**

```bash
git add src/app/stats/StatsPage.tsx src/app/stats/StatsPage.test.tsx src/app/routes.ts src/app/App.tsx src/app/Icons.tsx src/app/Home.tsx src/app/Home.test.tsx
git commit -m "v3 Phase 2b.7: add /stats route — hero rating stat + windowed rating graph"
```

---

## Task 3: Weakest-pattern callout + per-pattern accuracy heatmap

**Files:**

- Modify: `src/app/stats/StatsPage.tsx`
- Modify: `src/app/stats/StatsPage.test.tsx`

**Interfaces:**

- Consumes: `computeMastery`, `MIN_ATTEMPTS_FOR_MASTERY` from `../practice/mastery`; `PATTERN_SLUGS`, `PATTERN_LABELS` from `../../content`.
- Produces: nothing new for later tasks — this task's output is presentation only, appended to the same `StatsPage` component.

- [ ] **Step 1: Write the failing tests**

Add to `src/app/stats/StatsPage.test.tsx` (inside the existing `describe('StatsPage', ...)` block):

```tsx
it('shows no weakest-pattern callout when no pattern has enough data yet', async () => {
  vi.mocked(loadProfile).mockResolvedValue(baseProfile())
  render(<StatsPage />)
  await waitFor(() => {
    expect(screen.getByText('1487')).toBeInTheDocument()
  })
  expect(screen.queryByText(/practice this next/i)).not.toBeInTheDocument()
})

it('names the lowest-accuracy pattern with enough data in the weakest-pattern callout, and links its heatmap cell to practice that pattern', async () => {
  vi.mocked(loadProfile).mockResolvedValue(baseProfile())
  const strongAttempts = Array.from({ length: 5 }, (_, i) =>
    attempt({
      id: `strong-${String(i)}`,
      localDateString: '2026-08-10',
      puzzleId: 'off-by-one-puzzle',
      correct: true,
    }),
  )
  const weakAttempts = Array.from({ length: 5 }, (_, i) =>
    attempt({
      id: `weak-${String(i)}`,
      localDateString: '2026-08-10',
      puzzleId: 'concurrency-puzzle',
      correct: i < 1,
    }),
  )
  vi.mocked(listAttempts).mockResolvedValue([...strongAttempts, ...weakAttempts])
  render(<StatsPage />)

  await waitFor(() => {
    expect(screen.getByText(/practice this next/i)).toBeInTheDocument()
  })
  expect(screen.getByText(/concurrency/i)).toBeInTheDocument()

  const cell = screen.getByRole('link', { name: /concurrency/i })
  expect(cell).toHaveAttribute('href', '/practice?pattern=concurrency')
})
```

Note: this test relies on `puzzlePool` (imported by `computeMastery`'s caller) resolving `puzzleId`s `'off-by-one-puzzle'`/`'concurrency-puzzle'` to their patterns — **before writing the implementation**, grep `src/content` for how `MasteryView.test.tsx`/`PatternPicker.test.tsx` mock or stub pattern resolution for their own tests (they solve the identical problem) and mirror whichever approach they use, rather than inventing a third.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/app/stats/StatsPage.test.tsx`
Expected: FAIL — no weakest-pattern callout or heatmap rendered yet.

- [ ] **Step 3: Extend the implementation**

In `src/app/stats/StatsPage.tsx`, add imports (alongside the existing ones):

```tsx
import { Link } from 'wouter'
import { computeMastery, MIN_ATTEMPTS_FOR_MASTERY } from '../practice/mastery'
import type { PatternMastery } from '../practice/mastery'
import { PATTERN_LABELS, puzzlePool } from '../../content'
```

Add these helpers above `export function StatsPage()` (mirrors `MasteryView.tsx`'s own `masteryState` bucketing verbatim — see that file's comment on why this isn't extracted to a shared module yet; a third local copy is consistent with the existing MasteryView/PatternPicker precedent, not a new problem):

```tsx
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
```

Inside `StatsPage`, after computing `historyPoints`/`graphPoints`, add:

```tsx
const masteryRows = computeMastery(attempts, puzzlePool)
const weakest = masteryRows
  .filter((row) => row.accuracy !== null)
  .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0))[0]
```

Add JSX after the rating-graph card's closing `</div>` and before the component's final `</div>`:

```tsx
{
  weakest && (
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
          {PATTERN_LABELS[weakest.pattern]} · {Math.round((weakest.accuracy ?? 0) * 100)}% accuracy
        </span>
      </span>
    </Link>
  )
}

;<div className="flex flex-col gap-2 p-4 rounded-md border border-border bg-surface-1">
  <p className="m-0 text-base font-bold">Mastery by pattern</p>
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/app/stats/StatsPage.test.tsx`
Expected: PASS, all tests including the two new ones.

- [ ] **Step 5: Run the full suite**

Run: `pnpm vitest run`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/app/stats/StatsPage.tsx src/app/stats/StatsPage.test.tsx
git commit -m "v3 Phase 2b.7: add weakest-pattern callout + per-pattern accuracy heatmap"
```

---

## Task 4: Activity calendar + lifetime totals

**Files:**

- Modify: `src/app/stats/StatsPage.tsx`
- Modify: `src/app/stats/StatsPage.test.tsx`

**Interfaces:**

- Consumes: `getActivityCalendar`, `getLifetimeTotals` (Task 1).
- Produces: nothing new for later tasks — this completes `StatsPage`'s content.

- [ ] **Step 1: Write the failing tests**

Add to `src/app/stats/StatsPage.test.tsx`:

```tsx
it('shows the activity calendar and lifetime totals once loaded', async () => {
  vi.mocked(loadProfile).mockResolvedValue(baseProfile())
  vi.mocked(listAttempts).mockResolvedValue([
    attempt({ id: '1', localDateString: '2026-08-10', mode: 'practice', time_ms: 3000 }),
    attempt({ id: '2', localDateString: '2026-08-11', mode: 'daily', time_ms: 5000 }),
  ])
  render(<StatsPage />)

  await waitFor(() => {
    expect(screen.getByText('2')).toBeInTheDocument() // solved count
  })
  expect(screen.getByText('23')).toBeInTheDocument() // bestStreak, from baseProfile's longestStreak
  expect(screen.getByLabelText(/activity calendar/i)).toBeInTheDocument()
})

it('shows real zeros, not a hidden section, for a brand-new profile with no attempts', async () => {
  vi.mocked(loadProfile).mockResolvedValue(baseProfile())
  render(<StatsPage />)
  await waitFor(() => {
    expect(screen.getByText('1487')).toBeInTheDocument()
  })
  expect(screen.getAllByText('0').length).toBeGreaterThan(0)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/app/stats/StatsPage.test.tsx`
Expected: FAIL — no calendar or totals rendered yet.

- [ ] **Step 3: Extend the implementation**

In `src/app/stats/StatsPage.tsx`, add to the existing import from `./statsData`:

```tsx
import { getRatingHistory, getActivityCalendar, getLifetimeTotals } from './statsData'
import type { RatingWindowDays, RatingHistoryPoint, ActivityDay } from './statsData'
```

After the `weakest`/`masteryRows` computation, add:

```tsx
const activityDays = getActivityCalendar(attempts, nowIso)
const totals = getLifetimeTotals(attempts, profile)
```

Add a small cell-color helper alongside `heatCellClass`:

```tsx
function activityCellClass(active: boolean): string {
  return active
    ? 'aspect-square rounded-[2px] bg-accent'
    : 'aspect-square rounded-[2px] bg-surface-2'
}
```

**Desktop 2-column exception** (design doc: "the pattern heatmap and activity calendar — both roughly square grids — sit side by side in a 2-column row once there's room, since nothing about either needs full width"): wrap the pattern-heatmap card Task 3 already added together with the new activity card in a responsive grid, rather than stacking them full-width at every breakpoint.

Find the heatmap card Task 3 added (its opening line is unique in this file):

```tsx
      <div className="flex flex-col gap-2 p-4 rounded-md border border-border bg-surface-1">
        <p className="m-0 text-base font-bold">Mastery by pattern</p>
```

Wrap it (and the new activity card right after it) in a `lg:grid lg:grid-cols-2` container — replace that heatmap opening line with:

```tsx
      <div className="flex flex-col gap-3 lg:grid lg:grid-cols-2 lg:gap-4">
      <div className="flex flex-col gap-2 p-4 rounded-md border border-border bg-surface-1">
        <p className="m-0 text-base font-bold">Mastery by pattern</p>
```

Add the activity card right after the heatmap card's closing `</div>` (before the wrapper's own closing `</div>`, which comes right after), then close the wrapper:

```tsx
      <div className="flex flex-col gap-2 p-4 rounded-md border border-border bg-surface-1">
        <div className="flex items-center justify-between gap-2">
          <p className="m-0 text-base font-bold">Activity</p>
          <span className="font-mono text-xs font-bold text-warn">
            🔥 {profile.streak.currentStreak} day streak
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
```

(Formatting/indentation will be off after this manual splice — run `pnpm prettier --write src/app/stats/StatsPage.tsx` before the next test run, same as this repo's own lint-staged commit hook already does automatically on commit.)

Add the lifetime-totals row after the wrapper's closing `</div>`, before the component's final `</div>`:

```tsx
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
```

Note: the activity grid's `role="img"` treats the 84 individual day cells as decorative (no per-cell accessible name beyond the `title` tooltip) — the calendar's _meaning_ ("12 weeks of activity") is carried by the group's own `aria-label`, matching how a sparkline or icon-only chart is conventionally exposed, not 84 individually-announced cells.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/app/stats/StatsPage.test.tsx`
Expected: PASS, all tests.

- [ ] **Step 5: Run the full suite**

Run: `pnpm vitest run`
Expected: PASS, no regressions.

- [ ] **Step 6: Commit**

```bash
git add src/app/stats/StatsPage.tsx src/app/stats/StatsPage.test.tsx
git commit -m "v3 Phase 2b.7: add activity calendar + lifetime totals — StatsPage content complete"
```

---

## Task 5: Retire `MasteryView` from `PracticePage.tsx`

**Files:**

- Modify: `src/app/practice/PracticePage.tsx`
- Modify: `src/app/practice/PracticePage.test.tsx`

**Interfaces:**

- Consumes: `computeMastery`, `MIN_ATTEMPTS_FOR_MASTERY` from `./mastery` (already used by `MasteryView`, now used directly here too).
- Produces: nothing new for later tasks.

- [ ] **Step 1: Read the existing `MasteryView`-dependent tests before changing anything**

Run: `grep -n "Mastery\|mastery-row" src/app/practice/PracticePage.test.tsx`

Expected (confirmed this session): a mount/attempt-refetch test asserting `.mastery-row__count` sums, a "clicking a mastery row starts practicing that pattern" test, a "shows 'Mastery by pattern' heading" test, and two desktop-picker tests asserting the sidebar returns to "Mastery by pattern" text after Browse closes. **Every one of these must be rewritten in Step 3 below to match the teaser's new markup** — do not leave any assertion pointing at removed elements.

- [ ] **Step 2: Write the new/updated failing tests**

Replace the tests found in Step 1 (their exact line ranges depend on the live file — locate by the text quoted above) with:

```tsx
it('desktop sidebar shows a weakest-pattern teaser (not the full mastery list) linking to /stats', async () => {
  stubDesktop()
  const user = userEvent.setup()
  render(<PracticePage />)
  await waitFor(() => {
    expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
  })

  expect(screen.queryByText('Mastery by pattern')).not.toBeInTheDocument()
  const link = screen.getByRole('link', { name: /view full stats/i })
  expect(link).toHaveAttribute('href', '/stats')

  vi.unstubAllGlobals()
})

it('mobile "Mastery" nav view shows the same teaser and a link to /stats', async () => {
  const user = userEvent.setup()
  render(<PracticePage />)
  await waitFor(() => {
    expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
  })

  await user.click(screen.getByRole('button', { name: 'Mastery' }))

  const link = await screen.findByRole('link', { name: /view full stats/i })
  expect(link).toHaveAttribute('href', '/stats')

  await user.click(screen.getByRole('button', { name: /back/i }))
  expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
})
```

(`stubDesktop`/the desktop-picker `describe` block's own setup already exists in this file — reuse it, don't redefine it. If Step 1's grep also surfaced the two desktop-picker-returns-to-Mastery tests, update their final assertion from `expect(screen.getByText('Mastery by pattern')).toBeInTheDocument()` to `expect(screen.getByRole('link', { name: /view full stats/i })).toBeInTheDocument()` — same "sidebar is back to normal" check, new marker.)

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run src/app/practice/PracticePage.test.tsx`
Expected: FAIL — teaser doesn't exist yet, old assertions (if not yet updated) also fail.

- [ ] **Step 4: Build the teaser and swap both call sites**

In `src/app/practice/PracticePage.tsx`, replace the `import { MasteryView } from './MasteryView'` line with:

```tsx
import { Link } from 'wouter'
import { computeMastery } from './mastery'
```

(`Link` may already be imported from `'wouter'` elsewhere in this file — if so, add `Link` to that existing import instead of a second one.)

Add this component above `export function PracticePage()`:

```tsx
/**
 * 2b.7: replaces the full MasteryView list in both of this page's
 * MasteryView call sites (desktop sidebar, mobile "Mastery" nav view) — the
 * per-pattern list itself now lives on /stats. This teaser keeps ambient
 * mastery visibility mid-session (the thing that would otherwise be lost)
 * without duplicating the full list here.
 */
function MasteryTeaser({ attempts }: { attempts: Attempt[] }) {
  const rows = computeMastery(attempts, puzzlePool)
  const weakest = rows
    .filter((row) => row.accuracy !== null)
    .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0))[0]

  return (
    <div className="flex flex-col gap-2">
      {weakest ? (
        <p className="m-0 text-sm text-text-1">
          Weakest: <span className="font-bold text-text-0">{PATTERN_LABELS[weakest.pattern]}</span>{' '}
          · {Math.round((weakest.accuracy ?? 0) * 100)}%
        </p>
      ) : (
        <p className="m-0 text-sm text-text-1">Solve a few puzzles to see your weakest pattern.</p>
      )}
      <Link href="/stats" className="text-sm font-bold text-accent no-underline">
        View full stats →
      </Link>
    </div>
  )
}
```

This file already imports `Attempt`, `PATTERN_LABELS`, and `puzzlePool` (grep-confirm before adding a duplicate import — `PracticePage.tsx` already uses all three for its existing filter/session logic).

Replace the mobile `view === 'mastery'` branch — currently:

```tsx
if (view === 'mastery') {
  return (
    <div className={PAGE_SHELL_CLASS}>
      <MasteryView
        onBack={() => {
          setView('practice')
        }}
        refreshKey={session.attemptVersion}
        onSelectPattern={(pattern) => {
          session.setPatternFilter(pattern)
          setView('practice')
        }}
      />
    </div>
  )
}
```

with:

```tsx
if (view === 'mastery') {
  return (
    <div className={PAGE_SHELL_CLASS}>
      <div className="flex items-center gap-2">
        <button
          type="button"
          className={LINK_CLASS}
          onClick={() => {
            setView('practice')
          }}
        >
          ← Back
        </button>
        <h2 className="m-0 text-xl">Mastery</h2>
      </div>
      <MasteryTeaser attempts={session.attempts} />
    </div>
  )
}
```

(If `usePracticeSession`'s returned `session` object doesn't already expose the full `attempts` array under that name, grep its return type first and use whichever field name it actually exports — do not invent a new one; `session.attemptVersion` already implies the hook tracks attempts internally, so the raw list is likely already there or one line away from being exposed.)

Replace the desktop sidebar's `MasteryView` render — currently:

```tsx
<MasteryView
  refreshKey={session.attemptVersion}
  onSelectPattern={(pattern) => {
    session.setPatternFilter(pattern)
  }}
/>
```

with:

```tsx
<MasteryTeaser attempts={session.attempts} />
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/app/practice/PracticePage.test.tsx`
Expected: PASS, all tests.

- [ ] **Step 6: Run the full suite**

Run: `pnpm vitest run`
Expected: PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add src/app/practice/PracticePage.tsx src/app/practice/PracticePage.test.tsx
git commit -m "v3 Phase 2b.7: retire MasteryView from PracticePage (sidebar + mobile nav teaser)"
```

---

## Task 6: Retire `MasteryView` from `DailyPage.tsx`, delete `MasteryView`, close out the phase

**Files:**

- Modify: `src/app/daily/DailyPage.tsx`
- Modify: `src/app/daily/DailyPage.test.tsx`
- Delete: `src/app/practice/MasteryView.tsx`
- Delete: `src/app/practice/MasteryView.test.tsx`
- Modify: `docs/v3-build-plan.md`

**Interfaces:** None new — this task only removes code and updates docs.

- [ ] **Step 1: Read `DailyPage.test.tsx`'s existing `MasteryView`-dependent assertions**

Run: `grep -n "Mastery\|mastery-row" src/app/daily/DailyPage.test.tsx`

- [ ] **Step 2: Write the updated failing test**

Replace whatever Step 1 surfaces (matching however many `Mastery`-related assertions exist there) with:

```tsx
it('desktop sidebar shows a mastery teaser linking to /stats, not the full mastery list', async () => {
  stubDesktop()
  const user = userEvent.setup()
  render(<DailyPage />)
  await waitFor(() => {
    expect(screen.getByText(/prompt \d/)).toBeInTheDocument()
  })

  expect(screen.queryByText('Mastery by pattern')).not.toBeInTheDocument()
  const link = screen.getByRole('link', { name: /view full stats/i })
  expect(link).toHaveAttribute('href', '/stats')

  vi.unstubAllGlobals()
})
```

(Reuse whatever `stubDesktop`-equivalent setup this file's existing desktop tests already use — do not redefine it.)

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm vitest run src/app/daily/DailyPage.test.tsx`
Expected: FAIL.

- [ ] **Step 4: Swap the sidebar**

In `src/app/daily/DailyPage.tsx`, replace:

```tsx
import { MasteryView } from '../practice/MasteryView'
```

with:

```tsx
import { Link } from 'wouter'
import { computeMastery } from '../practice/mastery'
```

(As in Task 5 — if `Link` is already imported from `'wouter'` in this file, extend that import instead of adding a second one; same for `PATTERN_LABELS`/`puzzlePool` if already present.)

Add the identical `MasteryTeaser` component used in `PracticePage.tsx` — **do not import it cross-file** (each page owns its own copy, matching this repo's established per-file `todayDateString`/`masteryState` duplication convention rather than introducing a new shared component for two call sites):

```tsx
function MasteryTeaser({ attempts }: { attempts: Attempt[] }) {
  const rows = computeMastery(attempts, puzzlePool)
  const weakest = rows
    .filter((row) => row.accuracy !== null)
    .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0))[0]

  return (
    <div className="flex flex-col gap-2">
      {weakest ? (
        <p className="m-0 text-sm text-text-1">
          Weakest: <span className="font-bold text-text-0">{PATTERN_LABELS[weakest.pattern]}</span>{' '}
          · {Math.round((weakest.accuracy ?? 0) * 100)}%
        </p>
      ) : (
        <p className="m-0 text-sm text-text-1">Solve a few puzzles to see your weakest pattern.</p>
      )}
      <Link href="/stats" className="text-sm font-bold text-accent no-underline">
        View full stats →
      </Link>
    </div>
  )
}
```

Replace `<MasteryView refreshKey={session.attemptVersion} />` with `<MasteryTeaser attempts={session.attempts} />` (same field-name caveat as Task 5's Step 4 — verify against `useDailySession`'s actual return shape before using `session.attempts`).

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm vitest run src/app/daily/DailyPage.test.tsx`
Expected: PASS.

- [ ] **Step 6: Delete `MasteryView` once nothing references it**

Run: `grep -rn "MasteryView" src --include="*.tsx" --include="*.ts"`
Expected: no output (Tasks 5–6 already removed every consumer).

Delete `src/app/practice/MasteryView.tsx` and `src/app/practice/MasteryView.test.tsx`.

- [ ] **Step 7: Run the full suite**

Run: `pnpm vitest run`
Expected: PASS, no regressions, test count reflects the deleted `MasteryView.test.tsx` file's tests being gone and this phase's new tests being present.

- [ ] **Step 8: Run `pnpm validate`**

Run: `pnpm validate`
Expected: PASS (typecheck + lint + test + validate:content + build all green) — this also catches any remaining `MasteryView` import the grep in Step 6 might have missed (a stale reference would fail typecheck).

- [ ] **Step 9: Close out `docs/v3-build-plan.md`'s 2b.7 entry**

Replace:

```markdown
### 2b.7 — Mastery/stats page (not sized — scope decision needed first)

Fully buildable off existing local IndexedDB history, not blocked on the Phase 4 backend. **Blocking question before this gets a session**: permanent nav slot (core-loop surface) or a secondary view nested under Settings? Starter directions once scope is picked: per-pattern accuracy heatmap, rating/streak history graph, a "weakest pattern" callout.
```

with:

```markdown
### 2b.7 — Stats page (1 session)

**Build:** `/stats`, reachable via a Home card only (direct user decision, 2026-08-14 — not a NavRail/ModeSwitcher slot). Five sections, all derived from existing local attempt history, zero new persisted data: windowed (7d/30d/all) rating-history graph, a weakest-pattern callout, a per-pattern accuracy heatmap (absorbs `MasteryView`'s per-pattern list — deleted this phase), a GitHub-style activity calendar, and a lifetime-totals stat row. Design record: `docs/superpowers/plans/2026-08-14-phase-2b7-stats-page-design.md`.

**DoD:**

- [x] `/stats` is reachable from a Home card and shows rating history (7d/30d/all toggle), a per-pattern accuracy heatmap, a weakest-pattern callout, an activity calendar, and lifetime totals — all derived from existing attempt history with zero new persisted fields.
- [x] Tapping a pattern-heatmap cell (or the weakest-pattern callout) starts practicing that pattern, via the existing `/practice?pattern=<slug>` deep link.
- [x] `MasteryView` is fully retired — Practice's desktop sidebar + mobile "Mastery" view and Daily's desktop sidebar now show a compact teaser (weakest pattern + "View full stats →") instead of the full per-pattern list; `MasteryView.tsx`/`MasteryView.test.tsx` deleted.
- [x] Existing test suite green (`pnpm validate`).
```

Also remove the now-resolved bullet from the "Open design questions" list near the end of the file:

```markdown
- Mastery/stats page: nav-level surface vs. Settings-nested (2b.7) — blocks sizing that phase at all.
```

(Delete this line entirely — the question is resolved, not carried forward.)

- [ ] **Step 10: Commit**

```bash
git add src/app/daily/DailyPage.tsx src/app/daily/DailyPage.test.tsx src/app/practice/MasteryView.tsx src/app/practice/MasteryView.test.tsx docs/v3-build-plan.md
git commit -m "v3 Phase 2b.7: retire MasteryView from DailyPage, delete MasteryView, close out DoD"
```

---

## Branch

Base off `origin/main` (2b.6/#66 is merged there, per this session's starting `gitStatus`). Suggested branch name: `ui-redesign-2b7-stats-page`.
