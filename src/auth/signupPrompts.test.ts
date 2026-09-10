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

  it('never shows the same trigger a second time, even long after any cooldown', () => {
    const state = recordSignupPromptShown(DEFAULT_SIGNUP_PROMPT_STATE, 'boss-clear', NOW)
    expect(shouldShowSignupPrompt(state, 'boss-clear', NOW + 365 * DAY_MS)).toBe(false)
  })

  it('blocks a different trigger inside the 7-day global cooldown', () => {
    const state = recordSignupPromptShown(DEFAULT_SIGNUP_PROMPT_STATE, 'boss-clear', NOW)
    expect(shouldShowSignupPrompt(state, 'streak-7-day', NOW + 6 * DAY_MS)).toBe(false)
  })

  it('allows a different trigger once the 7-day cooldown has fully elapsed', () => {
    const state = recordSignupPromptShown(DEFAULT_SIGNUP_PROMPT_STATE, 'boss-clear', NOW)
    expect(shouldShowSignupPrompt(state, 'streak-7-day', NOW + 7 * DAY_MS)).toBe(true)
  })

  it('is still blocked at exactly the boundary (< 7 days, not <=)', () => {
    const state = recordSignupPromptShown(DEFAULT_SIGNUP_PROMPT_STATE, 'boss-clear', NOW)
    expect(shouldShowSignupPrompt(state, 'streak-7-day', NOW + 7 * DAY_MS - 1)).toBe(false)
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

  it('all four trigger types are independently one-shot across a long play history', () => {
    let state: SignupPromptState = DEFAULT_SIGNUP_PROMPT_STATE
    let t = NOW
    const seen: string[] = []
    for (const trigger of [
      'boss-clear',
      'streak-7-day',
      'leaderboard-view',
      'stats-second-visit',
    ] as const) {
      if (shouldShowSignupPrompt(state, trigger, t)) {
        seen.push(trigger)
        state = recordSignupPromptShown(state, trigger, t)
      }
      t += 8 * DAY_MS // clear the cooldown before the next trigger fires
    }
    // Every trigger gets exactly one shot, in order, spaced past cooldown.
    expect(seen).toEqual(['boss-clear', 'streak-7-day', 'leaderboard-view', 'stats-second-visit'])
    // And none of them fire a second time even much later.
    for (const trigger of [
      'boss-clear',
      'streak-7-day',
      'leaderboard-view',
      'stats-second-visit',
    ] as const) {
      expect(shouldShowSignupPrompt(state, trigger, t + 365 * DAY_MS)).toBe(false)
    }
  })
})

describe('recordSignupPromptShown', () => {
  it('appends the trigger and stamps lastShownAt', () => {
    const state = recordSignupPromptShown(DEFAULT_SIGNUP_PROMPT_STATE, 'boss-clear', NOW)
    expect(state.shownTriggers).toEqual(['boss-clear'])
    expect(state.lastShownAt).toBe(NOW)
  })

  it('is idempotent for a trigger already recorded -- does not duplicate or bump the timestamp', () => {
    const first = recordSignupPromptShown(DEFAULT_SIGNUP_PROMPT_STATE, 'boss-clear', NOW)
    const second = recordSignupPromptShown(first, 'boss-clear', NOW + 100 * DAY_MS)
    expect(second).toEqual(first)
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
