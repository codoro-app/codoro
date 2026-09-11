import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

/**
 * I1's own test hook, made concrete: `VITE_CLERK_PUBLISHABLE_KEY` unset
 * must render the signed-out children and mount nothing Clerk-related --
 * not "looks right", but "the lazy import never fires". env.ts computes
 * `env` once at import time, so re-mocking per test needs
 * `vi.resetModules()` + a dynamic re-import, same pattern
 * telemetry.test.ts already established for this exact "env-gated
 * singleton" shape.
 *
 * `@clerk/react` itself is mocked in both cases: the unset case must never
 * even reach it (asserted below), and the set case only needs to prove
 * AuthProvider's *own* wiring (does it render the lazy boundary at all),
 * not Clerk's real behavior -- that's Clerk's test suite's job, not ours.
 */
const clerkBoundaryRender = vi.fn()
vi.mock('./ClerkBoundary', () => ({
  ClerkBoundary: ({
    publishableKey,
    children,
  }: {
    publishableKey: string
    children: React.ReactNode
  }) => {
    clerkBoundaryRender(publishableKey)
    return <div data-testid="clerk-boundary">{children}</div>
  },
}))

beforeEach(() => {
  vi.resetModules()
  clerkBoundaryRender.mockClear()
})

async function loadAuthProvider(publishableKey: string | undefined) {
  vi.doMock('../env', () => ({
    env: { VITE_CLERK_PUBLISHABLE_KEY: publishableKey },
  }))
  return import('./AuthProvider')
}

describe('AuthProvider (I1)', () => {
  it('renders children directly and never mounts ClerkBoundary when the key is unset', async () => {
    const { AuthProvider, hasClerkKey } = await loadAuthProvider(undefined)
    expect(hasClerkKey).toBe(false)

    render(
      <AuthProvider>
        <p>signed-out content</p>
      </AuthProvider>,
    )

    expect(screen.getByText('signed-out content')).toBeInTheDocument()
    expect(screen.queryByTestId('clerk-boundary')).not.toBeInTheDocument()
    // The real assertion, not just "the DOM looks right": the lazy
    // import()'s factory was never even invoked, so ./ClerkBoundary's
    // module code -- and therefore @clerk/react -- never loaded.
    expect(clerkBoundaryRender).not.toHaveBeenCalled()
  })

  it('mounts ClerkBoundary with the configured key when the key is set', async () => {
    const { AuthProvider, hasClerkKey } = await loadAuthProvider('pk_test_example')
    expect(hasClerkKey).toBe(true)

    render(
      <AuthProvider>
        <p>account content</p>
      </AuthProvider>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('clerk-boundary')).toBeInTheDocument()
    })
    expect(screen.getByText('account content')).toBeInTheDocument()
    expect(clerkBoundaryRender).toHaveBeenCalledWith('pk_test_example')
  })
})
