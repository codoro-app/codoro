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
 *
 * Email verification step (added after v5.1 shipped without it): creating
 * a sign-up does NOT send a verification email on its own -- Clerk only
 * sends it once `prepareEmailAddressVerification` is explicitly called.
 * The original handleSubmit called `signUp.create()`, saw a non-'complete'
 * status, and just told the user to "check your email" without ever
 * asking Clerk to send anything (confirmed in production: zero email-send
 * events in Clerk's own Logs for any of those attempts). This file now
 * calls prepare immediately after a non-complete create(), and adds the
 * code-entry stage + attemptEmailAddressVerification to actually finish
 * the round trip.
 */
import { useEffect, useState } from 'react'
import { useClerk } from '@clerk/react'
import { useSignIn, useSignUp } from '@clerk/react/legacy'

type Mode = 'sign-in' | 'sign-up'
/** 'verify-email' only ever follows a sign-up whose create() came back
 * needing email verification -- sign-in never enters it. */
type Stage = 'credentials' | 'verify-email'

const RESEND_COOLDOWN_SECONDS = 30

const FIELD_CLASS =
  'w-full min-h-11 py-[11px] px-3 rounded-md border border-border bg-surface-1 text-text-0 text-md'
const PRIMARY_BUTTON_CLASS =
  'min-h-11 w-full mt-1.5 py-3 px-4 rounded-md border-0 bg-accent text-accent-ink text-md font-bold cursor-pointer disabled:opacity-60 disabled:cursor-default'
const SWITCH_LINE_CLASS = 'text-center text-sm text-text-1 mt-4'
const LINK_BUTTON_CLASS = 'text-accent font-bold bg-transparent border-0 cursor-pointer p-0'

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
  const [stage, setStage] = useState<Stage>('credentials')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [verifying, setVerifying] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)

  const { isLoaded: signInLoaded, signIn } = useSignIn()
  const { isLoaded: signUpLoaded, signUp } = useSignUp()
  const { setActive } = useClerk()

  const isLoaded = mode === 'sign-in' ? signInLoaded : signUpLoaded

  // Ticks the resend cooldown down to 0 once a second; re-armed by every
  // prepare call (initial send and each resend) via setResendCooldown.
  useEffect(() => {
    if (resendCooldown <= 0) return
    const id = setInterval(() => {
      setResendCooldown((seconds) => Math.max(0, seconds - 1))
    }, 1000)
    return () => {
      clearInterval(id)
    }
  }, [resendCooldown])

  function switchMode(next: Mode) {
    setMode(next)
    setStage('credentials')
    setCode('')
    setError(null)
  }

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
          // Ask Clerk to actually send the code -- create() alone never
          // triggers it (see file header). A failure here still moves to
          // the verify stage so "Resend code" is right there as the retry.
          try {
            await signUp.prepareEmailAddressVerification({ strategy: 'email_code' })
          } catch {
            setError('Could not send the verification email. Use "Resend code" to try again.')
          }
          setStage('verify-email')
          setResendCooldown(RESEND_COOLDOWN_SECONDS)
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

  async function handleVerify(event: React.SyntheticEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (!signUp || verifying) return
    setVerifying(true)
    try {
      const attempt = await signUp.attemptEmailAddressVerification({ code })
      if (attempt.status === 'complete') {
        await setActive({ session: attempt.createdSessionId })
        onComplete()
      } else {
        setError("That code didn't work. Double-check it and try again.")
      }
    } catch {
      setError("That code didn't work. Double-check it and try again.")
    } finally {
      setVerifying(false)
    }
  }

  async function handleResend() {
    if (!signUp || resending || resendCooldown > 0) return
    setError(null)
    setResending(true)
    try {
      await signUp.prepareEmailAddressVerification({ strategy: 'email_code' })
      setResendCooldown(RESEND_COOLDOWN_SECONDS)
    } catch {
      setError('Could not resend the code. Try again in a moment.')
    } finally {
      setResending(false)
    }
  }

  if (stage === 'verify-email') {
    return (
      <form onSubmit={(event) => void handleVerify(event)} className="flex flex-col gap-3">
        <p className="text-xs uppercase tracking-wide text-text-2 m-0">Almost there</p>
        <p className="text-xl font-bold text-text-0 m-0">Check your email</p>
        <p className="text-sm text-text-1 m-0 mb-1">
          We sent a 6-digit code to <span className="text-text-0 font-semibold">{email}</span>.
        </p>

        <label className="text-xs font-semibold text-text-1" htmlFor="auth-verify-code">
          Verification code
        </label>
        <input
          id="auth-verify-code"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          maxLength={6}
          required
          aria-describedby={error ? 'auth-verify-error' : undefined}
          value={code}
          onChange={(event) => {
            setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
          }}
          className={`${FIELD_CLASS} tracking-[0.3em] text-center`}
        />

        {error && (
          <p id="auth-verify-error" className="text-sm text-danger m-0" role="alert">
            {error}
          </p>
        )}

        <button
          type="submit"
          className={PRIMARY_BUTTON_CLASS}
          disabled={verifying || code.length < 6}
        >
          {verifying ? 'Verifying…' : 'Verify email'}
        </button>

        <p className={SWITCH_LINE_CLASS}>
          {resendCooldown > 0 ? (
            <>Resend code in {resendCooldown}s</>
          ) : (
            <>
              Didn't get it?{' '}
              <button
                type="button"
                className={LINK_BUTTON_CLASS}
                disabled={resending}
                onClick={() => void handleResend()}
              >
                {resending ? 'Sending…' : 'Resend code'}
              </button>
            </>
          )}
        </p>
        <p className={SWITCH_LINE_CLASS}>
          <button
            type="button"
            className={LINK_BUTTON_CLASS}
            onClick={() => {
              switchMode('sign-up')
            }}
          >
            Use a different email
          </button>
        </p>
      </form>
    )
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
        // Clerk's Production password policy requires 10+ (Configure > User
        // & authentication > Password) -- scoped to sign-up only so a future
        // account with a shorter pre-policy password can still sign in.
        minLength={mode === 'sign-up' ? 10 : undefined}
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
              className={LINK_BUTTON_CLASS}
              onClick={() => {
                switchMode('sign-up')
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
              className={LINK_BUTTON_CLASS}
              onClick={() => {
                switchMode('sign-in')
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
