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
import { useEffect, useRef, useState } from 'react'
import { ApiError, apiFetch } from '../auth/api'
import { REPORT_REASONS } from 'workers/shared/api-types'
import type { ReportReason, ReportResponse } from 'workers/shared/api-types'
import { FlagIcon } from './Icons'
import { Tooltip } from './Tooltip'

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

export type ReportStatus = 'collapsed' | 'expanded' | 'sending' | 'sent' | 'error'

// Same icon-trigger treatment as ShareMenu's `trigger="icon"` mode (matched
// class-for-class) -- this control now lives in the same right-rail sidebar
// as the share/challenge icons, so it reads as one family of controls
// rather than a mismatched text link (the theme complaint this replaces).
const ICON_TRIGGER_CLASS =
  'flex items-center justify-center shrink-0 min-w-11 min-h-11 rounded-sm border border-border bg-surface-1 text-text-1 cursor-pointer transition-[transform,opacity] duration-[0.05s] ease-out active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

// Status is controlled by the caller (PuzzleCardShell) — mobile's answered
// layout needs to render this control's collapsed icon-trigger inline in a
// row with ShareMenu/ContinueCta, then its expanded reason-picker card as a
// separate block below that row, which means the caller has to know (and
// decide where to render based on) the current status itself instead of it
// being this component's own private useState.
export function ReportPuzzleControl({
  puzzleId,
  status,
  onStatusChange,
}: {
  puzzleId: string
  status: ReportStatus
  onStatusChange: (status: ReportStatus) => void
}) {
  const [reason, setReason] = useState<ReportReason>(REPORT_REASONS[0])
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)

  // Live feedback (2026-09-18): the expanded reason-picker card (5 reasons +
  // Cancel/Send) can render tall enough that its own bottom — including the
  // Send button — lands below the current scroll position, with nothing
  // prompting the player to scroll for it. A plain `scrollIntoView` (even
  // with `scroll-margin-bottom` reserving BottomNav's height) measured out
  // to leave ~0px clearance instead of the intended ~60px — this drawer's
  // `position: sticky` ancestor (PuzzleCardShell.tsx's FEEDBACK_DRAWER_CLASS)
  // appears to confuse `block: 'nearest'`'s own margin accounting, so this
  // computes the needed scroll distance directly instead: how far the
  // card's bottom edge (plus that same reserved clearance, read back off
  // its own resolved `scroll-margin-bottom` so the two never drift) sits
  // past the viewport's bottom edge, then scrolls exactly that far.
  // `window.scrollBy` is a no-op stub in jsdom (src/test/setup.ts) — safe
  // in tests without a separate feature-detect.
  useEffect(() => {
    if (status !== 'expanded') return
    const card = cardRef.current
    if (!card) return
    const reserve = parseFloat(window.getComputedStyle(card).scrollMarginBottom) || 0
    const overflow = card.getBoundingClientRect().bottom + reserve - window.innerHeight
    if (overflow > 0) {
      window.scrollBy({ top: overflow, behavior: 'smooth' })
    }
  }, [status])

  async function send() {
    onStatusChange('sending')
    setErrorMessage(null)
    try {
      await apiFetch<ReportResponse>('/api/report', {
        method: 'POST',
        body: { puzzleId, reason, appVersion: APP_VERSION },
      })
      onStatusChange('sent')
    } catch (error) {
      onStatusChange('error')
      setErrorMessage(
        error instanceof ApiError ? error.message : 'Could not send the report — try again.',
      )
    }
  }

  if (status === 'sent') {
    return (
      <p className="m-0 text-xs text-accent" role="status">
        Thanks — sent. We&apos;ll take a look.
      </p>
    )
  }

  if (status === 'collapsed') {
    return (
      <div className="flex justify-end">
        <Tooltip label="Report this puzzle" className="shrink-0">
          <button
            type="button"
            className={ICON_TRIGGER_CLASS}
            aria-haspopup="dialog"
            aria-expanded={false}
            aria-label="Report this puzzle"
            onClick={() => {
              onStatusChange('expanded')
            }}
          >
            <FlagIcon size={18} />
          </button>
        </Tooltip>
      </div>
    )
  }

  return (
    <div
      ref={cardRef}
      className="rounded-md border border-border bg-surface-1 p-3 scroll-mb-[calc(var(--bottom-nav-height)+env(safe-area-inset-bottom))] lg:scroll-mb-0"
    >
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
            onStatusChange('collapsed')
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
