import { lazy, Suspense, useLayoutEffect, useState } from 'react'
import { Route, Switch, useLocation, Link } from 'wouter'
import { ErrorBoundary } from './ErrorBoundary'
import { PwaPrompts } from './pwa/PwaPrompts'
import { AppShell } from './AppShell'
import { useRouteMeta } from './useRouteMeta'

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

type BootMode = 'practice' | 'home'

const bootImporters: Record<BootMode, () => Promise<unknown>> = {
  practice: practiceImporter,
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
 * deliberate here, not a shortcut. Called once, from App's useState lazy
 * initializer, so it runs exactly once per mount.
 */
function resolveBootMode(): BootMode {
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
  const [, navigate] = useLocation()
  useRouteMeta()

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
  const [bootMode] = useState<BootMode | null>(() => {
    if (window.location.pathname !== '/') {
      return null
    }
    const mode = resolveBootMode()
    // Fire the boot mode's chunk fetch immediately, in parallel with the
    // rest of app startup, rather than waiting for Suspense to discover it
    // during the first render.
    void bootImporters[mode]()
    return mode
  })

  // "First-ever visitor" (bootMode === 'practice') and "currently
  // redirecting" are different conditions — bootMode stays 'practice' for
  // this App instance's whole lifetime, but the redirect itself only needs
  // to suppress '/' for the one render before the layout effect below
  // fires. Gating the '/' route on bootMode === 'practice' alone would keep
  // it permanently blank: a later logo click back to '/' still has
  // bootMode === 'practice' (state set once, never reset) but is no longer
  // mid-redirect and should render Home like any other visit.
  const [bootRedirectPending, setBootRedirectPending] = useState(() => bootMode === 'practice')

  // useLayoutEffect (not useEffect) so a first-ever visitor's redirect to
  // /practice is applied before the browser paints — otherwise Home would
  // flash for one frame first. Runs once, on mount only: the boot decision
  // above is already frozen for this app instance.
  useLayoutEffect(() => {
    if (bootMode === 'practice') {
      navigate('/practice', { replace: true })
    }
    // react-hooks/set-state-in-effect assumes setState-in-effect means
    // "derive state from a prop/external source on every relevant change."
    // This is the other legitimate case the rule doesn't model: settling a
    // one-shot boot flag exactly once, synchronously, before paint, from
    // the same effect that performs the redirect it gates — there is no
    // prop/state input to derive this from during render instead.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBootRedirectPending(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <ErrorBoundary>
      <AppShell>
        <Suspense fallback={null}>
          <Switch>
            <Route path="/">
              {/* bootRedirectPending is true for exactly the one render
                  between the initializer above deciding a first-ever
                  visitor belongs on /practice and the layout effect below
                  committing that redirect — Home must not mount (and its
                  lazy() ctor must not fire, which is what actually
                  requests its chunk) for that single frame. */}
              {bootRedirectPending ? null : <Home />}
            </Route>
            <Route path="/practice">
              <PracticePage />
            </Route>
            {/* Same component/chunk as /practice, not a separate route
                target: PracticePage derives whether to show the browse UI
                from the current location (see its own doc comment) rather
                than an internal view value, so it needs to be this same
                element at both paths for React to preserve its session
                state across navigation between them instead of remounting. */}
            <Route path="/browse">
              <PracticePage />
            </Route>
            <Route path="/daily">
              <DailyPage />
            </Route>
            <Route path="/rush">
              <RushPage />
            </Route>
            <Route path="/legal">
              <LegalPage />
            </Route>
            <Route>
              <div className="app-shell__main">
                <p>Nothing here.</p>
                <Link href="/">Back to Codoro</Link>
              </div>
            </Route>
          </Switch>
        </Suspense>
      </AppShell>
      <PwaPrompts />
    </ErrorBoundary>
  )
}
