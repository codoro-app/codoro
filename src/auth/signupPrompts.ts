/**
 * T5: the signup-prompt frequency cap, as pure functions over a plain state
 * object — no localStorage, no Date.now(), no React, so the state-machine
 * itself (the part that's "invisible in manual testing and obvious in a
 * test", per the build prompt) is exercised directly in
 * signupPrompts.test.ts without a DOM or a clock to fake. `useSignupPrompt`
 * (useSignupPrompt.ts) is the thin, localStorage-backed React wrapper
 * around this module — same split useFeedbackNudge.ts's read/write
 * functions have from its own hook, just with real state transitions this
 * time instead of a single boolean flag.
 *
 * Phase 5.2 Piece 0 revision (2026-09-12): the original one-shot-per-trigger
 * cap made the prompt too rare in practice — `boss-clear` and `streak-7-day`
 * are both real moments, but a meaningful slice of users never clear Boss or
 * hold a 7-day streak, so those two alone left them never prompted at all.
 * The cap is now cooldown-only: any trigger can recur once the global
 * cooldown (shortened 7d -> 3d) has elapsed, and a fifth, low-bar trigger
 * (`puzzle-milestone`) was added alongside the original four so there's a
 * near-universal early moment that doesn't depend on which modes a player
 * happens to touch. `shownTriggers` is kept as a shown-at-least-once
 * bookkeeping list (useful for analytics/copy variety later) but no longer
 * gates `shouldShowSignupPrompt` — only the cooldown and the permanent
 * opt-out do.
 */

export const SIGNUP_PROMPT_TRIGGERS = [
  'boss-clear',
  'streak-7-day',
  'leaderboard-view',
  'stats-second-visit',
  'puzzle-milestone',
] as const

export type SignupPromptTrigger = (typeof SIGNUP_PROMPT_TRIGGERS)[number]

export interface SignupPromptState {
  /** Trigger types that have shown a prompt at least once (bookkeeping only — does not gate). */
  shownTriggers: SignupPromptTrigger[]
  /** Epoch ms of the most recent prompt shown (any trigger), or null. */
  lastShownAt: number | null
  /** Permanent "don't ask again" — once true, nothing shows again. */
  optedOut: boolean
}

export const DEFAULT_SIGNUP_PROMPT_STATE: SignupPromptState = {
  shownTriggers: [],
  lastShownAt: null,
  optedOut: false,
}

const GLOBAL_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000

/**
 * The one function every trigger site calls before rendering a prompt. Two
 * independent gates, both must pass:
 *   1. Permanent opt-out not set.
 *   2. At least 3 days have passed since any prompt last showed (or none
 *      ever has) — regardless of which trigger fired last or is asking now,
 *      so the same trigger recurring is allowed once the cooldown clears.
 */
export function shouldShowSignupPrompt(
  state: SignupPromptState,
  // Kept in the signature for every call site's clarity ("is *this* trigger
  // allowed to show") and so a future trigger-specific rule has somewhere to
  // hang without changing every caller -- but the cooldown-only cap below
  // doesn't currently read it.
  _trigger: SignupPromptTrigger,
  now: number,
): boolean {
  if (state.optedOut) return false
  if (state.lastShownAt !== null && now - state.lastShownAt < GLOBAL_COOLDOWN_MS) return false
  return true
}

/**
 * Records that `trigger`'s prompt was actually shown -- called once, at the
 * moment the sheet renders, not at dismiss/create-account time (a prompt
 * that appeared and was ignored still started the cooldown, same as one
 * that was actively dismissed). `lastShownAt` always advances, including on
 * a repeat trigger -- that's what makes the recurring cooldown work.
 * `shownTriggers` stays a deduped "ever shown" list purely for bookkeeping.
 */
export function recordSignupPromptShown(
  state: SignupPromptState,
  trigger: SignupPromptTrigger,
  now: number,
): SignupPromptState {
  return {
    ...state,
    shownTriggers: state.shownTriggers.includes(trigger)
      ? state.shownTriggers
      : [...state.shownTriggers, trigger],
    lastShownAt: now,
  }
}

/** "Don't ask again" -- permanent, applies to every trigger from now on. */
export function recordSignupPromptOptOut(state: SignupPromptState): SignupPromptState {
  return { ...state, optedOut: true }
}
