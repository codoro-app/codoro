import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import type { AuthState } from '../auth/useAuthToken'

/**
 * Unit-tests SyncEngineHost's own wiring in isolation: useAuthToken() and
 * createSyncEngine() are both mocked, so this suite is about "does this
 * component call the right engine method at the right lifecycle moment,"
 * not "does the real engine/Clerk SDK work" (engine.test.ts and Clerk's own
 * test suite already own those).
 */
const authState: AuthState = {
  isLoaded: false,
  isSignedIn: false,
  email: null,
  userId: null,
  getToken: vi.fn(() => Promise.resolve('test-token')),
}
vi.mock('../auth/useAuthToken', () => ({
  useAuthToken: () => authState,
}))

const engine = {
  handleSignedIn: vi.fn(() => Promise.resolve({ accountSwitchDetected: false })),
  handleSignedOut: vi.fn(),
  notifyMutation: vi.fn(),
  flush: vi.fn(() => Promise.resolve()),
  handleOnline: vi.fn(() => Promise.resolve()),
  pull: vi.fn(() => Promise.resolve({ kind: 'noop' })),
  push: vi.fn(() => Promise.resolve()),
  getSchemaSkew: vi.fn(() => null),
}
// No test in this file inspects createSyncEngine's own call arguments (only
// call *count*, for the "constructs exactly one instance" test below) --
// the wrapper ignores whatever it's called with rather than forwarding via
// a spread, which only tsc -b's build-mode typecheck (not plain
// tsc --noEmit) rejects for a zero-arg mock target.
const createSyncEngineMock = vi.fn(() => engine)
vi.mock('./engine', () => ({
  createSyncEngine: () => createSyncEngineMock(),
}))

let profileSavedListener: (() => void) | null = null
const onProfileSavedMock = vi.fn((listener: () => void) => {
  profileSavedListener = listener
  return () => {
    profileSavedListener = null
  }
})
vi.mock('../storage', () => ({
  onProfileSaved: (listener: () => void) => onProfileSavedMock(listener),
}))

const writeHasAccountHintMock = vi.fn<() => void>()
const clearHasAccountHintMock = vi.fn<() => void>()
vi.mock('../auth/accountHint', () => ({
  writeHasAccountHint: (): void => {
    writeHasAccountHintMock()
  },
  clearHasAccountHint: (): void => {
    clearHasAccountHintMock()
  },
}))

const identifyUserMock = vi.fn<(userId: string) => void>()
const resetIdentityMock = vi.fn<() => void>()
vi.mock('../telemetry', () => ({
  identifyUser: (userId: string): void => {
    identifyUserMock(userId)
  },
  resetIdentity: (): void => {
    resetIdentityMock()
  },
}))

const { SyncEngineHost } = await import('./SyncEngineHost')

function setAuthState(next: Partial<AuthState>): void {
  Object.assign(authState, next)
}

