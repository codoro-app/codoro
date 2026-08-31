/**
 * Single source of truth for the top-level route paths and their nav
 * labels, so NavRail/ModeSwitcher/AppShell/Home don't each hardcode their
 * own copy of e.g. '/practice' and drift from each other or from the
 * per-route <title>/meta table (see useRouteMeta.ts).
 */
export const ROUTES = {
  practice: { path: '/practice', label: 'Practice' },
  daily: { path: '/daily', label: 'Daily' },
  rush: { path: '/rush', label: 'Rush' },
  boss: { path: '/boss', label: 'Boss' },
  trace: { path: '/trace', label: 'Trace' },
  missions: { path: '/missions', label: 'Missions' },
  stats: { path: '/stats', label: 'Stats' },
  legal: { path: '/legal', label: 'Legal' },
  // Phase 7: a real ROUTES entry so every consumer references
  // ROUTES.settings.path type-safely. v4 Phase 4.1 gave Settings a real
  // nav presence (a gear icon in NavRail's rail footer and AppShell's
  // mobile top bar, both below) on top of the original footer link
  // (alongside Legal) — see AppShell.tsx/NavRail.tsx.
  settings: { path: '/settings', label: 'Settings' },
} as const

export type RouteKey = keyof typeof ROUTES

// '/', '/browse', and '/challenge' aren't in ROUTES above (they're not
// NavRail/ModeSwitcher entries — see NavRail.tsx and Home.tsx's own doc
// comments; /challenge is a link-only route with no in-app navigation into
// it, per Phase 5c), but they're still real pages that need a label for the
// <main> landmark's aria-label (route-change focus management) and, later,
// a <title>.
export function labelForPath(path: string): string {
  if (path === '/') return 'Home'
  if (path === '/browse') return 'Browse'
  if (path === '/challenge') return 'Challenge'
  const entry = Object.values(ROUTES).find((route) => route.path === path)
  if (entry) return entry.label
  const dynamicRoute = DYNAMIC_ROUTES.find((route) => route.test(path))
  return dynamicRoute?.label ?? 'Codoro'
}

// Launch instrumentation (route_view event, src/telemetry/events.ts): the
// single constant reported for any path that resolves to none of the cases
// below — never the raw pathname itself, since an unrecognized path is by
// definition not one of this table's known, PII-free patterns.
const UNKNOWN_ROUTE_PATTERN = 'unknown'

/**
 * Maps a real pathname to its route PATTERN for the `route_view` telemetry
 * event (src/telemetry/events.ts's trackRouteView) — deliberately never the
 * raw pathname itself. Two routes carry real per-visit data in a raw path
 * that must never reach PostHog: `/puzzle/<id>` (a real puzzle id) and
 * `/challenge` (which — unlike every other route here — encodes challenge
 * payload data; wouter's useLocation() already returns pathname alone, with
 * no query string or hash, but this function goes one step further and
 * always returns one of this table's own literal pattern strings, never
 * anything derived from the live URL). Mirrors labelForPath's own
 * ROUTES/DYNAMIC_ROUTES lookup order and cases, returning the wouter route
 * pattern (e.g. '/puzzle/:id') instead of a display label. An unrecognized
 * path reports UNKNOWN_ROUTE_PATTERN, never the raw string.
 */
export function routePatternForPath(path: string): string {
  if (path === '/') return '/'
  if (path === '/browse') return '/browse'
  if (path === '/challenge') return '/challenge'
  const entry = Object.values(ROUTES).find((route) => route.path === path)
  if (entry) return entry.path
  const dynamicRoute = DYNAMIC_ROUTES.find((route) => route.test(path))
  return dynamicRoute?.pattern ?? UNKNOWN_ROUTE_PATTERN
}

// Per-route <title>/meta-description (browser tab + screen readers only —
// unfurl bots don't run JS, so this doesn't touch og:*/twitter:* tags; see
// index.html's own comment and the Phase 1b plan notes for that decision).
// '/' repeats index.html's own static defaults verbatim, so setting it is a
// harmless no-op there rather than a special case to skip.
export interface RouteMetaEntry {
  title: string
  description: string
}

// Dynamic routes (a wouter ':param' pattern) don't fit ROUTE_META's
// Record<string, ...> shape keyed by one literal, matchable path — there is
// no single literal string to key `/puzzle/:id` by, and its _redirects rule
// is a glob ('/puzzle/*'), not a string Cloudflare could match wouter's
// ':id' syntax against (it doesn't understand that syntax at all). Kept as
// its own explicit list, not folded into ROUTE_META, so routes.test.ts's
// drift guard can assert against each dynamic route's own `redirectsRule`
// instead of either mis-deriving one from `pattern` or silently skipping
// dynamic routes altogether — the "add a route and forget _redirects and a
// test goes red" property (see routes.test.ts) has to keep holding here too.
export interface DynamicRouteMetaEntry {
  /** wouter route pattern, e.g. '/puzzle/:id' — used in App.tsx's <Route>. */
  pattern: string
  /** Matches a real pathname against this dynamic route. Deliberately excludes a bare '/puzzle/' (no id) and any nested sub-path — those fall through to the app's ordinary not-found catch-all instead of this route. */
  test: (pathname: string) => boolean
  /** Literal public/_redirects line this route needs. */
  redirectsRule: string
  label: string
  title: string
  description: string
}

const PUZZLE_ID_PATH = /^\/puzzle\/[^/]+$/

export const DYNAMIC_ROUTES: readonly DynamicRouteMetaEntry[] = [
  {
    pattern: '/puzzle/:id',
    test: (pathname) => PUZZLE_ID_PATH.test(pathname),
    redirectsRule: '/puzzle/* / 200',
    label: 'Puzzle',
    title: 'Puzzle — Codoro',
    description: 'Solve a shared Codoro puzzle.',
  },
]

export const ROUTE_META: Record<string, RouteMetaEntry> = {
  '/': {
    title: 'Codoro — Daily coding puzzles',
    description:
      'A new bug-spotting puzzle every day, calibrated to your rating. Keep your streak alive.',
  },
  '/practice': {
    title: 'Practice — Codoro',
    description: 'Endless rating-matched coding puzzles, one bug at a time.',
  },
  '/daily': {
    title: 'Daily — Codoro',
    description:
      'A new bug-spotting puzzle every day, calibrated to your rating. Keep your streak alive.',
  },
  '/rush': {
    title: 'Rush — Codoro',
    description: "Escalating coding puzzles — three strikes and you're out.",
  },
  '/boss': {
    title: 'Boss — Codoro',
    description: 'Ten hand-picked puzzles, escalating difficulty — three strikes and the run ends.',
  },
  '/trace': {
    title: 'Trace — Codoro',
    description: 'Step through code one line at a time and predict each variable and output.',
  },
  '/missions': {
    title: 'Missions — Codoro',
    description: 'Trace, Speed, and Boss chained into one directed run, ending in a payoff screen.',
  },
  '/stats': {
    title: 'Stats — Codoro',
    description: 'Your rating history, pattern accuracy, and activity — all in one place.',
  },
  '/browse': {
    title: 'Browse patterns — Codoro',
    description: 'Browse coding puzzles by bug pattern and practice a specific weak spot.',
  },
  '/legal': {
    title: 'Terms & privacy — Codoro',
    description: "Codoro's terms of use and privacy notice.",
  },
  '/challenge': {
    title: 'Challenge — Codoro',
    description: 'Beat a friend’s time on a shared Codoro challenge.',
  },
  '/settings': {
    title: 'Settings — Codoro',
    description: 'Export or import your Codoro data, and manage your local progress.',
  },
}
