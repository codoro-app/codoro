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

// Per-route <title>/meta-description (browser tab + screen readers only —
// unfurl bots don't run JS, so this doesn't touch og:*/twitter:* tags; see
// index.html's own comment and the Phase 1b plan notes for that decision).
// '/' repeats index.html's own static defaults verbatim, so setting it is a
// harmless no-op there rather than a special case to skip.
export interface RouteMetaEntry {
  title: string
  description: string
}

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
  '/browse': {
    title: 'Browse patterns — Codoro',
    description: 'Browse coding puzzles by bug pattern and practice a specific weak spot.',
  },
  '/legal': {
    title: 'Terms & privacy — Codoro',
    description: "Codoro's terms of use and privacy notice.",
  },
}
