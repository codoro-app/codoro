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

// Layout-shell centering (redesign, 2026-09-17, generalized 2026-09-18,
// removed 2026-09-18): a `CENTERED_PAGE_SHELL_CLASS` constant lived here —
// `justify-center` + `lg:self-stretch` dead-centered a page's content
// within the full viewport-height column on desktop. Proven on Compete's
// door-menu screen, then applied to Rush and Trace; all three were
// live-confirmed (in-browser) to read as content "sitting lower" on
// screen — total dead space is unchanged, just redistributed above the
// content instead of below it, which looks wrong rather than fixed. All
// three reverted to the plain top-anchored shell the same day. If a real
// fix for the "dead space below short content" problem is attempted again,
// it needs a different mechanism than whole-viewport centering — a capped
// max top-offset, or anchoring near the top with extra bottom padding —
// not this one.
