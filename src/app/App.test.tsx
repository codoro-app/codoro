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

vi.mock('../telemetry', () => ({ trackAttempt: vi.fn() }))

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
  })

  it('renders the practice UI inside the ErrorBoundary wrapper (no placeholder copy)', async () => {
    render(<App />)

    // Guards against the original stub landing page copy — not a check that
    // no UI anywhere says "coming soon" (the disabled Rush nav entry now
    // legitimately does, in both ModeSwitcher and NavRail).
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
    // "Daily" button; either one flips `mode`, per Step 17's guidance.
    await user.click(nth(screen.getAllByRole('button', { name: 'Daily' }), 0))

    await waitFor(() => {
      expect(screen.getByText(/Codoro Daily #/)).toBeInTheDocument()
    })
  })

  it("boots straight into Practice on a device's first-ever visit — the cold-start path is untouched", async () => {
    render(<App />)

    // Practice's own loading copy renders on first paint, before Home's
    // separate profile fetch could ever run — the fastest reliable signal
    // that Home isn't in the initial render path.
    expect(screen.getByText(/loading your practice session/i)).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('1200')).toBeInTheDocument()
    })
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

    await user.click(nth(screen.getAllByRole('button', { name: 'Home', hidden: true }), 0))

    // Home's own "Practice" card, not NavRail's nav-rail__item of the same
    // name (both are present at once, so name-based queries are ambiguous —
    // scope by the card's title text, same closest-button pattern this
    // codebase already uses for mastery rows).
    const practiceCard = await screen.findByText('Practice', { selector: '.home__card-title' })
    await user.click(practiceCard.closest('button') as HTMLElement)

    // Back on Practice: usePracticeSession remounts and reloads (mocked
    // loadProfile resolves a fresh default profile each call), so the same
    // rating-pill signal the first test uses confirms we're really there.
    await waitFor(() => {
      expect(screen.getByText('1200')).toBeInTheDocument()
    })
  })
})
