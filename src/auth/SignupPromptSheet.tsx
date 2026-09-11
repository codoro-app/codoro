/**
 * T5: the bottom sheet rendered at a signup-value-moment trigger (approved
 * mockup design — dark surface, lime icon chip, one-tap dismiss). Purely
 * presentational: the calling trigger site owns *whether* to render this at
 * all (via `useSignupPrompt().canShow`, signupPrompts.ts) and calls
 * `onShown` once when it mounts — this component itself never decides
 * whether it's allowed to appear.
 *
 * "Create account" opens the same `<SignInSheet>` used everywhere else,
 * inside its own `<AuthProvider>` — a signup prompt is exactly the kind of
 * surface that's fine to pull in Clerk's chunk for, since by construction
 * it only renders when the cap logic has already decided to show it (at
 * most once per trigger, globally rate-limited to one per 7 days).
 */
import { lazy, Suspense, useEffect, useState } from 'react'
import { AuthProvider } from './AuthProvider'

// Lazy for the same reason AccountSection.tsx's identical import is lazy --
// see that file's doc comment for the real Rollup CSS-chunking bug this
// avoids (a shared module statically imported from two separate lazy
// chunks produced a dead CSS-preload reference that crashed the page).
const SignInSheet = lazy(async () => ({ default: (await import('./SignInSheet')).SignInSheet }))

export interface SignupPromptCopy {
  icon: string
  title: string
  body: string
}

export interface SignupPromptSheetProps {
  copy: SignupPromptCopy
  /** Called exactly once, when this sheet actually renders (mounts). */
  onShown: () => void
  /** "Not now" or backdrop tap — dismissible in one tap, per the build plan. */
  onDismiss: () => void
  /** "Don't ask again" — permanent opt-out. */
  onOptOut: () => void
}

const SHEET_CLASS =
  'fixed inset-x-0 bottom-0 z-30 py-5 px-5 rounded-t-lg border-t border-x border-border bg-surface-1'
const BACKDROP_CLASS = 'fixed inset-0 z-30 bg-surface-0/60'

export function SignupPromptSheet({ copy, onShown, onDismiss, onOptOut }: SignupPromptSheetProps) {
  const [showSignIn, setShowSignIn] = useState(false)

  useEffect(() => {
    onShown()
    // Fires once, on mount only -- `onShown` marks the trigger consumed in
    // the cap state, which must happen exactly once per real appearance,
    // not per render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (showSignIn) {
    return (
      <>
        <div className={BACKDROP_CLASS} onClick={onDismiss} />
        <div className={SHEET_CLASS} role="dialog" aria-modal="true" aria-label="Create account">
          <AuthProvider>
            <Suspense fallback={null}>
              <SignInSheet onComplete={onDismiss} />
            </Suspense>
          </AuthProvider>
        </div>
      </>
    )
  }

  return (
    <>
      <div className={BACKDROP_CLASS} onClick={onDismiss} />
      <div className={SHEET_CLASS} role="dialog" aria-modal="true" aria-label={copy.title}>
        <div className="w-9 h-1 rounded-full bg-border-strong mx-auto mb-4" aria-hidden="true" />
        <div
          className="w-10 h-10 rounded-md bg-accent-dim text-accent flex items-center justify-center text-lg mb-3"
          aria-hidden="true"
        >
          {copy.icon}
        </div>
        <p className="m-0 mb-1.5 text-md font-bold text-text-0">{copy.title}</p>
        <p className="m-0 mb-4 text-sm text-text-1">{copy.body}</p>
        <div className="flex flex-col gap-2">
          <button
            type="button"
            className="min-h-11 py-3 px-4 rounded-md border-0 bg-accent text-accent-ink text-md font-bold cursor-pointer"
            onClick={() => {
              setShowSignIn(true)
            }}
          >
            Create account
          </button>
          <button
            type="button"
            className="min-h-11 py-3 px-4 rounded-md border border-border-strong bg-transparent text-text-0 text-md font-semibold cursor-pointer"
            onClick={onDismiss}
          >
            Not now
          </button>
        </div>
        <button
          type="button"
          className="block mx-auto mt-3 text-xs text-text-2 underline underline-offset-2 bg-transparent border-0 cursor-pointer"
          onClick={onOptOut}
        >
          Don&apos;t ask again
        </button>
      </div>
    </>
  )
}
