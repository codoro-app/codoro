import { lazy, Suspense, useState } from 'react'
import { ErrorBoundary } from './ErrorBoundary'
import { PwaPrompts } from './pwa/PwaPrompts'
import { AppShell } from './AppShell'
import type { AppMode } from './ModeSwitcher'

const VISITED_KEY = 'codoro:has-visited'

// Each mode is its own chunk (and pulls prismjs/framer-motion along with it
// transitively via CodeSnippet/SwipeBinary) so a cold load only pays for the
// mode it actually lands on, not all four. The importer functions are kept
// separate from the lazy() calls so resolveBootMode's chosen mode can be
// prefetched eagerly below — without that, Suspense wouldn't request the
// chunk until React's first render pass, adding an extra network
// round-trip to the very first paint instead of overlapping it with the
// rest of main.tsx's startup work.
const practiceImporter = () => import('./practice/PracticePage')
const dailyImporter = () => import('./daily/DailyPage')
const rushImporter = () => import('./rush/RushPage')
const homeImporter = () => import('./Home')

const PracticePage = lazy(async () => ({ default: (await practiceImporter()).PracticePage }))
const DailyPage = lazy(async () => ({ default: (await dailyImporter()).DailyPage }))
const RushPage = lazy(async () => ({ default: (await rushImporter()).RushPage }))
const Home = lazy(async () => ({ default: (await homeImporter()).Home }))

const modeImporters: Record<AppMode, () => Promise<unknown>> = {
  practice: practiceImporter,
  daily: dailyImporter,
  rush: rushImporter,
  home: homeImporter,
}

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
  const [mode, setMode] = useState<AppMode>(() => {
    const bootMode = resolveBootMode()
    // Fire the boot mode's chunk fetch immediately, in parallel with the
    // rest of app startup, rather than waiting for Suspense to discover it
    // during the first render.
    void modeImporters[bootMode]()
    return bootMode
  })

  return (
    <ErrorBoundary>
      <AppShell mode={mode} onModeChange={setMode}>
        <Suspense fallback={null}>
          {mode === 'practice' ? (
            <PracticePage />
          ) : mode === 'daily' ? (
            <DailyPage />
          ) : mode === 'rush' ? (
            <RushPage />
          ) : (
            <Home onNavigate={setMode} />
          )}
        </Suspense>
      </AppShell>
      <PwaPrompts />
    </ErrorBoundary>
  )
}
