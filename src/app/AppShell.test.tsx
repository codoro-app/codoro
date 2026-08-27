import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppShell } from './AppShell'
import { nth } from '../test/nth'

describe('AppShell', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/practice')
  })

  it('renders both the mobile BottomNav and the desktop NavRail (visibility is CSS-only)', () => {
    render(
      <AppShell>
        <p>page content</p>
      </AppShell>,
    )
    // `hidden: true` below: both navs are always mounted — only CSS (media
    // queries) decides which is visible at a given viewport — and jsdom's
    // own default viewport width happens to sit exactly on this shell's
    // 1024px breakpoint, making CSS-computed accessibility-tree visibility
    // here nondeterministic across runs. These assertions are about DOM
    // structure ("both navs exist"), not about which one a real browser
    // would currently show, so they deliberately opt out of visibility
    // filtering instead of depending on that timing.
    //
    // BottomNav (mobile) is named "Primary", not "Mode" — it includes Home
    // and Stats alongside the mode routes, so "Mode" would undersell it.
    // NavRail (desktop) keeps its existing "Mode" label unchanged.
    expect(screen.getByRole('navigation', { name: 'Primary', hidden: true })).toBeInTheDocument()
    expect(screen.getByRole('navigation', { name: 'Mode', hidden: true })).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: 'Practice', hidden: true }).length).toBe(2)
  })

  // v4 Phase 4.0 follow-up (PR #88 review): live-reported that tabbing out
  // of the puzzle (e.g. to the footer) left no fast way back in — a
  // keyboard user had to Tab/Shift+Tab through all of NavRail again. This
  // skip link is the standard fix: the first tab stop on any page, so
  // cycling back around (or a first Tab press on load) reaches it before
  // NavRail's 7 links, and it jumps straight into <main>.
  it('is the first focusable element and points at <main> for a fast way back into content', () => {
    render(
      <AppShell>
        <p>page content</p>
      </AppShell>,
    )
    const skipLink = screen.getByRole('link', { name: 'Skip to main content' })
    expect(skipLink).toHaveAttribute('href', '#main-content')
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content')

    // "First focusable" asserted structurally: this link must be the very
    // first focusable element in the whole shell, ahead of every NavRail/
    // BottomNav/mobile-topbar link — not just present somewhere on the
    // page. querySelectorAll's DOM order matches tab order here since
    // nothing in this tree sets a positive tabindex.
    const focusable = document.querySelectorAll('a[href], button:not([disabled])')
    expect(focusable[0]).toBe(skipLink)
  })

  it('renders children inside the shell content region', () => {
    render(
      <AppShell>
        <p>page content</p>
      </AppShell>,
    )
    expect(screen.getByText('page content')).toBeInTheDocument()
  })

  it('the Daily link from either nav navigates to /daily', async () => {
    const user = userEvent.setup()
    render(
      <AppShell>
        <p>page content</p>
      </AppShell>,
    )
    await user.click(nth(screen.getAllByRole('link', { name: 'Daily' }), 0))
    expect(window.location.pathname).toBe('/daily')
  })

  it('the logo/brand links home from the mobile bar, the bottom nav, and the desktop rail', () => {
    render(
      <AppShell>
        <p>page content</p>
      </AppShell>,
    )
    // Mobile topbar's brand link carries visible "Codoro" text next to the
    // logo mark, so its accessible name must contain that text (WCAG
    // 2.5.3) — aria-label="Codoro — Home" replaces the old label-content
    // mismatch (aria-label="Home" alone, visible text "Codoro") flagged by
    // Lighthouse's label-content-name-mismatch audit. BottomNav's Home tab
    // and NavRail's logo are icon-only (no visible text label), so WCAG
    // 2.5.3 doesn't apply to them — they keep their plain aria-label="Home".
    const topbarBrandLink = screen.getByRole('link', { name: 'Codoro — Home', hidden: true })
    expect(topbarBrandLink).toHaveAttribute('href', '/')

    const homeLinks = screen.getAllByRole('link', { name: 'Home', hidden: true })
    expect(homeLinks.length).toBe(2)
    homeLinks.forEach((link) => {
      expect(link).toHaveAttribute('href', '/')
    })
  })

  it('the footer link goes to /legal', () => {
    render(
      <AppShell>
        <p>page content</p>
      </AppShell>,
    )
    expect(screen.getByRole('link', { name: 'Legal' })).toHaveAttribute('href', '/legal')
  })

  // Regression test: <main> gets a programmatic .focus() on every route
  // change (see useRouteFocusAndScroll above) with tabIndex={-1}, so it's
  // never in the sighted tab order — but with no outline suppression, the
  // browser's default focus ring still renders as a stray line at the top
  // of <main> (originally observed right under the old top mobile nav bar;
  // BottomNav's move to the bottom doesn't change this — <main> itself is
  // still the element receiving focus) on every route change. jsdom doesn't
  // compute Tailwind's CSS, so this asserts the suppressing utility class is
  // present rather than the resulting computed style.
  it('suppresses the default focus ring on <main> (it is never in the sighted tab order)', () => {
    render(
      <AppShell>
        <p>page content</p>
      </AppShell>,
    )
    expect(screen.getByRole('main')).toHaveClass('focus:outline-none')
  })

  it('labels the main landmark with the active route, and does not steal focus on initial render', () => {
    render(
      <AppShell>
        <p>page content</p>
      </AppShell>,
    )
    expect(screen.getByRole('main')).toHaveAttribute('aria-label', 'Practice')
    expect(document.activeElement).not.toBe(screen.getByRole('main'))
  })

  it('a Link-driven navigation moves focus to <main> and resets scroll to top', async () => {
    const user = userEvent.setup()
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    render(
      <AppShell>
        <p>page content</p>
      </AppShell>,
    )

    await user.click(nth(screen.getAllByRole('link', { name: 'Daily' }), 0))

    expect(document.activeElement).toBe(screen.getByRole('main'))
    expect(screen.getByRole('main')).toHaveAttribute('aria-label', 'Daily')
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0 })

    scrollToSpy.mockRestore()
  })

  it('a back/forward (popstate) navigation moves focus but does not reset scroll — the browser restores it', async () => {
    const user = userEvent.setup()
    const scrollToSpy = vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined)
    render(
      <AppShell>
        <p>page content</p>
      </AppShell>,
    )

    // Real history entry (via the Link click's pushState), so history.back()
    // below is a genuine back navigation — not another synthetic pushState —
    // and fires a native popstate event the same way a real back-button
    // press would, with no pushState/replaceState involved.
    await user.click(nth(screen.getAllByRole('link', { name: 'Daily' }), 0))
    expect(scrollToSpy).toHaveBeenCalledWith({ top: 0 })
    scrollToSpy.mockClear()
    screen.getByRole('main').blur()

    window.history.back()
    await waitFor(() => {
      expect(window.location.pathname).toBe('/practice')
    })

    expect(scrollToSpy).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(screen.getByRole('main'))

    scrollToSpy.mockRestore()
  })
})

