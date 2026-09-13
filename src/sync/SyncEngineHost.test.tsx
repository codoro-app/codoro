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
  handleSignedIn: vi.fn(() => Promise.resolve()),
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

const { SyncEngineHost } = await import('./SyncEngineHost')

function setAuthState(next: Partial<AuthState>): void {
  Object.assign(authState, next)
}

describe('SyncEngineHost', () => {
  beforeEach(() => {
    setAuthState({ isLoaded: false, isSignedIn: false, userId: null })
    createSyncEngineMock.mockClear()
    engine.handleSignedIn.mockClear()
    engine.handleSignedOut.mockClear()
    engine.notifyMutation.mockClear()
    engine.flush.mockClear()
    engine.handleOnline.mockClear()
    onProfileSavedMock.mockClear()
    profileSavedListener = null
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
  })

  it('calls handleSignedOut once loaded and signed out', () => {
    setAuthState({ isLoaded: true, isSignedIn: false, userId: null })
    render(<SyncEngineHost />)

    expect(engine.handleSignedOut).toHaveBeenCalledTimes(1)
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
