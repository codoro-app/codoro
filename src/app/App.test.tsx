import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { nth } from '../test/nth'
import { loadProfile } from '../storage'

const appTsxPath = join(dirname(fileURLToPath(import.meta.url)), 'App.tsx')

vi.mock('../storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../storage')>()
  return {
    ...actual,
    // firstRunCompleted: true — this suite tests App-level ROUTING, not the
    // first-run sequence content (that's useFirstRunSession.test.ts's own
    // job); a real fresh profile would otherwise route '/' into
    // FirstRunSequence instead of normal Home content, which every
    // navigation test below assumes. Same "returning-user default" fixture
    // convention Home.test.tsx's own baseProfile() uses.
    loadProfile: vi.fn(() =>
      Promise.resolve({ ...actual.createDefaultProfile(), firstRunCompleted: true }),
    ),
    saveProfile: vi.fn(() => Promise.resolve(undefined)),
    appendAttempt: vi.fn(() => Promise.resolve(undefined)),
    listAttempts: vi.fn(() => Promise.resolve([])),
  }
})

vi.mock('../telemetry', () => ({
  trackAttempt: vi.fn(),
  trackRushAttempt: vi.fn(),
  trackRushRunEnd: vi.fn(),
  trackTraceAttempt: vi.fn(),
  trackPuzzleLinkView: vi.fn(),
  trackPuzzleLinkAttempt: vi.fn(),
  trackShareClick: vi.fn(),
  trackError: vi.fn(),
  // AppShell is always in this test's render tree (App.tsx wraps every
  // route in it) and calls both of these unconditionally — useRouteTelemetry
  // on every render, FeedbackLink.tsx's onClick if a footer/settings
  // Feedback link is ever clicked — so both need a real vi.fn() here, not
  // just the events this suite's own assertions care about.
  trackRouteView: vi.fn(),
  trackPageview: vi.fn(),
  trackFeedbackLinkClicked: vi.fn(),
}))

// vite-plugin-pwa only generates the real 'virtual:pwa-register/react' module
// for an actual dev server or build — stub it here so App.test.tsx doesn't
// depend on that machinery. useUpdatePrompt.test.ts covers the hook itself.
vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, vi.fn()],
    updateServiceWorker: vi.fn(() => Promise.resolve()),
  }),
}))

