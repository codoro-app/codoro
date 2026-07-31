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
  trace: { path: '/trace', label: 'Trace' },
  legal: { path: '/legal', label: 'Legal' },
} as const

export type RouteKey = keyof typeof ROUTES

// '/' and '/browse' aren't in ROUTES above (they're not NavRail/ModeSwitcher
// entries — see NavRail.tsx and Home.tsx's own doc comments), but they're
// still real pages that need a label for the <main> landmark's aria-label
// (route-change focus management) and, later, a <title>.
export function labelForPath(path: string): string {
  if (path === '/') return 'Home'
  if (path === '/browse') return 'Browse'
  const entry = Object.values(ROUTES).find((route) => route.path === path)
  if (entry) return entry.label
  const dynamicRoute = DYNAMIC_ROUTES.find((route) => route.test(path))
  return dynamicRoute?.label ?? 'Codoro'
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
    redirectsRule: '/puzzle/* /index.html 200',
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
  '/trace': {
    title: 'Trace — Codoro',
    description: 'Step through code one line at a time and predict each variable and output.',
  },
  '/browse': {
    title: 'Browse patterns — Codoro',
    description: 'Browse coding puzzles by bug pattern and practice a specific weak spot.',
  },
  '/legal': {
    title: 'Terms & privacy — Codoro',
    description: "Codoro's terms of use and privacy notice.",
  },
}
