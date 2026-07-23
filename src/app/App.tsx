import { useState } from 'react'
import { ErrorBoundary } from './ErrorBoundary'
import { PracticePage } from './practice/PracticePage'
import { DailyPage } from './daily/DailyPage'
import { Home } from './Home'
import { PwaPrompts } from './pwa/PwaPrompts'
import { AppShell } from './AppShell'
import type { AppMode } from './ModeSwitcher'

const VISITED_KEY = 'codoro:has-visited'

/**
 * A brand-new device's very first launch still boots straight into Practice
 * — the "solving within ~10 seconds" cold-start promise stays intact for a
 * first-time user. Every launch after that opens Home instead. Unlike
 * NavRail's readCollapsed/writeCollapsed (read and write kept as two
 * separate functions, called from different places), this decision has to
 * be made and persisted atomically at boot — there's no later user action
 * to hang a separate write off — so read-and-mark-in-one-pass is
 * deliberate here, not a shortcut. Called once, from useState's lazy
 * initializer, so it runs exactly once per mount.
 */
function resolveBootMode(): AppMode {
  try {
    if (localStorage.getItem(VISITED_KEY) === '1') {
      return 'home'
    }
    localStorage.setItem(VISITED_KEY, '1')
    return 'practice'
  } catch {
    // Safari private browsing (and similar) can throw — worst case every
    // launch looks like a first visit and boots to Practice, which is fine.
    return 'practice'
  }
}

export function App() {
  const [mode, setMode] = useState<AppMode>(resolveBootMode)

  return (
    <ErrorBoundary>
      <AppShell mode={mode} onModeChange={setMode}>
        {mode === 'practice' ? (
          <PracticePage />
        ) : mode === 'daily' ? (
          <DailyPage />
        ) : (
          <Home onNavigate={setMode} />
        )}
      </AppShell>
      <PwaPrompts />
    </ErrorBoundary>
  )
}
