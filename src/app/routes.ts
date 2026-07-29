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
  return entry?.label ?? 'Codoro'
}
