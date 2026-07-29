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
