import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { clearHasAccountHint, writeHasAccountHint } from './accountHint'

interface MockAuthState {
  isLoaded: boolean
  isSignedIn: boolean
  userId: string | null
  getToken: () => Promise<string | null>
}

const useAuthMock = vi.fn<() => MockAuthState>()
vi.mock('@clerk/react', () => ({
  useAuth: () => useAuthMock(),
  useUser: () => ({ user: null }),
  useClerk: () => ({ signOut: vi.fn() }),
}))

// Same bypass AuthProvider.test.tsx already established: render children
// straight through, skip Clerk's real ClerkProvider init sequence entirely
// -- this suite is about AccountSectionBody's own render-branch choice
// (guest CTA vs. blank loading placeholder), not Clerk's real behavior.
vi.mock('./ClerkBoundary', () => ({
  ClerkBoundary: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

// Its own lifecycle isn't what's under test in this file.
vi.mock('../sync/SyncEngineHost', () => ({
  SyncEngineHost: () => null,
}))

async function loadAccountSection() {
  vi.doMock('../env', () => ({
    env: { VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_example' },
  }))
  return import('./AccountSection')
}

beforeEach(() => {
  vi.resetModules()
  useAuthMock.mockReset()
  clearHasAccountHint()
})

// QA report (2026-09-17), issue #3: navigating to /settings right after
// deleting the account in the same tab (client-side, no reload) rendered
// the Account card completely blank -- not the guest CTA, not a visible
// loading state. Root cause: the card's `!isLoaded` branch had no fallback,
// and a fresh `<ClerkProvider>` mount's `isLoaded` resolving right after
// this tab's own Clerk user was hard-deleted turned out not to be
// guaranteed. Fix: trust this device's own account-hint bookkeeping
// (accountHint.ts) as a fallback signal while Clerk is still loading.
describe('AccountSection — Account card while Clerk is still loading', () => {
  it('shows the guest CTA immediately when this device has no known account, even before Clerk resolves', async () => {
    useAuthMock.mockReturnValue({
      isLoaded: false,
      isSignedIn: false,
      userId: null,
      getToken: vi.fn(),
    })
    const { AccountSection } = await loadAccountSection()

    render(<AccountSection />)

    expect(
      await screen.findByRole('button', { name: /sign in or create account/i }),
    ).toBeInTheDocument()
  })

  it('still shows the empty loading placeholder (not the guest CTA) for a known-account device Clerk just hasn’t resolved yet', async () => {
    useAuthMock.mockReturnValue({
      isLoaded: false,
      isSignedIn: false,
      userId: null,
      getToken: vi.fn(),
    })
    writeHasAccountHint()
    const { AccountSection } = await loadAccountSection()

    const { container } = render(<AccountSection />)

    await waitFor(() => {
      expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument()
    })
    expect(
      screen.queryByRole('button', { name: /sign in or create account/i }),
    ).not.toBeInTheDocument()
  })
})
