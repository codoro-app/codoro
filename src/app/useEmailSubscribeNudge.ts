/**
 * Drives EmailSubscribeCard's visibility -- one permanent flag, same
 * "disposable UI preference, not app data worth a schema" reasoning
 * useFeedbackNudge.ts already establishes for its own dismissal flag.
 * Persisted via localStorage, set either on an explicit dismiss (the "no
 * thanks" action) or a successful subscribe -- either way, a visitor never
 * sees this card again once they've made a choice about it once.
 */
import { useCallback, useState } from 'react'

const DISMISSED_KEY = 'codoro:email-subscribe-dismissed'

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    return false
  }
}

function writeDismissed(): void {
  try {
    localStorage.setItem(DISMISSED_KEY, '1')
  } catch {
    // Safari private browsing (and similar) can throw on localStorage
    // access -- worst case the card reappears next load, which is fine.
  }
}

export interface UseEmailSubscribeNudgeResult {
  dismissed: boolean
  dismiss: () => void
}

export function useEmailSubscribeNudge(): UseEmailSubscribeNudgeResult {
  const [dismissed, setDismissed] = useState(readDismissed)

  const dismiss = useCallback(() => {
    writeDismissed()
    setDismissed(true)
  }, [])

  return { dismissed, dismiss }
}
