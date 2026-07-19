/**
 * Wraps vite-plugin-pwa's `useRegisterSW` (registerType: 'prompt' in
 * vite.config.ts) into a small state machine so a new service worker never
 * takes over the tab — and swaps the cached shell — without the user
 * clicking refresh. See vite.config.ts's registerType comment for why: a
 * silent auto-reload mid-puzzle is the specific failure this avoids.
 *
 * Update checks happen immediately on registration, on a timer, whenever the
 * tab regains focus, and on `pageshow` with `event.persisted` — that last one
 * specifically for iOS: a standalone home-screen PWA is typically suspended
 * rather than terminated when backgrounded/switched away from, so reopening
 * it resumes the frozen page (a bfcache-style restore) rather than a real
 * navigation or `visibilitychange` firing, and `pageshow`/`persisted` is the
 * one signal iOS reliably delivers on that resume. Without an immediate
 * check + this listener, an already-installed iOS PWA can go a full hour (or
 * until the OS itself evicts and cold-launches it) without ever noticing a
 * new deploy.
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

      checkForUpdate()
      window.setInterval(checkForUpdate, UPDATE_CHECK_INTERVAL_MS)
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') checkForUpdate()
      })
      // iOS standalone PWAs are typically suspended (not terminated) when
      // backgrounded, so reopening one resumes it from a bfcache-style
      // snapshot rather than firing a real navigation or (reliably)
      // visibilitychange. `pageshow` with `persisted: true` is the signal
      // iOS does deliver on that resume — see this file's doc comment.
      window.addEventListener('pageshow', (event) => {
        if (event.persisted) checkForUpdate()
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
