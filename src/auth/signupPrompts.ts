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
 * The four trigger points and the cap shape are locked by the build plan,
 * settled in the implementation plan's own "Open design questions" table:
 * one prompt per trigger type *ever*, a 7-day global cooldown between any
 * two prompts (regardless of trigger), and a permanent "don't ask again"
 * that suppresses every future trigger. All three checks are independent —
 * a trigger can be blocked by its own one-time flag even during an
 * otherwise-open cooldown window, and vice versa.
 */

export const SIGNUP_PROMPT_TRIGGERS = [
  'boss-clear',
  'streak-7-day',
  'leaderboard-view',
  'stats-second-visit',
] as const

export type SignupPromptTrigger = (typeof SIGNUP_PROMPT_TRIGGERS)[number]

export interface SignupPromptState {
  /** Trigger types that have already shown a prompt, ever. */
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

const GLOBAL_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

/**
 * The one function every trigger site calls before rendering a prompt.
 * Three independent gates, all must pass:
 *   1. Permanent opt-out not set.
 *   2. This exact trigger has never shown before.
 *   3. At least 7 days have passed since any prompt last showed (or none
 *      ever has).
 */
export function shouldShowSignupPrompt(
  state: SignupPromptState,
  trigger: SignupPromptTrigger,
  now: number,
): boolean {
  if (state.optedOut) return false
  if (state.shownTriggers.includes(trigger)) return false
  if (state.lastShownAt !== null && now - state.lastShownAt < GLOBAL_COOLDOWN_MS) return false
  return true
}

/**
 * Records that `trigger`'s prompt was actually shown -- called once, at the
 * moment the sheet renders, not at dismiss/create-account time (a prompt
 * that appeared and was ignored still consumed its one-per-trigger-ever
 * shot and started the cooldown, same as one that was actively dismissed).
 */
export function recordSignupPromptShown(
  state: SignupPromptState,
  trigger: SignupPromptTrigger,
  now: number,
): SignupPromptState {
  if (state.shownTriggers.includes(trigger)) return state
  return {
    ...state,
    shownTriggers: [...state.shownTriggers, trigger],
    lastShownAt: now,
  }
}

/** "Don't ask again" -- permanent, applies to every trigger from now on. */
export function recordSignupPromptOptOut(state: SignupPromptState): SignupPromptState {
  return { ...state, optedOut: true }
}