describe('SyncEngineHost', () => {
  const reloadMock = vi.fn()

  beforeEach(() => {
    setAuthState({ isLoaded: false, isSignedIn: false, userId: null })
    createSyncEngineMock.mockClear()
    engine.handleSignedIn.mockClear()
    engine.handleSignedIn.mockImplementation(() =>
      Promise.resolve({ accountSwitchDetected: false }),
    )
    engine.handleSignedOut.mockClear()
    engine.notifyMutation.mockClear()
    engine.flush.mockClear()
    engine.handleOnline.mockClear()
    onProfileSavedMock.mockClear()
    profileSavedListener = null
    writeHasAccountHintMock.mockClear()
    clearHasAccountHintMock.mockClear()
    identifyUserMock.mockClear()
    resetIdentityMock.mockClear()
    reloadMock.mockClear()
    // jsdom's window.location.reload is non-configurable (vi.spyOn throws
    // "Cannot redefine property") and throws "Not implemented" if actually
    // invoked -- replacing the whole `location` object (a standard jsdom
    // workaround) is what makes it stubbable at all. A minimal stub, not a
    // spread of the real Location instance (which would lose its
    // prototype methods) -- nothing in this file needs any other
    // `location` property.
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { reload: reloadMock },
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('renders nothing', () => {
    const { container } = render(<SyncEngineHost />)
    expect(container).toBeEmptyDOMElement()
  })

  it('constructs exactly one engine instance for the component lifetime, even across re-renders', () => {
    const { rerender } = render(<SyncEngineHost />)
    setAuthState({ isLoaded: true, isSignedIn: false })
    rerender(<SyncEngineHost />)
    setAuthState({ isLoaded: true, isSignedIn: true, userId: 'user_a' })
    rerender(<SyncEngineHost />)

    expect(createSyncEngineMock).toHaveBeenCalledTimes(1)
  })

  // Review finding (blocker, round 2): the real app can mount this
  // component from up to three places at once (App.tsx's root host,
  // AccountSection.tsx's, SignupPromptSheet.tsx's), gated on a mutable
  // localStorage flag that doesn't guarantee exclusivity by itself -- see
  // SyncEngineHost.tsx's own top comment. These tests exercise the
  // singleton guard that closes it, independent of any gating logic
  // (which lives in the call sites, not here): two instances mounted at
  // once must never both wire up real lifecycle behavior.
  describe('singleton guard (review finding, round 2) — only one mounted instance is ever active', () => {
    it('a second simultaneously-mounted instance never calls a lifecycle hook, even when both are signed in', async () => {
      setAuthState({ isLoaded: true, isSignedIn: true, userId: 'user_a' })

      render(<SyncEngineHost />) // e.g. the root host
      render(<SyncEngineHost />) // e.g. a local host mounted alongside it

      await vi.waitFor(() => {
        expect(engine.handleSignedIn).toHaveBeenCalled()
      })
      // Exactly once -- not once per mounted instance. Two independent
      // engines both wiring up here is precisely the double-instance race
      // this guard exists to prevent (each with its own mutex, each
      // subscribed to onProfileSaved, potentially both running an
      // account-switch reset concurrently).
      expect(engine.handleSignedIn).toHaveBeenCalledTimes(1)
      expect(onProfileSavedMock).toHaveBeenCalledTimes(1)
      // Same guard extended to the new identify wiring -- the losing
      // instance's effect body never runs, so it must never identify
      // either.
      expect(identifyUserMock).toHaveBeenCalledTimes(1)
    })

    it('a second simultaneously-mounted instance never reacts to online/visibilitychange either', () => {
      setAuthState({ isLoaded: true, isSignedIn: true, userId: 'user_a' })

      render(<SyncEngineHost />)
      render(<SyncEngineHost />)

      window.dispatchEvent(new Event('online'))
      expect(engine.handleOnline).toHaveBeenCalledTimes(1)

      const visibilitySpy = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
      document.dispatchEvent(new Event('visibilitychange'))
      expect(engine.flush).toHaveBeenCalledTimes(1)
      visibilitySpy.mockRestore()
    })

    it('releases the slot on unmount, so a later instance can claim it', async () => {
      setAuthState({ isLoaded: true, isSignedIn: true, userId: 'user_a' })

      const first = render(<SyncEngineHost />)
      await vi.waitFor(() => {
        expect(engine.handleSignedIn).toHaveBeenCalledTimes(1)
      })
      first.unmount()

      engine.handleSignedIn.mockClear()
      render(<SyncEngineHost />) // e.g. Settings visited after the root host's session ended

      await vi.waitFor(() => {
        expect(engine.handleSignedIn).toHaveBeenCalledTimes(1)
      })
    })
  })

  it('calls neither lifecycle hook while Clerk has not finished loading', () => {
    render(<SyncEngineHost />)

    expect(engine.handleSignedOut).not.toHaveBeenCalled()
    expect(engine.handleSignedIn).not.toHaveBeenCalled()
  })

  it('calls handleSignedIn(userId) once loaded and signed in -- covers both a real sign-in and "already signed in at boot"', () => {
    setAuthState({ isLoaded: true, isSignedIn: true, userId: 'user_a' })
    render(<SyncEngineHost />)

    expect(engine.handleSignedIn).toHaveBeenCalledWith('user_a')
    expect(engine.handleSignedOut).not.toHaveBeenCalled()
    expect(identifyUserMock).toHaveBeenCalledWith('user_a')
  })

  it('calls handleSignedOut once loaded and signed out', () => {
    setAuthState({ isLoaded: true, isSignedIn: false, userId: null })
    render(<SyncEngineHost />)

    expect(engine.handleSignedOut).toHaveBeenCalledTimes(1)
    expect(resetIdentityMock).toHaveBeenCalledTimes(1)
  })

  it('stamps the has-account hint on sign-in and clears it on sign-out (I3/F8)', () => {
    setAuthState({ isLoaded: true, isSignedIn: true, userId: 'user_a' })
    const { rerender } = render(<SyncEngineHost />)
    expect(writeHasAccountHintMock).toHaveBeenCalledTimes(1)
    expect(clearHasAccountHintMock).not.toHaveBeenCalled()

    setAuthState({ isLoaded: true, isSignedIn: false, userId: null })
    rerender(<SyncEngineHost />)
    expect(clearHasAccountHintMock).toHaveBeenCalledTimes(1)
  })

  it('reloads the page when handleSignedIn reports an account switch (review finding: stale in-memory session state)', async () => {
    engine.handleSignedIn.mockImplementation(() => Promise.resolve({ accountSwitchDetected: true }))
    setAuthState({ isLoaded: true, isSignedIn: true, userId: 'user_b' })

    render(<SyncEngineHost />)
    await vi.waitFor(() => {
      expect(reloadMock).toHaveBeenCalledTimes(1)
    })
  })

  it('does not reload when handleSignedIn reports no account switch', async () => {
    setAuthState({ isLoaded: true, isSignedIn: true, userId: 'user_a' })

    render(<SyncEngineHost />)
    await vi.waitFor(() => {
      expect(engine.handleSignedIn).toHaveBeenCalled()
    })

    expect(reloadMock).not.toHaveBeenCalled()
  })

  it('re-fires the lifecycle hook when sign-in state actually changes, not on every unrelated re-render', () => {
    const { rerender } = render(<SyncEngineHost />) // not loaded -> no lifecycle call yet
    expect(engine.handleSignedOut).not.toHaveBeenCalled()
    expect(engine.handleSignedIn).not.toHaveBeenCalled()

    setAuthState({ isLoaded: true, isSignedIn: true, userId: 'user_a' })
    rerender(<SyncEngineHost />)
    expect(engine.handleSignedIn).toHaveBeenCalledTimes(1)

    // Re-render with no change to isLoaded/isSignedIn/userId -- must not
    // re-fire handleSignedIn a second time.
    rerender(<SyncEngineHost />)
    expect(engine.handleSignedIn).toHaveBeenCalledTimes(1)
  })

  it('subscribes notifyMutation to onProfileSaved', () => {
    render(<SyncEngineHost />)

    expect(onProfileSavedMock).toHaveBeenCalledTimes(1)
    expect(profileSavedListener).not.toBeNull()

    profileSavedListener?.()

    expect(engine.notifyMutation).toHaveBeenCalledTimes(1)
  })

  it("calls handleOnline() on the window 'online' event", () => {
    render(<SyncEngineHost />)

    window.dispatchEvent(new Event('online'))

    expect(engine.handleOnline).toHaveBeenCalledTimes(1)
  })

  it('calls flush() when the document becomes hidden, not on any other visibility state', () => {
    const visibilitySpy = vi.spyOn(document, 'visibilityState', 'get')
    render(<SyncEngineHost />)

    visibilitySpy.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(engine.flush).not.toHaveBeenCalled()

    visibilitySpy.mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    expect(engine.flush).toHaveBeenCalledTimes(1)

    visibilitySpy.mockRestore()
  })

  it('removes its online/visibilitychange listeners on unmount', () => {
    const { unmount } = render(<SyncEngineHost />)
    unmount()

    window.dispatchEvent(new Event('online'))
    document.dispatchEvent(new Event('visibilitychange'))

    expect(engine.handleOnline).not.toHaveBeenCalled()
    expect(engine.flush).not.toHaveBeenCalled()
  })
})