const { App } = await import('./App')

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    // wouter's default browser location hook reads the real window.location,
    // which (unlike component state) survives across tests in this file —
    // a previous test's navigation would otherwise leak into the next
    // test's initial render. Reset to '/' so every test starts from the
    // same boot URL the real app would.
    window.history.pushState({}, '', '/')
  })

  it('renders the practice UI inside the ErrorBoundary wrapper (no placeholder copy)', async () => {
    render(<App />)

    // Guards against the original stub landing page copy.
    expect(screen.queryByText(/coding puzzles for spotting bugs/i)).not.toBeInTheDocument()

    // Real content pool + a fresh default profile: the rating pill renders
    // the starting rating once usePracticeSession finishes loading.
    await waitFor(() => {
      expect(screen.getByText('1200')).toBeInTheDocument()
    })

    // The first test in this file absorbs the whole-App module import plus
    // the real content pool's glob transform, which under a concurrent
    // full-suite run (82 files transforming at once) has repeatedly blown
    // the default 5s test bound even though the file passes in isolation —
    // same under-load flake class as traceGen's 2s child-process timeout.
    // 15s gives the cold first mount real room while still failing on a
    // genuine hang.
  }, 15_000)

  it('boots into Home, and switches to the Daily UI via the mode switcher', async () => {
    const user = userEvent.setup()
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('1200')).toBeInTheDocument()
    })

    // AppShell mounts both ModeSwitcher (mobile) and NavRail (desktop)
    // unconditionally — CSS alone decides which is visible — so both have a
    // "Daily" link; either one navigates, per Step 17's guidance.
    await user.click(nth(screen.getAllByRole('link', { name: 'Daily' }), 0))

    await waitFor(() => {
      expect(screen.getByText(/Codoro Daily #/)).toBeInTheDocument()
    })
  })

  it('switches to the Rush UI via the mode switcher', async () => {
    const user = userEvent.setup()
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('1200')).toBeInTheDocument()
    })

    await user.click(nth(screen.getAllByRole('link', { name: 'Rush' }), 0))

    await waitFor(() => {
      expect(screen.getByRole('status', { name: /0 of 3 strikes/i })).toBeInTheDocument()
    })
  })

  it('switches to the Trace UI via the mode switcher', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)

    await waitFor(() => {
      expect(screen.getByText('1200')).toBeInTheDocument()
    })

    await user.click(nth(screen.getAllByRole('link', { name: 'Trace' }), 0))

    // Real content (not mocked in this file), so a served puzzle's own
    // prompt text is unpredictable — assert on TraceRunner's own root
    // element instead, same container-query pattern the boot-mode test
    // above uses for '.practice-page'.
    await waitFor(() => {
      expect(container.querySelector('.trace-runner')).toBeInTheDocument()
    })
  })

  it('renders a real bundled puzzle directly at /puzzle/<id> (v2 Phase 1b shareable link)', async () => {
    window.history.pushState({}, '', '/puzzle/con-005')
    const { container } = render(<App />)

    await waitFor(() => {
      expect(container.querySelector('.puzzle-card')).toBeInTheDocument()
    })
    expect(screen.getByRole('link', { name: /practice more like this/i })).toBeInTheDocument()
  })

  it('shows a real not-found state for /puzzle/<unknown-id>, not a crash', async () => {
    window.history.pushState({}, '', '/puzzle/not-a-real-puzzle-id')
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText(/couldn.t find that puzzle/i)).toBeInTheDocument()
    })
  })

  it("boots straight into Home on a device's first-ever visit", async () => {
    const { container } = render(<App />)

    await waitFor(() => {
      expect(screen.getByText('1200')).toBeInTheDocument()
    })

    // Practice and Home both show "1200" for a fresh default profile (Home's
    // hero rating and Practice's status pill), so that text alone can't
    // disambiguate which one actually rendered — checking each page's own
    // root container can.
    expect(container.querySelector('.home')).toBeInTheDocument()
    expect(container.querySelector('.practice-page')).not.toBeInTheDocument()
  })

  it('boots straight into Home on every visit after the first too', async () => {
    // A legacy 'codoro:has-visited' flag (written by the old first-visit
    // boot logic) must not change anything now that '/' always renders
    // Home regardless of this value.
    localStorage.setItem('codoro:has-visited', '1')

    render(<App />)

    expect(screen.queryByText(/loading your practice session/i)).not.toBeInTheDocument()
    await screen.findByText('Practice', { selector: '.home__card-title' })
  })

  it("prefetches Home's chunk from inside a lazy useState initializer, not an effect (loses its head start on first paint otherwise)", () => {
    const source = readFileSync(appTsxPath, 'utf-8')
    const initializerMatch =
      /useState\(\(\) => \{[\s\S]*?void homeImporter\(\)[\s\S]*?\n {2}\}\)/.exec(source)
    expect(initializerMatch).not.toBeNull()

    // The same call must not also live inside a useEffect/useLayoutEffect —
    // that would delay the request until after the first commit instead of
    // overlapping it with app startup.
    const effectBodies = [
      ...source.matchAll(/use(?:Layout)?Effect\(\(\) => \{[\s\S]*?\n {2}\}, \[/g),
    ]
    for (const match of effectBodies) {
      expect(match[0]).not.toMatch(/homeImporter/)
    }
  })

  it("honors a same-origin ?redirect= param on '/' instead of the normal Home landing", async () => {
    window.history.pushState({}, '', '/?redirect=%2Flegal')

    render(<App />)

    await waitFor(() => {
      expect(window.location.pathname).toBe('/legal')
    })
    await screen.findByText('Terms & privacy', { selector: '.legal-page__title' })
  })

  it('ignores a protocol-relative ?redirect= value (open-redirect guard) and falls back to Home', async () => {
    window.history.pushState({}, '', '/?redirect=%2F%2Fevil.example.com')

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('1200')).toBeInTheDocument()
    })
    expect(window.location.pathname).toBe('/')
  })

  it('ignores a backslash-disguised cross-origin ?redirect= value — a regex like /^\\/(?!\\/)/ would wrongly admit this, since WHATWG URL parsing treats a leading backslash the same as a second forward slash', async () => {
    window.history.pushState({}, '', '/?redirect=%2F%5Cevil.example.com')

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('1200')).toBeInTheDocument()
    })
    expect(window.location.pathname).toBe('/')
  })

  // A second bypass of the same guard: new URL('/..//evil.com', origin)'s
  // WHATWG path normalization pops the leading '/..', leaving
  // pathname === '//evil.com' with the origin unchanged — so the origin
  // check alone passes even though the result is protocol-relative. Each
  // of these must fall back to Home, same as the protocol-relative and
  // backslash cases above.
  it.each([
    ['/..//evil.com', 'a dot-dot-collapsed protocol-relative value'],
    ['/..//..//evil.com', 'a repeated dot-dot-collapsed protocol-relative value'],
    ['/%2e%2e//evil.com', 'a percent-encoded dot-dot-collapsed protocol-relative value'],
  ])('ignores %s (%s) and falls back to Home', async (target) => {
    window.history.pushState({}, '', `/?redirect=${encodeURIComponent(target)}`)

    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('1200')).toBeInTheDocument()
    })
    expect(window.location.pathname).toBe('/')
  })

  it('boots into Home directly, and can navigate to Practice from there', async () => {
    const user = userEvent.setup()
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('1200')).toBeInTheDocument()
    })

    await user.click(nth(screen.getAllByRole('link', { name: 'Home', hidden: true }), 0))

    // Home's own "Practice" card, not NavRail's nav-rail__item of the same
    // name (both are present at once, so name-based queries are ambiguous —
    // scope by the card's title text, same closest-link pattern this
    // codebase already uses for mastery rows).
    const practiceCard = await screen.findByText('Practice', { selector: '.home__card-title' })
    await user.click(practiceCard.closest('a') as HTMLElement)

    // Back on Practice: usePracticeSession remounts and reloads (mocked
    // loadProfile resolves a fresh default profile each call), so the same
    // rating-pill signal the first test uses confirms we're really there.
    await waitFor(() => {
      expect(screen.getByText('1200')).toBeInTheDocument()
    })
  })

  it('navigating /practice -> /browse -> /practice does not remount the practice session (Browse extraction regression guard)', async () => {
    const user = userEvent.setup()
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('1200')).toBeInTheDocument()
    })

    // App now boots into Home at '/' — navigate into Practice first so this
    // test's real subject (the /practice <-> /browse history-stack guard)
    // has a /practice entry on the stack to push Browse on top of. Waiting
    // directly on the Browse-patterns link (rather than "1200" again, or
    // '.practice-page'): "1200" is ambiguous between Home and Practice, and
    // '.practice-page' is on PracticePage's loading-state shell too — the
    // link only exists once the session has actually finished loading, so
    // it's the one signal that's both unambiguous and what this test needs
    // next anyway.
    await user.click(nth(screen.getAllByRole('link', { name: 'Practice' }), 0))
    const browseLink = await screen.findByRole('link', { name: /browse patterns/i })
    expect(window.location.pathname).toBe('/practice')

    // usePracticeSession's mount effect is the only thing that calls
    // loadProfile — a remount (state reset) would call it again, which is
    // exactly what App.tsx's doc comment on PracticePage's two <Route>
    // entries claims won't happen: both /practice and /browse render the
    // same PracticePage element at the same Switch position, so React
    // updates it in place across the navigation instead of unmounting it.
    const loadCallsBeforeBrowse = vi.mocked(loadProfile).mock.calls.length

    await user.click(browseLink)
    expect(window.location.pathname).toBe('/browse')

    await user.click(screen.getByRole('button', { name: /back/i }))
    expect(window.location.pathname).toBe('/practice')

    await waitFor(() => {
      expect(screen.getByText('1200')).toBeInTheDocument()
    })
    expect(vi.mocked(loadProfile).mock.calls.length).toBe(loadCallsBeforeBrowse)

    // Regression guard for the history-stack bug this test's name calls
    // out: entering Browse is a push, but PatternPicker's onSelect/onBack
    // must be a *replace*, not another push — otherwise the stack reads
    // /practice -> /browse -> /practice and a real browser Back lands the
    // user back on /browse instead of wherever they were before opening
    // Browse. window.history.back() (not another wouter navigate call) is
    // used here so this is a genuine back-button press firing a native
    // popstate event, the same real-history-entry approach AppShell.test.tsx
    // uses for its own back/forward test. The stack at this point reads
    // '/' -> '/practice' -> '/browse': the initial render lands on '/'
    // directly (no boot redirect anymore) and clicking into Practice above
    // is this test's own one push onto that, so entering Browse was the
    // only other push — back() must therefore land on '/practice' again,
    // not '/browse'.
    // jsdom's history.back() resolves the navigation asynchronously (a
    // popstate event, like a real back-button press), so a plain waitFor()
    // on a negative assertion ("not /browse") would trivially pass before
    // the navigation has actually happened — this awaits the real
    // popstate event first, so the assertion below reflects where back()
    // actually landed.
    const popstatePromise = new Promise<void>((resolve) => {
      window.addEventListener(
        'popstate',
        () => {
          resolve()
        },
        { once: true },
      )
    })
    window.history.back()
    await popstatePromise
    expect(window.location.pathname).not.toBe('/browse')
    expect(window.location.pathname).toBe('/practice')
  })
})
