/**
 * Shared viewport-fit layout primitive (v3 Phase 2b.1). Renders an optional
 * `header` pinned to the top of the page's scroll container and an optional
 * `stickyAction` pinned to the bottom, with `children` scrolling normally
 * between them. Built on `position: sticky` within the existing page-level
 * scroll (no `overflow: hidden`/fixed-height restructuring of AppShell,
 * `<body>`, or `#root`) so it composes into any existing page without
 * touching the rest of the app's scroll behavior.
 *
 * Neither slot injects `env(safe-area-inset-*)` padding itself — that stays
 * the caller's responsibility on the content it passes in, matching how
 * AppShell.tsx's own mobile nav wrapper already handles its top safe area
 * directly rather than through a shared wrapper. See this plan's own
 * "Design record" (docs/superpowers/plans/2026-08-12-phase-2b1-layout-shell.md)
 * for why.
 *
 * `stickyAction` is unused by Home (2b.1's own proof screen — Home's
 * primary action lives in `header`, not a bottom action) but is the slot
 * 2b.2 will wire Practice/Daily/Rush/Trace/Boss's post-answer "Continue"
 * button into.
 */
import type { ReactNode } from 'react'

export interface PageShellProps {
  /** Pinned to the top of the scroll container. Omit for no pinned header. */
  header?: ReactNode
  /** Pinned to the bottom of the scroll container. Omit for no pinned action. */
  stickyAction?: ReactNode
  /** Scrolls normally between `header` and `stickyAction`. */
  children: ReactNode
  /** Applied to the outermost element — pass layout/sizing classes here. */
  className?: string
}

export function PageShell({ header, stickyAction, children, className }: PageShellProps) {
  return (
    <div className={className}>
      {header !== undefined && (
        <div className="sticky top-0 z-10 pb-3 bg-surface-0 border-b border-border">{header}</div>
      )}
      {children}
      {stickyAction !== undefined && (
        <div className="sticky bottom-[var(--bottom-nav-height)] lg:bottom-0 z-10 pt-3 bg-surface-0 border-t border-border">
          {stickyAction}
        </div>
      )}
    </div>
  )
}

// Layout-shell fix (redesign, 2026-09-17, generalized 2026-09-18): a
// page-shell className that vertically centers short content instead of
// anchoring it to the top — fixes dead space below a puzzle card or start
// screen. First proven on CompetePage.tsx's door-menu screen; this is that
// same fix extracted so any page's own top-level `<div className={...}>`
// can opt in, without touching app.css's shared `.app-shell`/
// `.app-shell__content` grid rules (same constraint the original fix had).
// Not built as a <PageShell> prop: none of Daily/Rush/Missions/Boss/Trace/
// Compete render through the <PageShell> component above (each defines its
// own page-shell classname string and renders a plain <div> directly) — a
// shared classname constant fits that existing convention with a one-line
// swap per page, rather than migrating six pages onto a component they
// don't otherwise use.
//
// Desktop: `.app-shell__content`'s grid row already sizes to the available
// height, so `lg:self-stretch` fills it instead of the grid's default
// `align-items: start` (confirmed in-browser: the grid track's resolved size
// propagates to a stretched item regardless of `.app-shell`'s own height
// coming from `min-height` rather than `height`).
//
// Mobile: naively tried `min-h-full` first, resolving against `<main class=
// "app-shell__content">`'s flex-grown height — this does NOT work (confirmed
// in-browser): CSS's percentage-height resolution requires the containing
// block's height to be "definite", and a block whose own height comes only
// from `min-height` (`.app-shell`'s `min-height: 100dvh`, no `height`) never
// counts as definite for that purpose, however concrete its rendered pixel
// height actually is. The `calc()` below sizes against the viewport
// directly instead (`100dvh`, always definite) minus the two chrome bars
// that actually eat into it: AppShell's mobile top bar (`min-h-11` = 2.75rem
// content height + its own `pt-[var(--space-2)]` + the notch inset it
// clears) and BottomNav (`--bottom-nav-height` + its own bottom safe-area
// inset) — every term here is an existing token or the same `2.75rem`
// tap-target constant already used site-wide (`min-h-11`), not an invented
// value.
//
// This has to be one static string literal, not built via template-literal
// interpolation — Tailwind's build-time class scanner only generates CSS for
// arbitrary-value utilities it can find as a single contiguous token in the
// source text; splitting `min-h-[calc(...)]` across an interpolated
// constant silently produces no CSS at all (confirmed in-browser: the class
// was present in the DOM but no matching rule existed in any stylesheet).
// Every page importing this constant gets the complete literal from this
// one place, so the token stays intact wherever Tailwind's scanner reads it.
export const CENTERED_PAGE_SHELL_CLASS =
  'app-shell__main flex flex-col justify-center gap-4 w-full max-w-[var(--content-width-mobile)] lg:max-w-[var(--content-width-desktop)] mx-auto min-h-[calc(100dvh_-_env(safe-area-inset-top)_-_2.75rem_-_var(--space-2)_-_var(--bottom-nav-height)_-_env(safe-area-inset-bottom))] lg:min-h-0 lg:self-stretch pt-[var(--space-4)] px-4 pb-4'
