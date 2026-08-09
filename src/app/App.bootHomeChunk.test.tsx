import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

// Isolated from App.test.tsx because this file mocks './Home' itself (to
// count whether its module is ever imported) — that mock would stub out
// Home's real content for every other App.test.tsx test that navigates
// there.
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

vi.mock('virtual:pwa-register/react', () => ({
  useRegisterSW: () => ({
    needRefresh: [false, vi.fn()],
    updateServiceWorker: vi.fn(() => Promise.resolve()),
  }),
}))

let homeModuleImportCount = 0
vi.mock('./Home', () => {
  homeModuleImportCount++
  return { Home: () => null }
})

const { App } = await import('./App')

describe('App boot: Home chunk import', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.pushState({}, '', '/')
  })

  // Same under-load flake and same fix as App.test.tsx's first-mount test
  // (see that file's own comment): the default 5s Vitest test timeout is
  // tight for a real cold App mount when the full suite (1500+ tests) is
  // running concurrently — this test passed in isolation every time it
  // was checked (well under 2s) but hit the default timeout under full-
  // suite load. 15s gives the cold first mount real room while still
  // failing on a genuine hang.
  it("a first-ever visit never imports the Home module — React.lazy's ctor fires on render, even for a route that unmounts before its first paint", async () => {
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('1200')).toBeInTheDocument()
    })

    expect(homeModuleImportCount).toBe(0)
  }, 15_000)
})
