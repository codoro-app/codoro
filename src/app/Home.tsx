/**
 * Home screen — reachable only via the logo (desktop rail / mobile app
 * bar). Boot behavior lives in App.tsx's resolveBootMode: a device's
 * first-ever launch still goes straight to Practice (the "solving within
 * ~10 seconds" cold start), every launch after that opens here instead.
 *
 * Composed from existing v2 tokens, recombined into a bolder arrangement
 * than a bare reuse of StatusBar's pills: a large-type hero stat (using the
 * existing --font-size-4xl token, not a new size) replaces the tiny pill
 * row, and each mode card gets a colored icon badge (--accent-dim circle,
 * the same "chip" language pattern-picker__badge already uses elsewhere)
 * instead of a bare floating icon. The Practice card is visually larger
 * than Daily/Rush — full width above them, not an equal-weight column — to
 * read as the primary action. Daily's done/not-done state is folded into
 * its card's badge (pattern-picker__badge--mastered/--new) rather than a
 * separate status element — a deliberate compositional reading, not a
 * fourth invented block; flag to Thomas if a standalone status element was
 * actually wanted. Rush's card follows the identical badge pattern: a
 * "Best {n}" chip appears only once `profile.rushStats` is non-null (at
 * least one run completed), the retention-hook display the build plan
 * calls out — absent for a brand-new player, same as Daily's badge being
 * conditionally rendered rather than always present.
 *
 * Trace's card intentionally has no badge/chip: Global Constraint 3
 * forbids new `UserProfile` fields this phase, and there is no existing
 * profile field a Trace "best score"-style badge could read from (unlike
 * Rush's `rushStats`, which already existed). Revisit once Trace earns its
 * own persisted stat.
 *
 * Boss's card (v3 Phase 1, added after the initial build in response to a
 * final-review finding — no task in that phase's plan had scoped Home.tsx,
 * a real gap, not a deliberate omission) follows Rush's exact badge
 * pattern: a "Best depth {n}" chip appears only once `profile.bossStats` is
 * non-null. `.home__cards-secondary`'s grid (home.css) was re-tuned for 4
 * tracks, not 3, at the same time — see that file's own comment.
 *
 * Missions' card (v3 Phase 2) follows the same badge pattern once more: a
 * "{n} completed" chip appears only once `profile.missionStats` is
 * non-null (decision 4's "no invented rating number" constraint applies to
 * this chip too — completions is a plain count, not a rating/Elo delta).
 * `.home__cards-secondary`'s grid was re-tuned again, for a 5th track.
 *
 * 2b.1: rating/streak header + the Practice card (primary action) now
 * render inside PageShell's sticky `header` slot, pinned above the
 * scrollable Daily/Rush/Trace/Boss/Missions grid — see PageShell.tsx and
 * docs/superpowers/plans/2026-08-12-phase-2b1-layout-shell.md's Design
 * record for why. The loading-state early return is untouched (no header
 * to pin yet).
 */
import { useEffect, useRef, useState } from 'react'
import { Link } from 'wouter'
import { loadProfile, listAttempts } from '../storage'
import type { UserProfile, Attempt } from '../storage'
import { getDailyNumber } from '../engine'
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
import { PageShell } from './PageShell'
import { ROUTES } from './routes'
import { getRecentActivity, getRatingTrend } from './homeActivity'
import { useMediaQuery } from './useMediaQuery'
import { MasteryTeaser } from './practice/MasteryTeaser'
import { getActivityCalendar } from './stats/statsData'
import { computeMastery } from './practice/mastery'
import { PATTERN_LABELS, puzzlePool } from '../content'

// 2b.5: mode -> display label for the recent-activity recap. Kept local to
// Home rather than added to AttemptMode itself — this is presentation-only,
// the same reasoning as CARD_BASE/BADGE_MASTERED below.
const MODE_LABELS: Record<string, string> = {
  practice: 'Practice',
  daily: 'Daily',
  rush: 'Rush',
  boss: 'Boss',
}

