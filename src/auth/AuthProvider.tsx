/**
 * T5 — I1's test hook: `VITE_CLERK_PUBLISHABLE_KEY` unset ⇒ this renders
 * `children` directly, no lazy import ever fires, and nothing
 * Clerk-related mounts. This is what keeps a fresh clone and CI green with
 * no key configured, and it's the only place that decision is made — every
 * consumer (AccountSection, SignInSheet, the signup-prompt host) renders
 * unconditionally inside `<AuthProvider>` and lets this component decide.
 *
 * F8: never imported from a play route (App.tsx's practice/daily/rush/boss/
 * trace/missions chunks) — only from surfaces that are themselves already
 * behind their own lazy boundary (Settings' account section, a signup
 * prompt sheet rendered from a specific trigger page). Because this module
 * itself has no static import of `@clerk/react` (that's ClerkBoundary.tsx,
 * loaded via `lazy()` below), simply importing AuthProvider costs nothing —
 * the actual `@clerk/react` fetch only happens if `hasClerkKey` is true AND
 * a consumer actually renders `<AuthProvider>`.
 */
import { lazy, Suspense, type ReactNode } from 'react'
import { env } from '../env'

const ClerkBoundary = lazy(async () => ({
  default: (await import('./ClerkBoundary')).ClerkBoundary,
}))

export const hasClerkKey = Boolean(env.VITE_CLERK_PUBLISHABLE_KEY)

export interface AuthProviderProps {
  children: ReactNode
  /**
   * Rendered while ClerkBoundary's chunk is loading. Defaults to `null`
   * (a brief blank instant, since the chunk is small and this only ever
   * fires once per session) rather than `children` itself — `children`
   * is only ever mounted for real *inside* ClerkBoundary, after
   * `<ClerkProvider>` is already an ancestor, specifically so a consumer
   * that calls Clerk hooks (useAuth, useUser, ...) at its own top level
   * never renders without that context existing. Pass a hook-free
   * skeleton here if a loading state is worth showing for a given surface.
   */
  fallback?: ReactNode
}

export function AuthProvider({ children, fallback = null }: AuthProviderProps) {
  if (!env.VITE_CLERK_PUBLISHABLE_KEY) {
    return <>{children}</>
  }

  return (
    <Suspense fallback={fallback}>
      <ClerkBoundary publishableKey={env.VITE_CLERK_PUBLISHABLE_KEY}>{children}</ClerkBoundary>
    </Suspense>
  )
}
