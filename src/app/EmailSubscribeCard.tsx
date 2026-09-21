/**
 * Compact, skippable, non-blocking email opt-in -- the pre-launch/marketing
 * list (Resend). Default placement: `ChallengeComparison.tsx`, after a
 * recipient finishes a challenge (highest-intent moment, per the original
 * email-list plan doc). Dismissing (the "No thanks" button) never blocks
 * anything else on the page, same "skip never blocks" precedent
 * ChallengerNameSheet.tsx already establishes for its own opt-in.
 *
 * The act of typing an email and tapping "Notify me" IS the explicit
 * opt-in -- a separate pre-unchecked checkbox on top of a single-purpose,
 * single-field form would be redundant, not more honest. `hp` is a
 * honeypot: a visually-hidden field real users never fill (aria-hidden +
 * tabIndex -1 + off-screen, not `display: none`, which some bots skip);
 * the backend rejects a non-empty value as a generic 400, same effect as a
 * failed validation.
 */
import { useState } from 'react'
import { Link } from 'wouter'
import { ApiError, apiFetch } from '../auth/api'
import { trackEmailSignup } from '../telemetry'
import { useEmailSubscribeNudge } from './useEmailSubscribeNudge'
import type { SubscribeResponse } from 'workers/shared/api-types'

export interface EmailSubscribeCardProps {
  /** Matches EmailSignupPayload's `surface` literal -- passed explicitly rather than hardcoded here so a second placement (if ever added) doesn't misattribute telemetry to this one's default. */
  surface: 'challenge_comparison'
}

type Status = 'idle' | 'submitting' | 'success' | 'error'

const CARD_CLASS =
  'flex flex-col gap-2 rounded-md border border-border bg-surface-1 p-3 text-left max-w-[min(100%,26rem)] mx-auto'

const INPUT_CLASS =
  'min-h-11 py-2 px-3 rounded-sm border border-border bg-surface-0 text-text-0 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

const SUBMIT_BUTTON_CLASS =
  'min-h-11 py-2 px-3 rounded-sm border-0 bg-accent text-accent-ink font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

const DISMISS_BUTTON_CLASS =
  'self-start text-xs text-text-2 bg-transparent border-0 cursor-pointer underline p-0'

export function EmailSubscribeCard({ surface }: EmailSubscribeCardProps) {
  const nudge = useEmailSubscribeNudge()
  const [email, setEmail] = useState('')
  const [hp, setHp] = useState('')
  const [status, setStatus] = useState<Status>('idle')
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Checked before `nudge.dismissed` -- a successful submit calls
  // nudge.dismiss() to persist "never show again" for future mounts, but
  // this SAME mount still needs to render the confirmation line rather than
  // vanish to null the instant that flag flips.
  if (status === 'success') {
    return (
      <p className="m-0 text-sm text-accent text-center" role="status">
        You&apos;re on the list — thanks!
      </p>
    )
  }

  if (nudge.dismissed) return null

  async function submit() {
    setStatus('submitting')
    setErrorMessage(null)
    try {
      await apiFetch<SubscribeResponse>('/api/subscribe', {
        method: 'POST',
        body: { email, hp },
      })
      trackEmailSignup({ surface })
      nudge.dismiss()
      setStatus('success')
    } catch (error) {
      setStatus('error')
      setErrorMessage(
        error instanceof ApiError ? error.message : 'Could not subscribe — try again.',
      )
    }
  }

  return (
    <div className={CARD_CLASS}>
      <p className="m-0 text-sm text-text-0 font-semibold">Want to hear when Codoro changes?</p>
      <p className="m-0 text-xs text-text-2">
        Occasional product updates, no spam.{' '}
        <Link href="/legal" className="text-accent">
          How we handle this
        </Link>
      </p>
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <label htmlFor="email-subscribe-input" className="sr-only">
          Email address
        </label>
        <input
          id="email-subscribe-input"
          type="email"
          required
          placeholder="you@example.com"
          value={email}
          className={`flex-1 min-w-0 ${INPUT_CLASS}`}
          onChange={(event) => {
            setEmail(event.target.value)
          }}
          disabled={status === 'submitting'}
        />
        {/* Honeypot -- visually hidden, never shown to a real visitor. */}
        <input
          type="text"
          name="hp"
          value={hp}
          onChange={(event) => {
            setHp(event.target.value)
          }}
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
          className="absolute w-px h-px overflow-hidden opacity-0 pointer-events-none -left-[9999px]"
        />
        <button type="submit" className={SUBMIT_BUTTON_CLASS} disabled={status === 'submitting'}>
          {status === 'submitting' ? 'Sending…' : 'Notify me'}
        </button>
      </form>
      {status === 'error' && errorMessage && (
        <p className="m-0 text-xs text-danger" role="alert">
          {errorMessage}
        </p>
      )}
      <button type="button" className={DISMISS_BUTTON_CLASS} onClick={nudge.dismiss}>
        No thanks
      </button>
    </div>
  )
}
