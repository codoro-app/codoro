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
    loadProfile: vi.fn(() => Promise.resolve(actual.createDefaultProfile())),
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
    // App.tsx's resolveBootMode marks 'codoro:has-visited' on every mount —
    // clear it so each test starts as a fresh first visit (boot: Practice),
    // matching what every test below except the two boot-mode ones assumes.
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
  })

  it('defaults to Practice, and switches to the Daily UI via the mode switcher', async () => {
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

  it("boots straight into Practice on a device's first-ever visit — the cold-start path is untouched", async () => {
    const { container } = render(<App />)

    await waitFor(() => {
      expect(screen.getByText('1200')).toBeInTheDocument()
    })

    // Practice and Home both show "1200" for a fresh default profile (Home's
    // hero rating and Practice's status pill), so that text alone can't
    // disambiguate which one actually rendered — checking each page's own
    // root container can. (Previously this asserted PracticePage's
    // transient "loading your practice session" text synchronously right
    // after render(); with route-level React.lazy, PracticePage itself
    // doesn't mount until its chunk resolves, so that text's timing
    // relative to the assertion is no longer guaranteed the way a
    // synchronous import's was.)
    expect(container.querySelector('.practice-page')).toBeInTheDocument()
    expect(container.querySelector('.home')).not.toBeInTheDocument()
  })

  it('boots straight into Home on every visit after the first', async () => {
    // Simulate a returning device: the flag App.tsx's resolveBootMode
    // writes on a real first visit is already present.
    localStorage.setItem('codoro:has-visited', '1')

    render(<App />)

    expect(screen.queryByText(/loading your practice session/i)).not.toBeInTheDocument()
    await screen.findByText('Practice', { selector: '.home__card-title' })
  })

  it("a first-ever visit's boot redirect writes 'codoro:has-visited' exactly once (no double-write on remount/StrictMode)", async () => {
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem')

    render(<App />)
    await waitFor(() => {
      expect(screen.getByText('1200')).toBeInTheDocument()
    })

    const visitedWrites = setItemSpy.mock.calls.filter(([key]) => key === 'codoro:has-visited')
    expect(visitedWrites).toHaveLength(1)
    expect(localStorage.getItem('codoro:has-visited')).toBe('1')

    setItemSpy.mockRestore()
  })

  it('prefetches the boot mode chunk from inside the lazy useState initializer, not an effect (loses its head start on first paint otherwise)', () => {
    const source = readFileSync(appTsxPath, 'utf-8')
    const initializerMatch = /useState<BootMode \| null>\(\(\) => \{[\s\S]*?\n {2}\}\)/.exec(source)
    expect(initializerMatch).not.toBeNull()
    const initializerBody = initializerMatch?.[0] ?? ''
    expect(initializerBody).toMatch(/void bootImporters\[mode\]\(\)/)

    // The same call must not also live inside a useEffect/useLayoutEffect —
    // that would delay the request until after the first commit instead of
    // overlapping it with app startup.
    const effectBodies = [
      ...source.matchAll(/use(?:Layout)?Effect\(\(\) => \{[\s\S]*?\n {2}\}, \[/g),
    ]
    for (const match of effectBodies) {
      expect(match[0]).not.toMatch(/bootImporters/)
    }
  })

  it("honors a same-origin ?redirect= param on '/' instead of the normal first-visit boot decision", async () => {
    window.history.pushState({}, '', '/?redirect=%2Flegal')

    render(<App />)

    await waitFor(() => {
      expect(window.location.pathname).toBe('/legal')
    })
    await screen.findByText('Terms & privacy', { selector: '.legal-page__title' })
    // Recovering from an upstream redirect isn't a real first visit — the
    // has-visited flag must stay untouched, unlike the normal Practice boot.
    expect(localStorage.getItem('codoro:has-visited')).toBeNull()
  })

  it('ignores a protocol-relative ?redirect= value (open-redirect guard) and falls back to the normal boot decision', async () => {
    window.history.pushState({}, '', '/?redirect=%2F%2Fevil.example.com')

    render(<App />)

    await waitFor(() => {
      expect(window.location.pathname).toBe('/practice')
    })
  })

  it('ignores a backslash-disguised cross-origin ?redirect= value — a regex like /^\\/(?!\\/)/ would wrongly admit this, since WHATWG URL parsing treats a leading backslash the same as a second forward slash', async () => {
    window.history.pushState({}, '', '/?redirect=%2F%5Cevil.example.com')

    render(<App />)

    await waitFor(() => {
      expect(window.location.pathname).toBe('/practice')
    })
  })

  // A second bypass of the same guard: new URL('/..//evil.com', origin)'s
  // WHATWG path normalization pops the leading '/..', leaving
  // pathname === '//evil.com' with the origin unchanged — so the origin
  // check alone passes even though the result is protocol-relative. Each
  // of these must fall back to the normal boot decision, same as the
  // protocol-relative and backslash cases above.
  it.each([
    ['/..//evil.com', 'a dot-dot-collapsed protocol-relative value'],
    ['/..//..//evil.com', 'a repeated dot-dot-collapsed protocol-relative value'],
    ['/%2e%2e//evil.com', 'a percent-encoded dot-dot-collapsed protocol-relative value'],
  ])('ignores %s (%s) and falls back to the normal boot decision', async (target) => {
    window.history.pushState({}, '', `/?redirect=${encodeURIComponent(target)}`)

    render(<App />)

    await waitFor(() => {
      expect(window.location.pathname).toBe('/practice')
    })
  })

  it('opens Home when the logo is clicked, and can navigate back to Practice from there', async () => {
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

    // usePracticeSession's mount effect is the only thing that calls
    // loadProfile — a remount (state reset) would call it again, which is
    // exactly what App.tsx's doc comment on PracticePage's two <Route>
    // entries claims won't happen: both /practice and /browse render the
    // same PracticePage element at the same Switch position, so React
    // updates it in place across the navigation instead of unmounting it.
    const loadCallsBeforeBrowse = vi.mocked(loadProfile).mock.calls.length

    await user.click(nth(screen.getAllByRole('link', { name: /browse patterns/i }), 0))
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
    // uses for its own back/forward test. Per this file's beforeEach, the
    // boot redirect already replaced the pre-render '/' entry with
    // '/practice', so the only *push* on the stack at this point was
    // entering Browse — back() must therefore land on '/practice' again,
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
