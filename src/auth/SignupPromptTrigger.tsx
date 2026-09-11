/**
 * T5: the one component trigger sites render — `<SignupPromptTrigger
 * trigger="stats-second-visit" active={isSecondVisit} />`. Owns the
 * "decide once, then stay however it was decided" behavior: the cap check
 * (`canShow`) runs exactly once, the moment `active` first becomes true,
 * and the decision (show or don't) doesn't waver on later re-renders even
 * though `markShown` immediately makes `canShow` return false for every
 * trigger going forward -- without that split, the sheet would flicker
 * closed the instant it opened.
 */
import { useEffect, useState } from 'react'
import { SignupPromptSheet } from './SignupPromptSheet'
import { SIGNUP_PROMPT_COPY } from './signupPromptCopy'
import { useSignupPrompt } from './useSignupPrompt'
import type { SignupPromptTrigger as Trigger } from './signupPrompts'

export interface SignupPromptTriggerProps {
  trigger: Trigger
  /** True the instant the real-world moment (boss clear, 2nd stats visit, ...) happens. */
  active: boolean
}

export function SignupPromptTrigger({ trigger, active }: SignupPromptTriggerProps) {
  const { canShow, markShown, optOut } = useSignupPrompt()
  const [visible, setVisible] = useState(false)
  const [decided, setDecided] = useState(false)

  useEffect(() => {
    if (active && !decided) {
      // Same shape as App.tsx's own boot-redirect flag: settling a
      // one-shot decision exactly once, synchronously, from the one effect
      // that owns it -- there is no prop/state input to derive this from
      // during render instead (canShow's answer is a side-effecting read of
      // localStorage-backed state, not a pure function of props).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDecided(true)
      if (canShow(trigger)) setVisible(true)
    }
    // canShow/decided/trigger deliberately excluded: this must decide
    // exactly once per mount, the moment `active` first flips true, not
    // re-evaluate as `canShow`'s own result changes underneath it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  if (!visible) return null

  return (
    <SignupPromptSheet
      copy={SIGNUP_PROMPT_COPY[trigger]}
      onShown={() => {
        markShown(trigger)
      }}
      onDismiss={() => {
        setVisible(false)
      }}
      onOptOut={() => {
        optOut()
        setVisible(false)
      }}
    />
  )
}
