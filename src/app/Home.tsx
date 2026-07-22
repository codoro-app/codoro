/**
 * Home screen — reachable only via the logo (desktop rail / mobile app
 * bar), never the boot path (App.tsx's initial mode stays 'practice', so
 * the "solving within ~10 seconds" cold start is untouched). Composed
 * entirely from existing v2 patterns: rating/streak reuse StatusBar's pill
 * markup, the three mode cards reuse PatternPicker's card shape (plus
 * pattern-picker__all's accent-fill for the Practice primary CTA and
 * mode-switcher's disabled treatment for Rush), and Daily's done/not-done
 * state is folded into its card's badge (pattern-picker__badge--mastered/
 * --new) rather than a separate status element — a deliberate compositional
 * reading, not a fourth invented block; flag to Thomas if a standalone
 * status element was actually wanted.
 */
import { useEffect, useRef, useState } from 'react'
import { loadProfile } from '../storage'
import type { UserProfile } from '../storage'
import { getDailyNumber } from '../engine'
import { DailyIcon, PracticeIcon, RatingIcon, RushIcon, StreakIcon } from './Icons'
import type { AppMode } from './ModeSwitcher'
import './home.css'

export interface HomeProps {
  onNavigate: (mode: AppMode) => void
}

function todayDateString(date = new Date()): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(year)}-${month}-${day}`
}

export function Home({ onNavigate }: HomeProps) {
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

  return (
    <div className="home app-shell__main">
      <div className="status-bar">
        <div className="status-bar__pill status-bar__pill--rating" title="Rating">
          <RatingIcon size={14} />
          <span>{Math.round(profile.rating)}</span>
        </div>
        <div className="status-bar__pill status-bar__pill--streak" title="Daily streak">
          <span className="home__streak-icon" data-active={profile.streak.currentStreak > 0}>
            <StreakIcon size={14} />
          </span>
          <span>{profile.streak.currentStreak}</span>
        </div>
      </div>

      <div className="home__cards">
        <button
          type="button"
          className="home__card home__card--primary"
          onClick={() => {
            onNavigate('practice')
          }}
        >
          <PracticeIcon size={22} />
          <span className="home__card-title">Practice</span>
          <span className="home__card-desc">Endless rating-matched puzzles</span>
        </button>

        <button
          type="button"
          className="home__card"
          onClick={() => {
            onNavigate('daily')
          }}
        >
          <DailyIcon size={22} />
          <span className="home__card-title">Daily #{dayNumber}</span>
          <span className="home__card-desc">One puzzle, once a day</span>
          <span
            className={`pattern-picker__badge pattern-picker__badge--${doneToday ? 'mastered' : 'new'}`}
          >
            {doneToday ? 'Done today' : 'Not done yet'}
          </span>
        </button>

        <div className="home__card home__card--disabled" aria-disabled="true">
          <RushIcon size={22} />
          <span className="home__card-title">Rush</span>
          <span className="home__card-desc">Timed sprint mode</span>
          <span className="pattern-picker__badge pattern-picker__badge--new">Coming soon</span>
        </div>
      </div>
    </div>
  )
}
