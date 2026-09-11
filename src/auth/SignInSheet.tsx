/**
 * T5: custom sign-in/sign-up, built directly against `useSignIn`/
 * `useSignUp` — never the prebuilt `<SignIn/>`/`<SignUp/>` components
 * (locked decision: no stock white modal in a dark game, and the
 * branding-verification precondition only covers a hook-based flow).
 *
 * F7 platform surprise, worth recording: `@clerk/react` 6.15.2's *default*
 * `useSignIn`/`useSignUp` are a newer Signal-based API
 * (`{ signIn, errors, fetchStatus }`, no `isLoaded`/`.create()`) — a
 * different shape than every Clerk custom-flow doc and this plan's own
 * mental model describe. The classic, promise-based API this plan actually
 * means (`{ isLoaded, signIn, setActive }` / `.create()`) is still shipped,
 * at the `@clerk/react/legacy` subpath. Imported from there, deliberately.
 */
import { useState } from 'react'
import { useClerk } from '@clerk/react'
import { useSignIn, useSignUp } from '@clerk/react/legacy'

type Mode = 'sign-in' | 'sign-up'

const FIELD_CLASS =
  'w-full min-h-11 py-[11px] px-3 rounded-md border border-border bg-surface-1 text-text-0 text-md'
const PRIMARY_BUTTON_CLASS =
  'min-h-11 w-full mt-1.5 py-3 px-4 rounded-md border-0 bg-accent text-accent-ink text-md font-bold cursor-pointer disabled:opacity-60 disabled:cursor-default'
const SWITCH_LINE_CLASS = 'text-center text-sm text-text-1 mt-4'

export interface SignInSheetProps {
  /** Called after a sign-in or sign-up attempt completes successfully. */
  onComplete: () => void
}

/**
 * A single control housing both sign-in and sign-up, toggled by the
 * "Create one" / "Sign in" link — matches the mockup's two-frame design
 * collapsed into one component. Neither Clerk-hosted UI nor a Clerk
 * component renders here; every input, label and error string below is
 * this app's own markup.
 */
export function SignInSheet({ onComplete }: SignInSheetProps) {
  const [mode, setMode] = useState<Mode>('sign-in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const { isLoaded: signInLoaded, signIn } = useSignIn()
  const { isLoaded: signUpLoaded, signUp } = useSignUp()
  const { setActive } = useClerk()

  const isLoaded = mode === 'sign-in' ? signInLoaded : signUpLoaded

  async function handleSubmit(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (!isLoaded || submitting) return
    setSubmitting(true)
    try {
      if (mode === 'sign-in') {
        if (!signIn) throw new Error('not-ready')
        const attempt = await signIn.create({ identifier: email, password })
        if (attempt.status === 'complete') {
          await setActive({ session: attempt.createdSessionId })
          onComplete()
        } else {
          setError("Couldn't sign you in with that email and password.")
        }
      } else {
        if (!signUp) throw new Error('not-ready')
        const attempt = await signUp.create({ emailAddress: email, password })
        if (attempt.status === 'complete') {
          await setActive({ session: attempt.createdSessionId })
          onComplete()
        } else {
          // Email verification (Clerk's default Hobby-plan flow) is a
          // real follow-up step this component doesn't build yet -- v5.1's
          // scope is the round-trip working end to end for the common
          // case; a partial/needs-verification result surfaces honestly
          // rather than silently looking like success.
          setError('Almost there — check your email to finish creating your account.')
        }
      }
    } catch {
      setError(
        mode === 'sign-in'
          ? 'Wrong email or password.'
          : 'Could not create an account with that email.',
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={(event) => void handleSubmit(event)} className="flex flex-col gap-3">
      <p className="text-xs uppercase tracking-wide text-text-2 m-0">
        {mode === 'sign-in' ? 'Welcome back' : 'First time here'}
      </p>
      <p className="text-xl font-bold text-text-0 m-0">
        {mode === 'sign-in' ? 'Sign in to Codoro' : 'Create your account'}
      </p>
      <p className="text-sm text-text-1 m-0 mb-1">
        {mode === 'sign-in'
          ? 'Your streak and rating sync across devices once you’re in.'
          : 'Local play stays exactly as it is — this just adds sync and a name on the board.'}
      </p>

      <label className="text-xs font-semibold text-text-1" htmlFor="auth-email">
        Email
      </label>
      <input
        id="auth-email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => {
          setEmail(event.target.value)
        }}
        className={FIELD_CLASS}
      />

      <label className="text-xs font-semibold text-text-1" htmlFor="auth-password">
        Password
      </label>
      <input
        id="auth-password"
        type="password"
        autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
        required
        minLength={8}
        maxLength={64}
        value={password}
        onChange={(event) => {
          setPassword(event.target.value)
        }}
        className={FIELD_CLASS}
      />

      {error && (
        <p className="text-sm text-danger m-0" role="alert">
          {error}
        </p>
      )}

      {/*
       * Required mount point for Clerk's bot-protection CAPTCHA
       * (https://clerk.com/docs/guides/development/custom-flows/authentication/bot-sign-up-protection).
       * Without it, Clerk falls back to a pure "Invisible" check with
       * nowhere to render an interactive challenge if Cloudflare Turnstile
       * can't clear the visitor silently (seen in production: a
       * browser-extension-heavy session made Turnstile's invisible pass
       * fail, and with no div to escalate into, signUp.create() posted
       * with no captcha token and Clerk's backend rejected it with a 422).
       * Empty and invisible in the common case; Turnstile only renders
       * into it when an interactive challenge is actually needed.
       */}
      <div id="clerk-captcha" />

      <button type="submit" className={PRIMARY_BUTTON_CLASS} disabled={!isLoaded || submitting}>
        {submitting ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
      </button>

      <p className={SWITCH_LINE_CLASS}>
        {mode === 'sign-in' ? (
          <>
            No account yet?{' '}
            <button
              type="button"
              className="text-accent font-bold bg-transparent border-0 cursor-pointer p-0"
              onClick={() => {
                setMode('sign-up')
                setError(null)
              }}
            >
              Create one
            </button>
          </>
        ) : (
          <>
            Already have one?{' '}
            <button
              type="button"
              className="text-accent font-bold bg-transparent border-0 cursor-pointer p-0"
              onClick={() => {
                setMode('sign-in')
                setError(null)
              }}
            >
              Sign in
            </button>
          </>
        )}
      </p>
    </form>
  )
}
