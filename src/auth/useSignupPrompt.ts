/**
 * T5: localStorage persistence for signupPrompts.ts's pure state machine —
 * same reasoning useFeedbackNudge.ts gives for its own flag: this is a
 * disposable UI preference, not app data worth a schema/migration in the
 * IndexedDB-backed src/storage/ module. One shared key across all four
 * trigger types (the cooldown is global, so the state has to be too).
 */
import { useCallback, useState } from 'react'
import {
  DEFAULT_SIGNUP_PROMPT_STATE,
  recordSignupPromptOptOut,
  recordSignupPromptShown,
  shouldShowSignupPrompt,
} from './signupPrompts'
import type { SignupPromptState, SignupPromptTrigger } from './signupPrompts'

const STORAGE_KEY = 'codoro:signup-prompt-state'

function readState(): SignupPromptState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SIGNUP_PROMPT_STATE
    const parsed: unknown = JSON.parse(raw)
    // Defensive, not paranoid: a malformed/older-shape blob falls back to
    // the default state (nothing to migrate -- this is v5.1's first
    // version of it) rather than throwing mid-render.
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as SignupPromptState).shownTriggers) &&
      typeof (parsed as SignupPromptState).optedOut === 'boolean'
    ) {
      return parsed as SignupPromptState
    }
    return DEFAULT_SIGNUP_PROMPT_STATE
  } catch {
    return DEFAULT_SIGNUP_PROMPT_STATE
  }
}

function writeState(state: SignupPromptState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Safari private browsing (and similar) can throw on localStorage
    // access -- worst case a prompt reappears next load, same trade-off
    // useFeedbackNudge.ts already accepts.
  }
}

export interface UseSignupPromptResult {
  /** Whether `trigger`'s prompt is allowed to show right now. */
  canShow: (trigger: SignupPromptTrigger) => boolean
  /** Call once, at the moment a prompt actually renders. */
  markShown: (trigger: SignupPromptTrigger) => void
  /** "Don't ask again" -- permanent, applies to every future trigger. */
  optOut: () => void
}

export function useSignupPrompt(): UseSignupPromptResult {
  const [state, setState] = useState(readState)

  const canShow = useCallback(
    (trigger: SignupPromptTrigger) => shouldShowSignupPrompt(state, trigger, Date.now()),
    [state],
  )

  const markShown = useCallback((trigger: SignupPromptTrigger) => {
    setState((current) => {
      const next = recordSignupPromptShown(current, trigger, Date.now())
      writeState(next)
      return next
    })
  }, [])

  const optOut = useCallback(() => {
    setState((current) => {
      const next = recordSignupPromptOptOut(current)
      writeState(next)
      return next
    })
  }, [])

  return { canShow, markShown, optOut }
}
