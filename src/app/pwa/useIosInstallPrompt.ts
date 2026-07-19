/**
 * Drives IosInstallSheet's visibility: shown once per device (persisted via
 * localStorage, not the IndexedDB-backed src/storage/ module — this is a
 * disposable UI preference, not app data worth a schema/migration) unless
 * dismissed, and only where shouldShowIosInstallSheet (iosInstall.ts) says
 * the Share -> Add to Home Screen flow is actually reachable.
 */
import { useCallback, useState } from 'react'
import { currentIosEnvironment, shouldShowIosInstallSheet } from './iosInstall'

const DISMISSED_KEY = 'codoro:ios-install-dismissed'

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
    // access — worst case the sheet reappears next launch, which is fine.
  }
}

export interface UseIosInstallPromptResult {
  visible: boolean
  dismiss: () => void
}

export function useIosInstallPrompt(): UseIosInstallPromptResult {
  const [dismissed, setDismissed] = useState(readDismissed)
  // Computed once: the environment (UA, standalone mode) doesn't change over
  // a session, so there's nothing to react to after the initial render.
  const [eligible] = useState(() => shouldShowIosInstallSheet(currentIosEnvironment()))

  const dismiss = useCallback(() => {
    writeDismissed()
    setDismissed(true)
  }, [])

  return { visible: eligible && !dismissed, dismiss }
}
