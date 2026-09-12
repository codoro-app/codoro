import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SIGNUP_PROMPT_STATE,
  recordSignupPromptOptOut,
  recordSignupPromptShown,
  shouldShowSignupPrompt,
} from './signupPrompts'
import type { SignupPromptState } from './signupPrompts'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = 1_700_000_000_000

describe('shouldShowSignupPrompt', () => {
  it('shows a trigger that has never fired before, from the default state', () => {
    expect(shouldShowSignupPrompt(DEFAULT_SIGNUP_PROMPT_STATE, 'boss-clear', NOW)).toBe(true)
  })

  it('allows the same trigger to recur once the 3-day cooldown has fully elapsed', () => {
    const state = recordSignupPromptShown(DEFAULT_SIGNUP_PROMPT_STATE, 'boss-clear', NOW)
    expect(shouldShowSignupPrompt(state, 'boss-clear', NOW + 3 * DAY_MS)).toBe(true)
  })

  it('blocks a different trigger inside the 3-day global cooldown', () => {
    const state = recordSignupPromptShown(DEFAULT_SIGNUP_PROMPT_STATE, 'boss-clear', NOW)
    expect(shouldShowSignupPrompt(state, 'streak-7-day', NOW + 2 * DAY_MS)).toBe(false)
  })

  it('allows a different trigger once the 3-day cooldown has fully elapsed', () => {
    const state = recordSignupPromptShown(DEFAULT_SIGNUP_PROMPT_STATE, 'boss-clear', NOW)
    expect(shouldShowSignupPrompt(state, 'streak-7-day', NOW + 3 * DAY_MS)).toBe(true)
  })

  it('is still blocked at exactly the boundary (< 3 days, not <=)', () => {
    const state = recordSignupPromptShown(DEFAULT_SIGNUP_PROMPT_STATE, 'boss-clear', NOW)
    expect(shouldShowSignupPrompt(state, 'streak-7-day', NOW + 3 * DAY_MS - 1)).toBe(false)
  })

  it('never shows anything once permanently opted out, regardless of cooldown or trigger history', () => {
    const state = recordSignupPromptOptOut(DEFAULT_SIGNUP_PROMPT_STATE)
    expect(shouldShowSignupPrompt(state, 'boss-clear', NOW)).toBe(false)
    expect(shouldShowSignupPrompt(state, 'leaderboard-view', NOW + 365 * DAY_MS)).toBe(false)
  })

  it('opting out after some triggers have already fired still blocks every remaining one', () => {
    let state = recordSignupPromptShown(DEFAULT_SIGNUP_PROMPT_STATE, 'boss-clear', NOW)
    state = recordSignupPromptOptOut(state)
    expect(shouldShowSignupPrompt(state, 'streak-7-day', NOW + 30 * DAY_MS)).toBe(false)
  })

  it('all five trigger types can each fire in turn, spaced past the cooldown', () => {
    let state: SignupPromptState = DEFAULT_SIGNUP_PROMPT_STATE
    let t = NOW
    const seen: string[] = []
    for (const trigger of [
      'boss-clear',
      'streak-7-day',
      'leaderboard-view',
      'stats-second-visit',
      'puzzle-milestone',
    ] as const) {
      if (shouldShowSignupPrompt(state, trigger, t)) {
        seen.push(trigger)
        state = recordSignupPromptShown(state, trigger, t)
      }
      t += 4 * DAY_MS // clear the (now 3-day) cooldown before the next trigger fires
    }
    expect(seen).toEqual([
      'boss-clear',
      'streak-7-day',
      'leaderboard-view',
      'stats-second-visit',
      'puzzle-milestone',
    ])
  })

  it('a trigger already shown once can still fire again later -- the cap is cooldown-only, not one-shot', () => {
    let state: SignupPromptState = DEFAULT_SIGNUP_PROMPT_STATE
    state = recordSignupPromptShown(state, 'boss-clear', NOW)
    state = recordSignupPromptShown(state, 'boss-clear', NOW + 10 * DAY_MS)
    // Immediately after the second showing, still within cooldown.
    expect(shouldShowSignupPrompt(state, 'boss-clear', NOW + 10 * DAY_MS + DAY_MS)).toBe(false)
    // Cooldown counted from the *second* showing, not the first.
    expect(shouldShowSignupPrompt(state, 'boss-clear', NOW + 10 * DAY_MS + 3 * DAY_MS)).toBe(true)
  })
})

describe('recordSignupPromptShown', () => {
  it('appends the trigger and stamps lastShownAt', () => {
    const state = recordSignupPromptShown(DEFAULT_SIGNUP_PROMPT_STATE, 'boss-clear', NOW)
    expect(state.shownTriggers).toEqual(['boss-clear'])
    expect(state.lastShownAt).toBe(NOW)
  })

  it('does not duplicate an already-recorded trigger in shownTriggers, but does bump lastShownAt', () => {
    const first = recordSignupPromptShown(DEFAULT_SIGNUP_PROMPT_STATE, 'boss-clear', NOW)
    const second = recordSignupPromptShown(first, 'boss-clear', NOW + 100 * DAY_MS)
    expect(second.shownTriggers).toEqual(['boss-clear'])
    expect(second.lastShownAt).toBe(NOW + 100 * DAY_MS)
  })

  it('does not mutate the input state object', () => {
    const before = {
      ...DEFAULT_SIGNUP_PROMPT_STATE,
      shownTriggers: [...DEFAULT_SIGNUP_PROMPT_STATE.shownTriggers],
    }
    recordSignupPromptShown(DEFAULT_SIGNUP_PROMPT_STATE, 'boss-clear', NOW)
    expect(DEFAULT_SIGNUP_PROMPT_STATE).toEqual(before)
  })
})

describe('recordSignupPromptOptOut', () => {
  it('sets optedOut without touching shownTriggers/lastShownAt', () => {
    const seeded = recordSignupPromptShown(DEFAULT_SIGNUP_PROMPT_STATE, 'boss-clear', NOW)
    const state = recordSignupPromptOptOut(seeded)
    expect(state.optedOut).toBe(true)
    expect(state.shownTriggers).toEqual(['boss-clear'])
    expect(state.lastShownAt).toBe(NOW)
  })
})
