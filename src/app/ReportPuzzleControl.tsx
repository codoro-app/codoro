/**
 * T5 (v2 todo item 18): a low-prominence "Report this puzzle" control,
 * posting to the already-shipped `POST /api/report`. Available signed-out
 * — this is a content-quality channel, not an account feature, and gating
 * it behind sign-in would defeat the point (guest-first is law).
 *
 * Fire-and-forget with an honest confirmation: a failed post says so (role
 * "alert", not a silently-swallowed catch) rather than pretending it
 * landed. No `apiFetch` token is ever attached here — this call is
 * deliberately unauthenticated, matching the server's own contract
 * (`workers/README.md`: "the only anonymous write in the system, by
 * design").
 */
import { useState } from 'react'
import { ApiError, apiFetch } from '../auth/api'
import { REPORT_REASONS } from 'workers/shared/api-types'
import type { ReportReason, ReportResponse } from 'workers/shared/api-types'

const REASON_LABELS: Record<ReportReason, string> = {
  'wrong-answer': 'The marked answer is wrong',
  unclear: 'Unclear or ambiguous',
  'renders-broken': "Doesn't render correctly",
  typo: 'Typo',
  other: 'Something else',
}

// Opaque diagnostic string, never interpreted server-side (see the
// ReportRequest doc comment in api-types.ts) -- no schema entry needed for
// an optional, non-validated build-time var, same as App.tsx's direct
// import.meta.env.DEV reads.
const APP_VERSION: string = (import.meta.env.VITE_APP_VERSION as string | undefined) ?? 'dev'

type Status = 'collapsed' | 'expanded' | 'sending' | 'sent' | 'error'

const LINK_BUTTON_CLASS =
  'text-xs text-text-2 underline underline-offset-2 bg-transparent border-0 cursor-pointer p-0'

export function ReportPuzzleControl({ puzzleId }: { puzzleId: string }) {
  const [status, setStatus] = useState<Status>('collapsed')
  const [reason, setReason] = useState<ReportReason>(REPORT_REASONS[0])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function send() {
    setStatus('sending')
    setErrorMessage(null)
    try {
      await apiFetch<ReportResponse>('/api/report', {
        method: 'POST',
        body: { puzzleId, reason, appVersion: APP_VERSION },
      })
      setStatus('sent')
    } catch (error) {
      setStatus('error')
      setErrorMessage(
        error instanceof ApiError ? error.message : 'Could not send the report — try again.',
      )
    }
  }

  if (status === 'sent') {
    return (
      <p className="m-0 text-right text-xs text-accent" role="status">
        Thanks — sent. We&apos;ll take a look.
      </p>
    )
  }

  if (status === 'collapsed') {
    return (
      <div className="flex justify-end">
        <button
          type="button"
          className={LINK_BUTTON_CLASS}
          onClick={() => {
            setStatus('expanded')
          }}
        >
          Report this puzzle
        </button>
      </div>
    )
  }

  return (
    <div className="rounded-md border border-border bg-surface-1 p-3">
      <p className="m-0 mb-2 text-xs uppercase tracking-wide text-text-2">
        What&apos;s wrong with this puzzle?
      </p>
      <div className="flex flex-col gap-1.5 mb-3" role="radiogroup" aria-label="Report reason">
        {REPORT_REASONS.map((value) => (
          <label
            key={value}
            className={`flex items-center gap-2 py-2 px-2.5 rounded-md border text-sm cursor-pointer ${
              reason === value
                ? 'border-accent bg-accent-dim text-text-0'
                : 'border-border text-text-1'
            }`}
          >
            <input
              type="radio"
              name="report-reason"
              value={value}
              checked={reason === value}
              onChange={() => {
                setReason(value)
              }}
            />
            {REASON_LABELS[value]}
          </label>
        ))}
      </div>
      {status === 'error' && errorMessage && (
        <p className="m-0 mb-2 text-xs text-danger" role="alert">
          {errorMessage}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          className="flex-1 min-h-9 rounded-md border border-border-strong bg-transparent text-text-0 text-sm font-semibold cursor-pointer disabled:opacity-60"
          onClick={() => {
            setStatus('collapsed')
          }}
          disabled={status === 'sending'}
        >
          Cancel
        </button>
        <button
          type="button"
          className="flex-1 min-h-9 rounded-md border-0 bg-accent text-accent-ink text-sm font-bold cursor-pointer disabled:opacity-60"
          onClick={() => void send()}
          disabled={status === 'sending'}
        >
          {status === 'sending' ? 'Sending…' : 'Send report'}
        </button>
      </div>
    </div>
  )
}
