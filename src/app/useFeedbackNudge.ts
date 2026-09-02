/**
 * Drives FeedbackNudge's visibility: one dismissal flag, shared across both
 * of its trigger surfaces (DailyPage's post-completion hero, Home's
 * 5-solved-and-no-Daily-today fallback) — dismissing or clicking through on
 * either one suppresses both, permanently. Persisted via localStorage, same
 * reasoning as useIosInstallPrompt.ts: this is a disposable UI preference,
 * not app data worth a schema/migration in the IndexedDB-backed
 * src/storage/ module.
 */
import { useCallback, useState } from 'react'

const DISMISSED_KEY = 'codoro:feedback-nudge-dismissed'

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
    // access — worst case the nudge reappears next load, which is fine.
  }
}

export interface UseFeedbackNudgeResult {
  dismissed: boolean
  dismiss: () => void
}

export function useFeedbackNudge(): UseFeedbackNudgeResult {
  const [dismissed, setDismissed] = useState(readDismissed)

  const dismiss = useCallback(() => {
    writeDismissed()
    setDismissed(true)
  }, [])

  return { dismissed, dismiss }
}
