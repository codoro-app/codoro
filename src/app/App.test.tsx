import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { nth } from '../test/nth'

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
})
