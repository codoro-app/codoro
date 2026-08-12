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
import './home.css'

function todayDateString(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(year)}-${month}-${day}`
}

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

  if (profile === null) {
    return (
      <div className="home app-shell__main">
        <p className="home__status">Loading…</p>
      </div>
    )
  }

  const today = todayDateString()
  const dayNumber = getDailyNumber(today)
  const doneToday = profile.dailyCompletion?.date === today
  const streakActive = profile.streak.currentStreak > 0

  return (
    <div className="home app-shell__main">
      <div className="home__hero">
        <div className="home__hero-rating">
          <span className="home__hero-label">Rating</span>
          <span className="home__hero-value">{Math.round(profile.rating)}</span>
        </div>
        <div className="home__hero-streak" data-active={streakActive}>
          <StreakIcon size={16} />
          <span className="home__hero-streak-value">{profile.streak.currentStreak}</span>
          <span className="home__hero-streak-label">day streak</span>
        </div>
      </div>

      <p className="home__section-label">Modes</p>

      <div className="home__cards">
        <Link href={ROUTES.practice.path} className="home__card home__card--primary">
          <span className="home__card-icon home__card-icon--inverted">
            <PracticeIcon size={24} />
          </span>
          <span className="home__card-title">Practice</span>
          <span className="home__card-desc">Endless rating-matched puzzles</span>
        </Link>

        <div className="home__cards-secondary">
          <Link href={ROUTES.daily.path} className="home__card">
            <span className="home__card-icon">
              <DailyIcon size={20} />
            </span>
            <span className="home__card-title">Daily #{dayNumber}</span>
            <span className="home__card-desc">One puzzle, once a day</span>
            <span
              className={`pattern-picker__badge pattern-picker__badge--${doneToday ? 'mastered' : 'new'}`}
            >
              {doneToday ? 'Done today' : 'Not done yet'}
            </span>
          </Link>

          <Link href={ROUTES.rush.path} className="home__card">
            <span className="home__card-icon">
              <RushIcon size={20} />
            </span>
            <span className="home__card-title">Rush</span>
            <span className="home__card-desc">
              Escalating puzzles — 3 strikes and you&apos;re out
            </span>
            {profile.rushStats && (
              <span className="pattern-picker__badge pattern-picker__badge--mastered">
                Best {profile.rushStats.bestScore}
              </span>
            )}
          </Link>

          <Link href={ROUTES.trace.path} className="home__card">
            <span className="home__card-icon">
              <TraceIcon size={20} />
            </span>
            <span className="home__card-title">Trace</span>
            <span className="home__card-desc">Step through code, predict each line</span>
          </Link>

          <Link href={ROUTES.boss.path} className="home__card">
            <span className="home__card-icon">
              <BossIcon size={20} />
            </span>
            <span className="home__card-title">Boss</span>
            <span className="home__card-desc">10 puzzles, escalating — how deep can you get?</span>
            {profile.bossStats && (
              <span className="pattern-picker__badge pattern-picker__badge--mastered">
                Best depth {profile.bossStats.bestDepth}
              </span>
            )}
          </Link>

          <Link href={ROUTES.missions.path} className="home__card">
            <span className="home__card-icon">
              <MissionIcon size={20} />
            </span>
            <span className="home__card-title">Missions</span>
            <span className="home__card-desc">Three modes, one directed run</span>
            {profile.missionStats && (
              <span className="pattern-picker__badge pattern-picker__badge--mastered">
                {profile.missionStats.completions} completed
              </span>
            )}
          </Link>
        </div>
      </div>
    </div>
  )
}
