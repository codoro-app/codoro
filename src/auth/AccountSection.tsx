/**
 * T5: the Settings "Account" section — signed-out CTA, signed-in state,
 * sign out, delete account. Mounted from SettingsPage.tsx, which is
 * already its own lazy route chunk (App.tsx's settingsImporter) — so this
 * whole module, and everything it imports, only ever loads when a player
 * actually navigates to /settings. None of the play routes import it.
 *
 * `AccountSectionBody` is the only thing in this file that calls a Clerk
 * hook (via useAuthToken/useClerk), and it is rendered exclusively as
 * `<AuthProvider>`'s children — never in the `!hasClerkKey` branch, and
 * never as AuthProvider's Suspense fallback (see AuthProvider.tsx's own
 * doc comment for why that split matters).
 */
import { useState } from 'react'
import { useClerk } from '@clerk/react'
import { AuthProvider, hasClerkKey } from './AuthProvider'
import { DeleteAccountDialog } from './DeleteAccountDialog'
import { SignInSheet } from './SignInSheet'
import { useAuthToken } from './useAuthToken'

const CARD_CLASS = 'rounded-md border border-border bg-surface-1 py-4 px-4'
const PRIMARY_BUTTON_CLASS =
  'min-h-11 w-full py-3 px-4 rounded-md border-0 bg-accent text-accent-ink text-md font-bold cursor-pointer'
const GHOST_BUTTON_CLASS =
  'min-h-11 w-full mt-3 py-3 px-4 rounded-md border border-border-strong bg-transparent text-text-0 text-md font-semibold cursor-pointer'
const DANGER_BUTTON_CLASS =
  'min-h-11 w-full mt-2 py-3 px-4 rounded-md border border-danger bg-transparent text-danger text-md font-semibold cursor-pointer'
const SHEET_OVERLAY_CLASS = 'fixed inset-0 z-30 flex items-end sm:items-center justify-center'
const SHEET_BACKDROP_CLASS = 'fixed inset-0 bg-surface-0/70'
const SHEET_CLASS =
  'relative w-full sm:max-w-[420px] py-6 px-5 rounded-t-lg sm:rounded-lg border border-border bg-surface-1'

function SignedOutCard({ onSignIn }: { onSignIn?: () => void }) {
  return (
    <div className={`${CARD_CLASS} text-center`}>
      <p className="m-0 mb-1 text-md font-bold text-text-0">Account</p>
      <p className="m-0 mb-4 text-sm text-text-1">
        Sign in to sync your progress and appear on named leaderboards. Playing without one works
        exactly the same.
      </p>
      {onSignIn ? (
        <button type="button" className={PRIMARY_BUTTON_CLASS} onClick={onSignIn}>
          Sign in or create account
        </button>
      ) : (
        // hasClerkKey is false -- this environment has no
        // VITE_CLERK_PUBLISHABLE_KEY configured (every fresh clone and CI,
        // by design, I1). No fake button that would do nothing if tapped.
        <p className="m-0 text-xs text-text-2">Accounts aren&apos;t configured in this build.</p>
      )}
    </div>
  )
}

function AccountSectionBody() {
  const { isLoaded, isSignedIn, email, getToken } = useAuthToken()
  const { signOut } = useClerk()
  const [showSignIn, setShowSignIn] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [deleted, setDeleted] = useState(false)

  if (deleted) {
    return (
      <div className={CARD_CLASS}>
        <p className="m-0 text-sm text-text-1" role="status">
          Your account has been deleted. Your local play history is unaffected.
        </p>
      </div>
    )
  }

  if (!isLoaded) {
    return <div className={CARD_CLASS} aria-hidden="true" />
  }

  if (!isSignedIn) {
    return (
      <>
        <SignedOutCard
          onSignIn={() => {
            setShowSignIn(true)
          }}
        />
        {showSignIn && (
          <div className={SHEET_OVERLAY_CLASS}>
            <div
              className={SHEET_BACKDROP_CLASS}
              onClick={() => {
                setShowSignIn(false)
              }}
            />
            <div className={SHEET_CLASS} role="dialog" aria-modal="true" aria-label="Sign in">
              <SignInSheet
                onComplete={() => {
                  setShowSignIn(false)
                }}
              />
            </div>
          </div>
        )}
      </>
    )
  }

  return (
    <div className={CARD_CLASS}>
      <p className="m-0 mb-1 text-md font-bold text-text-0">{email}</p>
      <p className="m-0 mb-3 text-xs text-text-1">Signed in</p>
      <button type="button" className={GHOST_BUTTON_CLASS} onClick={() => void signOut()}>
        Sign out
      </button>
      <button
        type="button"
        className={DANGER_BUTTON_CLASS}
        onClick={() => {
          setShowDelete(true)
        }}
      >
        Delete account…
      </button>
      {showDelete && (
        <DeleteAccountDialog
          confirmText={email ?? ''}
          getToken={getToken}
          onCancel={() => {
            setShowDelete(false)
          }}
          onDeleted={() => {
            setShowDelete(false)
            setDeleted(true)
          }}
        />
      )}
    </div>
  )
}

export function AccountSection() {
  if (!hasClerkKey) {
    return <SignedOutCard />
  }
  return (
    <AuthProvider fallback={<div className={CARD_CLASS} aria-hidden="true" />}>
      <AccountSectionBody />
    </AuthProvider>
  )
}
