import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AppShell } from './AppShell'
import { FEEDBACK_URL } from './FeedbackLink'
import { nth } from '../test/nth'

const trackRouteView = vi.fn()
const trackFeedbackLinkClicked = vi.fn()

vi.mock('../telemetry', () => ({
  trackRouteView: (...args: unknown[]) => {
    trackRouteView(...args)
  },
  trackPageview: vi.fn(),
  trackFeedbackLinkClicked: (...args: unknown[]) => {
    trackFeedbackLinkClicked(...args)
  },
}))

describe('AppShell', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/practice')
  })

  afterEach(() => {
    vi.clearAllMocks()
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

  // Launch instrumentation Item 2: a third footer link, after Settings and
  // Legal, to the external Tally feedback form — a plain anchor (not a
  // wouter Link), opened in a new tab, never an embed.
  it('the footer has a Feedback link, after Settings and Legal, to the external Tally form', () => {
    render(
      <AppShell>
        <p>page content</p>
      </AppShell>,
    )
    const feedbackLink = screen.getByRole('link', { name: 'Feedback' })
    expect(feedbackLink).toHaveAttribute('href', FEEDBACK_URL)
    expect(feedbackLink).toHaveAttribute('target', '_blank')
    expect(feedbackLink).toHaveAttribute('rel', 'noopener noreferrer')

    // Scoped to the <footer> (role "contentinfo") specifically — Settings
    // also has icon-only links in the mobile top bar and NavRail (see this
    // suite's own "3 settings links" test above), which would otherwise
    // pollute an unscoped query matching on accessible name alone.
    const footerLinks = within(screen.getByRole('contentinfo')).getAllByRole('link')
    expect(footerLinks.map((link) => link.textContent)).toEqual(['Settings', 'Legal', 'Feedback'])
  })

  it('clicking the footer Feedback link fires feedback_link_clicked with surface: "footer"', async () => {
    const user = userEvent.setup()
    render(
      <AppShell>
        <p>page content</p>
      </AppShell>,
    )
    await user.click(screen.getByRole('link', { name: 'Feedback' }))
    expect(trackFeedbackLinkClicked).toHaveBeenCalledWith({ surface: 'footer' })
  })

  // Launch instrumentation Item 1: AppShell is the one component mounted
  // across every navigation, so it's the single place route_view fires from
  // — see useRouteTelemetry.test.tsx for the fire-once/pattern-mapping
  // mechanics in detail; this just proves it's actually wired up here.
  it('fires route_view on mount and again on navigation', async () => {
    const user = userEvent.setup()
    render(
      <AppShell>
        <p>page content</p>
      </AppShell>,
    )
    expect(trackRouteView).toHaveBeenCalledWith({ route: '/practice' })

    await user.click(nth(screen.getAllByRole('link', { name: 'Daily' }), 0))
    expect(trackRouteView).toHaveBeenCalledWith({ route: '/daily' })
  })

  // v4 Phase 4.1 (Settings, for real): the mobile top-bar gear — this bar
  // used to be logo-only. Both navs are always mounted (see this suite's
  // first test), so this counts 3: NavRail's rail-footer gear, the mobile
  // top-bar gear, and the original footer link.
  it('the mobile top bar has a Settings gear link, in addition to NavRail and the footer link', () => {
    render(
      <AppShell>
        <p>page content</p>
      </AppShell>,
    )
    const settingsLinks = screen.getAllByRole('link', { name: 'Settings', hidden: true })
    expect(settingsLinks.length).toBe(3)
    settingsLinks.forEach((link) => expect(link).toHaveAttribute('href', '/settings'))
  })

  it('marks the mobile Settings gear as the active route on /settings', () => {
    window.history.pushState({}, '', '/settings')
    render(
      <AppShell>
        <p>page content</p>
      </AppShell>,
    )
    const settingsLinks = screen.getAllByRole('link', { name: 'Settings', hidden: true })
    expect(settingsLinks.some((link) => link.getAttribute('aria-current') === 'page')).toBe(true)
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

  // v4 SEO audit: most routes had no real <h1> at all — a sr-only one here
  // covers every route in one place instead of retrofitting each page's
  // own loading/error/success branches individually. Skipped on /legal and
  // /settings specifically, since both already render their own real,
  // visible <h1> — see this suite's own describe block below.
  it('renders a sr-only h1 naming the active route, for every route except legal/settings', () => {
    render(
      <AppShell>
        <p>page content</p>
      </AppShell>,
    )
    const heading = screen.getByRole('heading', { level: 1, name: 'Practice', hidden: true })
    expect(heading).toHaveClass('sr-only')
  })

  it('updates the sr-only h1 on navigation, same as the aria-label', async () => {
    const user = userEvent.setup()
    render(
      <AppShell>
        <p>page content</p>
      </AppShell>,
    )
    await user.click(nth(screen.getAllByRole('link', { name: 'Daily' }), 0))
    expect(
      screen.getByRole('heading', { level: 1, name: 'Daily', hidden: true }),
    ).toBeInTheDocument()
  })

  it('does not render its own h1 on /legal or /settings — those pages render their own', () => {
    window.history.pushState({}, '', '/legal')
    const { rerender } = render(
      <AppShell>
        <h1>Terms &amp; privacy</h1>
      </AppShell>,
    )
    expect(screen.getAllByRole('heading', { level: 1, hidden: true }).length).toBe(1)

    window.history.pushState({}, '', '/settings')
    rerender(
      <AppShell>
        <h1>Settings</h1>
      </AppShell>,
    )
    expect(screen.getAllByRole('heading', { level: 1, hidden: true }).length).toBe(1)
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
