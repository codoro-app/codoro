/**
 * T5: Clerk's `appearance` prop, themed to the arena palette (dark
 * surfaces, lime accent) — passed to `<ClerkProvider>` so anything Clerk
 * itself renders (its own error/loading states, the rare fallback UI)
 * doesn't produce a stock white modal in a dark game. The actual sign-in/
 * sign-up forms are custom-built against `useSignIn`/`useSignUp` (see
 * SignInSheet.tsx) and don't use Clerk's themed components at all — this
 * exists for the surfaces Clerk still controls regardless.
 *
 * Values copied literally from src/index.css's default-theme custom
 * properties (not re-read from CSS at runtime -- Clerk's `appearance.variables`
 * takes literal values, not CSS var() references).
 */
export const CLERK_APPEARANCE = {
  variables: {
    colorPrimary: '#c6f83c',
    colorBackground: '#16181e',
    colorText: '#f3f2ee',
    colorTextSecondary: '#a3a6b0',
    colorInputBackground: '#20232b',
    colorInputText: '#f3f2ee',
    colorDanger: '#ff5470',
    borderRadius: '8px',
    fontFamily: "'Space Grotesk', sans-serif",
  },
} as const