function todayDateString(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(year)}-${month}-${day}`
}

// 2b.0: two card "shapes" (primary vs. secondary) and two icon-badge shapes
// (regular vs. primary-card's bigger/inverted), built once each rather than
// repeated per Link. Kept as separate base/variant strings (not merged into
// one conditional class list) so a given element only ever carries one
// color/size pair — Tailwind utilities in the same className string don't
// override each other by source order the way `.home__card--primary`
// cascading over `.home__card` did.
// lg:-scoped hover lift (transform only, no JS) — desktop introduces mouse
// hover as a signal mobile doesn't have; matches the existing
// `active:scale-[0.98]` press-feedback convention used site-wide for
// buttons, just gated to the breakpoint where hover is a meaningful signal.
const CARD_BASE =
  'flex flex-col items-start min-h-11 w-full rounded-md border text-left no-underline cursor-pointer lg:transition-[transform,border-color] lg:duration-150 lg:hover:-translate-y-0.5'
const CARD_SECONDARY = `${CARD_BASE} gap-2 p-4 border-border bg-surface-1 text-text-0 lg:hover:border-border-strong`
// Gradient (DailyPage.tsx's own heroClass treatment, reused verbatim) gives
// the primary CTA more visual weight than a flat fill — originally desktop
// only, extended to mobile too per explicit follow-up request so both
// viewports match. text-accent-ink (#0e0f13, near-black — meant for text on
// the old bright flat accent fill) would be almost invisible against this
// dark gradient, so text-text-0 replaces it, matching how DailyPage's own
// gradient hero card sets text-text-0 on its content rather than relying on
// an "ink" color.
const CARD_PRIMARY = `${CARD_BASE} gap-3 p-5 border-accent text-text-0 [background:linear-gradient(160deg,var(--accent-dim),var(--surface-1))]`

// 2b.0: was `.pattern-picker__badge` (base) + `--mastered`/`--new` in
// practicePage.css, reused here (PatternPicker.tsx/MasteryView.tsx define
// their own equivalent locally too — same visual language, no shared
// component to extract for two states used this simply).
const BADGE_MASTERED =
  'flex-none font-mono text-xs font-bold rounded-full py-[3px] px-2 text-accent bg-accent-dim'
const BADGE_NEW = 'flex-none font-mono text-xs font-bold rounded-full py-[3px] px-2 text-text-2'
// Desktop-only variant of BADGE_NEW for Daily's "Not done yet" state — same
// warn semantic the streak flame above already uses, so the daily-return
// habit hook reads as a nudge instead of neutral metadata. Mobile keeps
// BADGE_NEW unchanged.
const BADGE_WARN =
  'flex-none font-mono text-xs font-bold rounded-full py-[3px] px-2 text-warn bg-warn-dim'

const ICON_BASE = 'flex items-center justify-center flex-none rounded-full'
const ICON_SECONDARY = `${ICON_BASE} w-10 h-10 bg-accent-dim text-accent`
const ICON_PRIMARY = `${ICON_BASE} w-12 h-12 bg-accent-ink text-accent`

// `home__card-title` stays literal (no styling of its own) — App.test.tsx
// scopes `findByText('Practice', { selector: '.home__card-title' })` on it
// to disambiguate Home's card from NavRail's same-named nav item.
const TITLE_SECONDARY = 'home__card-title text-lg font-bold'
const TITLE_PRIMARY = 'home__card-title text-xl font-bold'

// Desktop sidebar's compact activity grid — same cell look as StatsPage's
// own activity calendar (statsData.ts's ACTIVITY_CALENDAR_WEEKS window),
// just a shorter trailing slice to fit the narrower `--sidebar-width`
// column. Local copy, not an import from StatsPage.tsx, matching how this
// file already keeps its own CARD_*/BADGE_* constants rather than reaching
// into another page's internals.
function activityCellClass(active: boolean): string {
  return active
    ? 'aspect-square rounded-[2px] bg-accent'
    : 'aspect-square rounded-[2px] bg-surface-2'
}
const SIDEBAR_ACTIVITY_WEEKS = 8

export function Home() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const cancelledRef = useRef(false)
  const isDesktop = useMediaQuery('(min-width: 1024px)')

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

  // 2b.0: `.home`'s own rules (max-width var(--content-width-mobile), lg:
  // var(--content-width-desktop) — breakpoint matches Tailwind's `lg`
  // exactly) moved to utilities, but the bare `home` classname itself stays
  // literal — App.test.tsx's boot-mode tests use it (and PracticePage's
  // `.practice-page`) as a root-container marker to tell the two pages
  // apart, since both can render the same "1200" text on a fresh profile.
  //
  // 2b.1: the loading branch below has no PageShell/header (nothing to pin
  // yet), so it keeps its own top safe-area padding directly. The loaded
  // branch passes HOME_SHELL_CLASS to PageShell instead — no top padding of
  // its own, since the rating row inside `header` now owns that (see the
  // 2b.1 Design record's "known, accepted spacing delta").
  const homeShellClass =
    'home app-shell__main flex flex-col gap-3 w-full max-w-[var(--content-width-mobile)] lg:max-w-[var(--content-width-desktop)] mx-auto pt-[calc(var(--space-4)+env(safe-area-inset-top))] px-4 pb-4'
  const HOME_SHELL_CLASS =
    'home app-shell__main flex flex-col gap-3 w-full max-w-[var(--content-width-mobile)] lg:max-w-[var(--content-width-desktop)] mx-auto px-4 pb-4'

  if (profile === null) {
    return (
      <div className={homeShellClass}>
        <p className="text-center text-text-1 py-8">Loading…</p>
      </div>
    )
  }

  const today = todayDateString()
  const dayNumber = getDailyNumber(today)
  const doneToday = profile.dailyCompletion?.date === today
  const streakActive = profile.streak.currentStreak > 0
  const recentActivity = getRecentActivity(attempts)
  const ratingTrend = getRatingTrend(attempts, new Date().toISOString())
  // Elo-style updates are rarely whole numbers — round for display the same
  // way the header's own Rating figure already does (Math.round(profile.rating)
  // above), not raw float noise like "-8.559766727818669".
  const roundedTrend = ratingTrend === null ? null : Math.round(ratingTrend)
  const ratingTrendText =
    roundedTrend === null
      ? null
      : `${roundedTrend >= 0 ? '▲' : '▼'} ${roundedTrend >= 0 ? '+' : ''}${String(roundedTrend)} this week`
  const roundedActivityDelta =
    recentActivity === null ? null : Math.round(recentActivity.ratingDelta)
  const recentActivityText =
    recentActivity === null || roundedActivityDelta === null
      ? null
      : `${MODE_LABELS[recentActivity.mode] ?? recentActivity.mode} · ${String(recentActivity.correct)}/${String(recentActivity.total)} correct · ${roundedActivityDelta >= 0 ? '+' : ''}${String(roundedActivityDelta)} rating`
  // Desktop sidebar only — sliced from the same 12-week window
  // getActivityCalendar always returns, not a separate derivation.
  const sidebarActivityDays = getActivityCalendar(attempts, new Date().toISOString()).slice(
    -SIDEBAR_ACTIVITY_WEEKS * 7,
  )
  // Desktop-only "practice this next" nudge — same weakest-pattern lookup
  // StatsPage.tsx already built, reused verbatim rather than re-derived.
  const weakestPattern = computeMastery(attempts, puzzlePool)
    .filter((row) => row.accuracy !== null)
    .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0))[0]

  return (
    <>
      <PageShell
        className={HOME_SHELL_CLASS}
        header={
          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between flex-wrap gap-3 pt-[calc(var(--space-5)+env(safe-area-inset-top))]">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-bold text-text-1 uppercase tracking-[0.04em]">
                  Rating
                </span>
                <span className="text-4xl font-bold text-text-0 leading-none tabular-nums">
                  {Math.round(profile.rating)}
                </span>
                {ratingTrendText !== null && (
                  <span
                    className={`text-xs font-bold font-mono ${roundedTrend !== null && roundedTrend >= 0 ? 'text-accent' : 'text-danger'}`}
                  >
                    {ratingTrendText}
                  </span>
                )}
              </div>
              <div
                className={`flex items-center gap-1.5 text-md font-bold ${streakActive ? 'text-warn' : 'text-text-2'}`}
              >
                <StreakIcon size={16} />
                <span>{profile.streak.currentStreak}</span>
                <span className="text-text-1 font-semibold">day streak</span>
              </div>
            </div>

            <Link href={ROUTES.practice.path} className={CARD_PRIMARY}>
              <span className={ICON_PRIMARY}>
                <PracticeIcon size={24} />
              </span>
              <span className={TITLE_PRIMARY}>Practice</span>
              <span className="text-sm text-inherit opacity-85">
                Endless rating-matched puzzles
              </span>
            </Link>
          </div>
        }
      >
        {isDesktop &&
          (weakestPattern ? (
            <Link
              href={`/practice?pattern=${weakestPattern.pattern}`}
              className="flex items-center gap-3 p-4 rounded-md border border-danger bg-danger-dim no-underline text-text-0"
            >
              <span aria-hidden="true" className="text-xl">
                🎯
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-bold">Practice this next</span>
                <span className="text-xs text-text-1">
                  {PATTERN_LABELS[weakestPattern.pattern]} ·{' '}
                  {Math.round((weakestPattern.accuracy ?? 0) * 100)}% accuracy
                </span>
              </span>
            </Link>
          ) : (
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
          ))}

        {recentActivityText !== null && (
          <p className="m-0 font-mono text-sm font-bold text-text-1">{recentActivityText}</p>
        )}

        <p className="m-0 text-xs font-bold text-text-2 uppercase tracking-[0.04em]">Modes</p>

        {/* 2b.0: was `.home__cards-secondary` — grid only kicks in >=640px
         * (Tailwind `sm`, exact match), auto-fit/minmax(60px,1fr) so
         * Daily/Rush/Trace/Boss/Missions/Stats (6 same-tier cards, 2b.7 added
         * Stats) share one row evenly instead of a fixed 2-column split. The
         * 60px floor is tuned to this card's own container: 480px
         * (--content-width-mobile) minus 2x16px (px-4) padding = 448px, minus
         * 5x12px (gap-3) column gaps = 388px for 6 tracks, i.e. ~64.7px/track
         * — 60px leaves ~28px slack for rounding (same convention the
         * original 5-track 75px floor used). Re-derive this number again if a
         * 7th mode card is ever added.
         *
         * >=1024px (Tailwind `lg`) overrides to a fixed 3-column/2-row
         * layout instead of letting auto-fit keep 6 cards in one row: at
         * --content-width-desktop (608px available for the grid, minus the
         * new sidebar's own width) the 1-row auto-fit result squeezes each
         * card to ~90-100px — description text (e.g. Rush's "Escalating
         * puzzles — 3 strikes and you're out") wraps awkwardly at that
         * width. 3 columns gives each card roughly double the room. */}
        <div className="flex flex-col gap-3 sm:grid sm:grid-cols-[repeat(auto-fit,minmax(60px,1fr))] lg:grid-cols-3">
          <Link href={ROUTES.daily.path} className={CARD_SECONDARY}>
            <span className={ICON_SECONDARY}>
              <DailyIcon size={20} />
            </span>
            <span className={TITLE_SECONDARY}>Daily #{dayNumber}</span>
            <span className="text-sm text-inherit opacity-85">One puzzle, once a day</span>
            <span className={doneToday ? BADGE_MASTERED : isDesktop ? BADGE_WARN : BADGE_NEW}>
              {doneToday ? 'Done today' : 'Not done yet'}
            </span>
          </Link>

          <Link href={ROUTES.rush.path} className={CARD_SECONDARY}>
            <span className={ICON_SECONDARY}>
              <RushIcon size={20} />
            </span>
            <span className={TITLE_SECONDARY}>Rush</span>
            <span className="text-sm text-inherit opacity-85">
              Escalating puzzles — 3 strikes and you&apos;re out
            </span>
            {profile.rushStats && (
              <span className={BADGE_MASTERED}>Best {profile.rushStats.bestScore}</span>
            )}
          </Link>

          <Link href={ROUTES.trace.path} className={CARD_SECONDARY}>
            <span className={ICON_SECONDARY}>
              <TraceIcon size={20} />
            </span>
            <span className={TITLE_SECONDARY}>Trace</span>
            <span className="text-sm text-inherit opacity-85">
              Step through code, predict each line
            </span>
          </Link>

          <Link href={ROUTES.boss.path} className={CARD_SECONDARY}>
            <span className={ICON_SECONDARY}>
              <BossIcon size={20} />
            </span>
            <span className={TITLE_SECONDARY}>Boss</span>
            <span className="text-sm text-inherit opacity-85">
              10 puzzles, escalating — how deep can you get?
            </span>
            {profile.bossStats && (
              <span className={BADGE_MASTERED}>Best depth {profile.bossStats.bestDepth}</span>
            )}
          </Link>

          <Link href={ROUTES.missions.path} className={CARD_SECONDARY}>
            <span className={ICON_SECONDARY}>
              <MissionIcon size={20} />
            </span>
            <span className={TITLE_SECONDARY}>Missions</span>
            <span className="text-sm text-inherit opacity-85">Three modes, one directed run</span>
            {profile.missionStats && (
              <span className={BADGE_MASTERED}>{profile.missionStats.completions} completed</span>
            )}
          </Link>

          <Link href={ROUTES.stats.path} className={CARD_SECONDARY}>
            <span className={ICON_SECONDARY}>
              <StatsIcon size={20} />
            </span>
            <span className={TITLE_SECONDARY}>Stats</span>
            <span className="text-sm text-inherit opacity-85">
              Rating history and pattern accuracy
            </span>
          </Link>
        </div>
      </PageShell>
      {isDesktop && (
        <aside className="app-shell__sidebar flex flex-col gap-4 py-6 px-4 border-l border-border self-start">
          <MasteryTeaser refreshKey={0} />
          <div
            className={`grid grid-cols-[repeat(7,1fr)] gap-1`}
            role="img"
            aria-label={`Activity — the last ${String(SIDEBAR_ACTIVITY_WEEKS)} weeks`}
          >
            {sidebarActivityDays.map((day) => (
              <div key={day.date} className={activityCellClass(day.active)} title={day.date} />
            ))}
          </div>
        </aside>
      )}
    </>
  )
}
