import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { readHasAccountHint, writeHasAccountHint } from './accountHint'

const signOutMock = vi.fn(() => Promise.resolve())
vi.mock('@clerk/react', () => ({
  useClerk: () => ({ signOut: signOutMock }),
}))

const apiFetchMock = vi.fn<(...args: unknown[]) => Promise<unknown>>()
vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, apiFetch: (...args: unknown[]) => apiFetchMock(...args) }
})

const { DeleteAccountDialog } = await import('./DeleteAccountDialog')

beforeEach(() => {
  vi.clearAllMocks()
  signOutMock.mockResolvedValue(undefined)
  writeHasAccountHint()
})

// QA report (2026-09-17), issue #3: Settings' Account card rendered
// completely blank on a fresh (client-side, no reload) /settings visit
// right after deleting the account in the same tab -- traced to
// SyncEngineHost's hint-clearing effect being gated on Clerk's `isLoaded`,
// which isn't guaranteed to resolve promptly on a `<ClerkProvider>` remount
// right after this tab's own Clerk user was hard-deleted. These lock in
// that the fix -- clearing the hint directly in the delete success path --
// actually fires, and only on success.
describe('DeleteAccountDialog — clears the account hint deterministically on success', () => {
  it('clears the hint once the delete is confirmed, and reports success', async () => {
    apiFetchMock.mockResolvedValue(undefined)
    const onDeleted = vi.fn()
    const user = userEvent.setup()
    render(
      <DeleteAccountDialog
        confirmText="me@example.com"
        getToken={() => Promise.resolve('tok')}
        onCancel={vi.fn()}
        onDeleted={onDeleted}
      />,
    )

    await user.type(screen.getByLabelText(/type/i), 'me@example.com')
    await user.click(screen.getByRole('button', { name: 'Delete account' }))

    await waitFor(() => {
      expect(onDeleted).toHaveBeenCalledOnce()
    })
    expect(signOutMock).toHaveBeenCalledOnce()
    expect(readHasAccountHint()).toBe(false)
  })

  it('leaves the hint untouched and never reports success when the delete call fails', async () => {
    apiFetchMock.mockRejectedValue(new Error('boom'))
    const onDeleted = vi.fn()
    const user = userEvent.setup()
    render(
      <DeleteAccountDialog
        confirmText="me@example.com"
        getToken={() => Promise.resolve('tok')}
        onCancel={vi.fn()}
        onDeleted={onDeleted}
      />,
    )

    await user.type(screen.getByLabelText(/type/i), 'me@example.com')
    await user.click(screen.getByRole('button', { name: 'Delete account' }))

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument()
    })
    expect(onDeleted).not.toHaveBeenCalled()
    expect(signOutMock).not.toHaveBeenCalled()
    expect(readHasAccountHint()).toBe(true)
  })
})
