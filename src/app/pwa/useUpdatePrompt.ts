/**
 * Wraps vite-plugin-pwa's `useRegisterSW` (registerType: 'prompt' in
 * vite.config.ts) into a small state machine so a new service worker never
 * takes over the tab — and swaps the cached shell — without the user
 * clicking refresh. See vite.config.ts's registerType comment for why: a
 * silent auto-reload mid-puzzle is the specific failure this avoids.
 *
 * Update checks happen on a timer and whenever the tab regains focus, since
 * relying on Workbox's default (checks once per navigation) would leave a
 * long-lived open tab never noticing a new deploy — the "swap the shell
 * out from under a mid-session user" case is exactly what registerType
 * 'prompt' exists to prevent, but only if a check actually happens.
 */
import { useCallback, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'

const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000 // 1 hour

export type UpdatePromptState = 'idle' | 'needs-refresh' | 'refreshing'

export interface UseUpdatePromptResult {
  state: UpdatePromptState
  refresh: () => void
  dismiss: () => void
}

export function useUpdatePrompt(): UseUpdatePromptResult {
  const [dismissed, setDismissed] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return

      const checkForUpdate = () => {
        void registration.update()
      }

      window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate()
      })
    },
  })

  // A fresh needRefresh (new deploy found) un-dismisses a previously
  // dismissed banner — otherwise dismissing once would hide all future
  // updates for the rest of the session. Adjusted during render (React's
  // recommended pattern for "state that depends on a prop changing")
  // rather than in an effect, which would cost an extra render pass.
  const [prevNeedRefresh, setPrevNeedRefresh] = useState(needRefresh)
  if (needRefresh !== prevNeedRefresh) {
    setPrevNeedRefresh(needRefresh)
    if (needRefresh) setDismissed(false)
  }

  const refresh = useCallback(() => {
    setRefreshing(true)
    void updateServiceWorker(true)
  }, [updateServiceWorker])

  const dismiss = useCallback(() => {
    setDismissed(true)
  }, [])

  let state: UpdatePromptState = 'idle'
  if (refreshing) state = 'refreshing'
  else if (needRefresh && !dismissed) state = 'needs-refresh'

  return { state, refresh, dismiss }
}
