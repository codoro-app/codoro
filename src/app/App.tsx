import { lazy, Suspense, useLayoutEffect, useState } from 'react'
import { Route, Switch, useLocation } from 'wouter'
import { ErrorBoundary } from './ErrorBoundary'
import { PwaPrompts } from './pwa/PwaPrompts'
import { AppShell } from './AppShell'
import type { AppMode } from './ModeSwitcher'

const VISITED_KEY = 'codoro:has-visited'

// Each mode is its own chunk (and pulls prismjs/framer-motion along with it
// transitively via CodeSnippet/SwipeBinary) so a cold load only pays for the
// mode it actually lands on, not all four. The importer functions are kept
// separate from the lazy() calls so the '/' boot decision's chosen mode can
// be prefetched eagerly below — without that, Suspense wouldn't request the
// chunk until React's first render pass, adding an extra network
// round-trip to the very first paint instead of overlapping it with the
// rest of main.tsx's startup work.
const practiceImporter = () => import('./practice/PracticePage')
const dailyImporter = () => import('./daily/DailyPage')
const rushImporter = () => import('./rush/RushPage')
const homeImporter = () => import('./Home')
const legalImporter = () => import('./legal/LegalPage')

const PracticePage = lazy(async () => ({ default: (await practiceImporter()).PracticePage }))
const DailyPage = lazy(async () => ({ default: (await dailyImporter()).DailyPage }))
const RushPage = lazy(async () => ({ default: (await rushImporter()).RushPage }))
const Home = lazy(async () => ({ default: (await homeImporter()).Home }))
const LegalPage = lazy(async () => ({ default: (await legalImporter()).LegalPage }))

const modeImporters: Record<AppMode, () => Promise<unknown>> = {
  practice: practiceImporter,
  daily: dailyImporter,
  rush: rushImporter,
  home: homeImporter,
  legal: legalImporter,
}

const MODE_PATHS: Record<AppMode, string> = {
  practice: '/practice',
  daily: '/daily',
  rush: '/rush',
  home: '/',
  legal: '/legal',
}

function pathToMode(path: string): AppMode {
  switch (path) {
    case '/practice':
      return 'practice'
    case '/daily':
      return 'daily'
    case '/rush':
      return 'rush'
    case '/legal':
      return 'legal'
    default:
      return 'home'
  }
}

/**
 * A brand-new device's very first launch still boots straight into Practice
 * — the "solving within ~10 seconds" cold-start promise stays intact for a
 * first-time user. Every launch after that opens Home instead. Unlike
 * NavRail's readCollapsed/writeCollapsed (read and write kept as two
 * separate functions, called from different places), this decision has to
 * be made and persisted atomically at boot — there's no later user action
 * to hang a separate write off — so read-and-mark-in-one-pass is
 * deliberate here, not a shortcut. Called once, from App's useState lazy
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
  const [location, navigate] = useLocation()

  // The boot decision only applies to the '/' route, and only for the
  // browser's very first paint of this app instance — not every time '/'
  // is visited. It's computed once here (App itself only mounts once per
  // page load; Route children unmount/remount as the user navigates, but
  // this state doesn't), so clicking the Home logo later to get back to
  // '/' renders Home directly instead of re-triggering the redirect.
  // Deep-linking straight into another route (e.g. /legal) skips this
  // entirely: resolveBootMode's has-visited flag exists solely to decide
  // what '/' shows, and that route's own lazy()/Suspense pair already
  // requests its own chunk without help.
  const [bootMode] = useState<AppMode | null>(() => {
    if (window.location.pathname !== '/') {
      return null
    }
    const mode = resolveBootMode()
    // Fire the boot mode's chunk fetch immediately, in parallel with the
    // rest of app startup, rather than waiting for Suspense to discover it
    // during the first render.
    void modeImporters[mode]()
    return mode
  })

  // useLayoutEffect (not useEffect) so a first-ever visitor's redirect to
  // /practice is applied before the browser paints — otherwise Home would
  // flash for one frame first. Runs once, on mount only: the boot decision
  // above is already frozen for this app instance.
  useLayoutEffect(() => {
    if (bootMode === 'practice') {
      navigate('/practice', { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const mode = pathToMode(location)
  const handleModeChange = (nextMode: AppMode) => {
    navigate(MODE_PATHS[nextMode])
  }

  return (
    <ErrorBoundary>
      <AppShell mode={mode} onModeChange={handleModeChange}>
        <Suspense fallback={null}>
          <Switch>
            <Route path="/">
              <Home onNavigate={handleModeChange} />
            </Route>
            <Route path="/practice">
              <PracticePage />
            </Route>
            <Route path="/daily">
              <DailyPage />
            </Route>
            <Route path="/rush">
              <RushPage />
            </Route>
            <Route path="/legal">
              <LegalPage onNavigate={handleModeChange} />
            </Route>
            <Route>
              <div className="app-shell__main">
                <p>Nothing here.</p>
                <button
                  type="button"
                  onClick={() => {
                    navigate('/')
                  }}
                >
                  Back to Codoro
                </button>
              </div>
            </Route>
          </Switch>
        </Suspense>
      </AppShell>
      <PwaPrompts />
    </ErrorBoundary>
  )
}
