/**
 * Name-prompt bottom sheet (challenge redesign) — shown by `ChallengeButton`
 * the first time a player creates a challenge on a profile with no saved
 * `challengerName` yet. Styled like `ShareMenu.tsx`'s own bottom sheet (same
 * scrim/grabber/rounded-top treatment, `--bottom-nav-height` offset, Escape/
 * scrim-click dismiss, body-scroll lock) — deliberately not a new visual
 * language, per the design doc's explicit instruction to reuse that pattern
 * rather than invent a second one.
 *
 * Skipping (Escape, the scrim, or the "Skip" button) never blocks sharing —
 * `onSkip` sends the challenge right away with no name, same as the
 * "blank/skipped name never blocks sharing" decision the design record
 * locks in. Only "Continue" with a non-blank name calls `onContinue`, which
 * is `ChallengeButton`'s cue to persist the name (via `useChallengerName`)
 * and then send using it.
 *
 * This is a one-time on-ramp, not the only place the name can ever be set —
 * `SettingsPage.tsx` has its own "Challenge a friend" section (a plain text
 * field, saved via the same `UserProfile.challengerName` field) so a player
 * isn't stuck with whatever they typed here the first time.
 */
import { useEffect, useState } from 'react'

export interface ChallengerNameSheetProps {
  /** Non-blank, trimmed by the caller — this component only forwards the raw input. */
  onContinue: (name: string) => void
  onSkip: () => void
}

// Mirrors UserProfileSchema's/ChallengePayloadSchema's own `challengerName`
// cap (src/storage/schema.ts, src/challenge/schema.ts) — the input simply
// can't produce a value either schema would reject.
const NAME_MAX_LENGTH = 40

const SHEET_CLASS =
  'fixed inset-x-0 bottom-[var(--bottom-nav-height)] lg:bottom-0 z-30 mx-auto w-full max-w-[var(--content-width-mobile)] max-h-[85dvh] overflow-y-auto flex flex-col gap-0.5 bg-surface-1 border border-border border-b-0 rounded-t-lg shadow-lg p-4 pb-[calc(var(--space-4)+env(safe-area-inset-bottom))]'

const INPUT_CLASS =
  'min-h-11 py-2 px-3 rounded-sm border border-border bg-surface-0 text-text-0 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

const SKIP_BUTTON_CLASS =
  'flex-1 min-h-11 py-2 px-3 rounded-sm border border-border bg-transparent text-text-1 font-semibold cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

const CONTINUE_BUTTON_CLASS =
  'flex-1 min-h-11 py-2 px-3 rounded-sm border-0 bg-accent text-accent-ink font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed transition-[transform,opacity] duration-[0.05s] ease-out active:scale-[0.98] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2'

export function ChallengerNameSheet({ onContinue, onSkip }: ChallengerNameSheetProps) {
  const [value, setValue] = useState('')

  // Same Escape-to-dismiss + body-scroll-lock pair as ShareMenu.tsx's own
  // sheet effect — Escape here means "skip", matching what dismissing this
  // sheet any other way (the scrim) already means below.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onSkip()
    }
    document.addEventListener('keydown', handleKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
    }
  }, [onSkip])

  const trimmed = value.trim()

  return (
    <>
      <div className="fixed inset-0 z-30 bg-black/55" onClick={onSkip} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Your name"
        className={SHEET_CLASS}
        onClick={(event) => {
          event.stopPropagation()
        }}
      >
        <div className="w-9 h-1 rounded-full bg-border self-center mb-3" aria-hidden="true" />
        <p className="m-0 mb-1 text-text-0 font-bold">What should we call you?</p>
        <p className="m-0 mb-3 text-sm text-text-1">
          Shown to whoever you challenge — e.g. &ldquo;Alex challenged you!&rdquo; You can change
          this anytime in Settings.
        </p>
        <label htmlFor="challenger-name-input" className="sr-only">
          Your name
        </label>
        <input
          id="challenger-name-input"
          autoFocus
          type="text"
          value={value}
          maxLength={NAME_MAX_LENGTH}
          placeholder="Your name"
          className={INPUT_CLASS}
          onChange={(event) => {
            setValue(event.target.value)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && trimmed.length > 0) onContinue(trimmed)
          }}
        />
        <div className="flex gap-2 mt-3">
          <button type="button" className={SKIP_BUTTON_CLASS} onClick={onSkip}>
            Skip
          </button>
          <button
            type="button"
            className={CONTINUE_BUTTON_CLASS}
            disabled={trimmed.length === 0}
            onClick={() => {
              onContinue(trimmed)
            }}
          >
            Continue
          </button>
        </div>
      </div>
    </>
  )
}
