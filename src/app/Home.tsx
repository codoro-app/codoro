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
 */
import { useEffect, useRef, useState } from 'react'
import { Link } from 'wouter'
import { loadProfile } from '../storage'
import type { UserProfile } from '../storage'
import { getDailyNumber } from '../engine'
import {
  BossIcon,
  DailyIcon,
  MissionIcon,
  PracticeIcon,
  RushIcon,
  StreakIcon,
  TraceIcon,
} from './Icons'
import { ROUTES } from './routes'

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
const CARD_BASE =
  'flex flex-col items-start min-h-11 w-full rounded-md border text-left no-underline cursor-pointer'
const CARD_SECONDARY = `${CARD_BASE} gap-2 p-4 border-border bg-surface-1 text-text-0`
const CARD_PRIMARY = `${CARD_BASE} gap-3 p-5 border-accent bg-accent text-accent-ink`

// 2b.0: was `.pattern-picker__badge` (base) + `--mastered`/`--new` in
// practicePage.css, reused here (PatternPicker.tsx/MasteryView.tsx define
// their own equivalent locally too — same visual language, no shared
// component to extract for two states used this simply).
const BADGE_MASTERED =
  'flex-none font-mono text-xs font-bold rounded-full py-[3px] px-2 text-accent bg-accent-dim'
const BADGE_NEW = 'flex-none font-mono text-xs font-bold rounded-full py-[3px] px-2 text-text-2'

const ICON_BASE = 'flex items-center justify-center flex-none rounded-full'
const ICON_SECONDARY = `${ICON_BASE} w-10 h-10 bg-accent-dim text-accent`
const ICON_PRIMARY = `${ICON_BASE} w-12 h-12 bg-accent-ink text-accent`

// `home__card-title` stays literal (no styling of its own) — App.test.tsx
// scopes `findByText('Practice', { selector: '.home__card-title' })` on it
// to disambiguate Home's card from NavRail's same-named nav item.
const TITLE_SECONDARY = 'home__card-title text-lg font-bold'
const TITLE_PRIMARY = 'home__card-title text-xl font-bold'

export function Home() {
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const cancelledRef = useRef(false)

  useEffect(() => {
    cancelledRef.current = false
    void (async () => {
      const loaded = await loadProfile()
      if (cancelledRef.current) return
      setProfile(loaded)
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
  // Repeated on both early-return branches, same as the original CSS
  // applied regardless of loading state.
  const homeShellClass =
    'home app-shell__main flex flex-col gap-3 w-full max-w-[var(--content-width-mobile)] lg:max-w-[var(--content-width-desktop)] mx-auto pt-[calc(var(--space-4)+env(safe-area-inset-top))] px-4 pb-4'

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

  return (
    <div className={homeShellClass}>
      <div className="flex items-baseline justify-between flex-wrap gap-3 pt-5 pb-2">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-bold text-text-1 uppercase tracking-[0.04em]">Rating</span>
          <span className="text-4xl font-bold text-text-0 leading-none tabular-nums">
            {Math.round(profile.rating)}
          </span>
        </div>
        <div
          className={`flex items-center gap-1.5 text-md font-bold ${streakActive ? 'text-warn' : 'text-text-2'}`}
        >
          <StreakIcon size={16} />
          <span>{profile.streak.currentStreak}</span>
          <span className="text-text-1 font-semibold">day streak</span>
        </div>
      </div>

      <p className="m-0 text-xs font-bold text-text-2 uppercase tracking-[0.04em]">Modes</p>

      <div className="flex flex-col gap-3">
        <Link href={ROUTES.practice.path} className={CARD_PRIMARY}>
          <span className={ICON_PRIMARY}>
            <PracticeIcon size={24} />
          </span>
          <span className={TITLE_PRIMARY}>Practice</span>
          <span className="text-sm text-inherit opacity-85">Endless rating-matched puzzles</span>
        </Link>

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
          <Link href={ROUTES.daily.path} className={CARD_SECONDARY}>
            <span className={ICON_SECONDARY}>
              <DailyIcon size={20} />
            </span>
            <span className={TITLE_SECONDARY}>Daily #{dayNumber}</span>
            <span className="text-sm text-inherit opacity-85">One puzzle, once a day</span>
            <span className={doneToday ? BADGE_MASTERED : BADGE_NEW}>
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
        </div>
      </div>
    </div>
  )
}
