import { lazy, Suspense, useLayoutEffect, useState } from 'react'
import { Route, Switch, useLocation, Link } from 'wouter'
import { ErrorBoundary } from './ErrorBoundary'
import { PwaPrompts } from './pwa/PwaPrompts'
import { AppShell } from './AppShell'
import { useRouteMeta } from './useRouteMeta'
// Static import, not lazy() — mirrors devPuzzleMode.ts's own proven pattern:
// import.meta.env.DEV is a Vite build-time constant, inlined as literal
// `false` in a production build, so Rollup can dead-code-eliminate the
// `import.meta.env.DEV && <Route>...</Route>` branch below — and everything
// only reachable from it, including this whole component — rather than
// leaving it as a real, if unreachable, code-split chunk in dist/. Verified
// by grepping dist/ after a production build, not just by reasoning about
// it (see the Phase 2 go/no-go amendment).
import { ScrubberDebugPage } from './devTools/ScrubberDebugPage'

const VISITED_KEY = 'codoro:has-visited'

// Confirmed live on production (see the Phase 1b build-plan amendment): a
// hosting-level redirect rewrites a direct load of a real route (e.g.
// /puzzle/<id>) to bare '/', discarding the original path before this app
// ever boots — the boot redirect below then sends a first-ever visitor to
// /practice with no trace anything else was ever requested. Client code
// cannot recover a path that's already gone, but it CAN honor one an
// upstream redirect chooses to preserve as a query param instead of
// discarding it. This is that receiving end: strictly same-origin (must
// start with exactly one '/' — rejects a protocol-relative '//host/evil' or
// absolute URL, which would otherwise turn this into an open redirect).
// Wiring the actual hosting-level redirect to populate this param is a
// follow-up outside this repo.
const REDIRECT_PARAM = 'redirect'

function resolveIntendedPath(): string | null {
  if (window.location.pathname !== '/') return null
  const target = new URLSearchParams(window.location.search).get(REDIRECT_PARAM)
  if (!target) return null
  // Resolve against the real origin and compare origins, rather than
  // pattern-matching the raw string: a regex like /^\/(?!\/)/ looks like it
  // rejects a protocol-relative '//host', but WHATWG URL parsing treats a
  // backslash the same as a forward slash for special schemes, so
  // '/\\evil.com' also resolves to a different origin while still passing
  // that regex — confirmed via new URL(), not assumed.
  let resolved: URL
  try {
    resolved = new URL(target, window.location.origin)
  } catch {
    return null
  }
  if (resolved.origin !== window.location.origin) return null
  const intended = resolved.pathname + resolved.search + resolved.hash
  // The origin check above isn't sufficient on its own: a target like
  // '/..//evil.com' has its leading '/..' popped by WHATWG path
  // normalization, leaving pathname === '//evil.com' with the origin
  // unchanged — so the check above passes even though the result violates
  // this function's own invariant (must start with exactly one '/').
  // Validate the value actually being returned, not just the parsed origin.
  if (intended.startsWith('//')) return null
  return intended
}

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
const traceImporter = () => import('./trace/TracePage')
const homeImporter = () => import('./Home')
const legalImporter = () => import('./legal/LegalPage')
const puzzleImporter = () => import('./puzzle/PuzzlePage')

const PracticePage = lazy(async () => ({ default: (await practiceImporter()).PracticePage }))
const DailyPage = lazy(async () => ({ default: (await dailyImporter()).DailyPage }))
const RushPage = lazy(async () => ({ default: (await rushImporter()).RushPage }))
const TracePage = lazy(async () => ({ default: (await traceImporter()).TracePage }))
const Home = lazy(async () => ({ default: (await homeImporter()).Home }))
const LegalPage = lazy(async () => ({ default: (await legalImporter()).LegalPage }))
const PuzzlePage = lazy(async () => ({ default: (await puzzleImporter()).PuzzlePage }))

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
  // Computed once, alongside bootMode below: an intended path recovered from
  // ?redirect= takes priority over the normal first-visit decision (and,
  // like bootMode, must not itself consume resolveBootMode's has-visited
  // flag — recovering from an upstream redirect isn't a real "first visit").
  const [intendedPath] = useState(resolveIntendedPath)

  const [bootMode] = useState<BootMode | null>(() => {
    if (window.location.pathname !== '/' || intendedPath !== null) {
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
  // mid-redirect and should render Home like any other visit. intendedPath
  // pending-gates the same way, for the same reason.
  const [bootRedirectPending, setBootRedirectPending] = useState(
    () => bootMode === 'practice' || intendedPath !== null,
  )

  // useLayoutEffect (not useEffect) so a first-ever visitor's redirect to
  // /practice is applied before the browser paints — otherwise Home would
  // flash for one frame first. Runs once, on mount only: the boot decision
  // above is already frozen for this app instance.
  useLayoutEffect(() => {
    if (intendedPath !== null) {
      navigate(intendedPath, { replace: true })
    } else if (bootMode === 'practice') {
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
            <Route path="/trace">
              <TracePage />
            </Route>
            <Route path="/legal">
              <LegalPage />
            </Route>
            {/* v2 Phase 1b: the app's first dynamic route (wouter's ':id'
                param syntax) — see routes.ts's DYNAMIC_ROUTES doc comment
                for why this can't reuse ROUTE_META's literal-keyed shape,
                and public/_redirects + vite.config.ts's SW denylist for the
                two other registries this route had to be taught to. */}
            <Route path="/puzzle/:id">
              <PuzzlePage />
            </Route>
            {import.meta.env.DEV && (
              <Route path="/dev/scrubber">
                <ScrubberDebugPage />
              </Route>
            )}
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
