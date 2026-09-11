/**
 * T5: type-to-confirm delete, same weight as SettingsPage.tsx's existing
 * "Replace your data" import-confirm dialog. No username exists yet (that's
 * T9/Phase 5.3), so the confirm phrase is the account's own email — the one
 * identifying string a signed-in player already has.
 *
 * The local-history-kept line is a stated product decision (build prompt
 * item 4), not a caveat to bury: deleting the account never touches
 * IndexedDB.
 *
 * A failed delete surfaces here and stops -- it does NOT call `signOut()`
 * or `onDeleted()`. Only a confirmed 204 does. "Confirmed server-side, not
 * inferred" (T5's own DoD line) is this component trusting the same
 * contract at the UI layer: a promise that resolved is not proof by
 * itself, but a 204 from `apiFetch` (which throws `ApiError` on any
 * non-2xx) is the honest signal this component has to act on.
 */
import { useId, useState } from 'react'
import { useClerk } from '@clerk/react'
import { ApiError, apiFetch } from './api'

const OVERLAY_CLASS = 'fixed inset-0 z-30 flex items-center justify-center p-4 bg-surface-0/70'
const DIALOG_CLASS =
  'flex flex-col gap-3 w-full max-w-[420px] py-5 px-5 rounded-lg border border-border bg-surface-1'
const BUTTON_CLASS = 'min-h-11 w-full py-3 px-4 rounded-md text-md font-semibold cursor-pointer'

export interface DeleteAccountDialogProps {
  confirmText: string
  getToken: () => Promise<string | null>
  onCancel: () => void
  onDeleted: () => void
}

export function DeleteAccountDialog({
  confirmText,
  getToken,
  onCancel,
  onDeleted,
}: DeleteAccountDialogProps) {
  const [typed, setTyped] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const { signOut } = useClerk()
  const inputId = useId()

  const canConfirm = typed.trim().length > 0 && typed.trim() === confirmText && !deleting

  async function handleConfirm() {
    setDeleting(true)
    setErrorMessage(null)
    try {
      const token = await getToken()
      await apiFetch('/api/account', { method: 'DELETE', token })
      // Only reached on a real 2xx (apiFetch throws otherwise) -- sign out
      // the now-nonexistent session locally and report success.
      await signOut()
      onDeleted()
    } catch (error) {
      setErrorMessage(
        error instanceof ApiError
          ? error.message
          : 'Something went wrong — your account was not deleted.',
      )
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className={OVERLAY_CLASS}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Delete your account"
        className={DIALOG_CLASS}
      >
        <p className="m-0 text-lg font-bold text-text-0">Delete your account?</p>
        <p className="m-0 text-sm text-text-1">
          This removes your account, synced progress, and leaderboard entries. It can&apos;t be
          undone.
        </p>
        <p className="m-0 text-sm text-text-1 bg-surface-2 rounded-md py-2.5 px-3">
          <strong className="text-text-0">Your local play history stays on this device</strong> —
          deleting the account doesn&apos;t touch what&apos;s already saved here.
        </p>
        <label htmlFor={inputId} className="text-xs text-text-1">
          Type &ldquo;{confirmText}&rdquo; to confirm
        </label>
        <input
          id={inputId}
          type="text"
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value)
          }}
          className="w-full min-h-11 py-2.5 px-3 rounded-md border border-border-strong bg-surface-2 text-text-0 font-mono text-sm"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
        {errorMessage && (
          <p className="m-0 text-sm text-danger" role="alert">
            {errorMessage}
          </p>
        )}
        <button
          type="button"
          className={`${BUTTON_CLASS} border border-border-strong bg-transparent text-text-0`}
          onClick={onCancel}
          disabled={deleting}
        >
          Cancel
        </button>
        <button
          type="button"
          className={`${BUTTON_CLASS} border-0 bg-danger text-white disabled:opacity-50 disabled:cursor-default`}
          onClick={() => void handleConfirm()}
          disabled={!canConfirm}
        >
          {deleting ? 'Deleting…' : 'Delete account'}
        </button>
      </div>
    </div>
  )
}