describe('AppShell — full-height layout contract (CLS regression, 2026-08-24 perf pass)', () => {
  // jsdom doesn't compute real CSS layout or media queries, so this can't
  // assert "the footer never moves" via computed style the way a real
  // browser (or `pnpm perf:lighthouse`) can. It instead asserts app.css
  // itself still declares the full-height contract that keeps the footer
  // pinned below the fold regardless of <main>'s content height — see
  // app.css's own comment for the mechanism. This only catches someone
  // silently deleting/reordering the rule that makes that true; the real
  // verification is `pnpm perf:lighthouse` reporting zero layout-shifts
  // items on /practice.
  it('declares .app-shell as a full-height column at every width, with <main> growing to fill it', () => {
    const cssPath = join(dirname(fileURLToPath(import.meta.url)), 'app.css')
    const css = readFileSync(cssPath, 'utf-8').replace(/\s+/g, ' ')

    expect(css).toContain(
      '.app-shell { display: flex; flex-direction: column; min-height: 100dvh; }',
    )
    // .app-shell__content's rule now also carries `grid-area: content;`
    // (v4 Phase 4.0 sticky-nav follow-up, PR #88 review) plus an
    // explanatory comment, so the old exact-block match no longer applies
    // — assert the two properties that make this contract true instead.
    const contentRuleMatch = /\.app-shell__content \{([^}]*)\}/.exec(css)
    expect(contentRuleMatch).not.toBeNull()
    const contentRule = contentRuleMatch?.[1] ?? ''
    expect(contentRule).toContain('flex: 1 0 auto;')
    expect(css).toContain('grid-template-rows: 1fr auto;')
  })
})
