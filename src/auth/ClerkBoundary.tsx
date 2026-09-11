/**
 * T5 (F8): the ONLY file in this app that statically imports `@clerk/react`.
 * Everything else reaches Clerk through `<AuthProvider>` (AuthProvider.tsx),
 * which dynamically `import()`s this module — so `@clerk/react`'s bytes are
 * only ever fetched when AuthProvider has already decided a publishable key
 * exists, and only by whichever route/interaction actually mounted
 * AuthProvider (never `/practice` or any other play route, none of which
 * import AuthProvider at all).
 */
import { ClerkProvider } from '@clerk/react'
import type { ReactNode } from 'react'
import { CLERK_APPEARANCE } from './clerkAppearance'

export function ClerkBoundary({
  publishableKey,
  children,
}: {
  publishableKey: string
  children: ReactNode
}) {
  return (
    <ClerkProvider publishableKey={publishableKey} appearance={CLERK_APPEARANCE}>
      {children}
    </ClerkProvider>
  )
}
