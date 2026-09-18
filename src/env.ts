import { z } from 'zod'

/**
 * Typed, validated access to build-time env vars.
 * Fails fast at startup instead of surfacing `undefined` deep in a component.
 */
const envSchema = z.object({
  VITE_POSTHOG_KEY: z.string().optional(),
  VITE_POSTHOG_HOST: z.url().default('https://us.i.posthog.com'),
  // v5 Phase 5.1 (T5): unset in every fresh clone and in CI by design (I1)
  // -- src/auth/AuthProvider.tsx's whole env-var gate hinges on this being
  // optional/undefined rather than required, so the entire auth module
  // renders the signed-out experience and mounts nothing Clerk-related.
  VITE_CLERK_PUBLISHABLE_KEY: z.string().optional(),
  // Dev-only PostHog identity fallback (see main.tsx) -- read only when
  // `import.meta.env.DEV` is true, so this is expected to be unset in
  // every fresh clone, in CI, and in every deployed build, same "unset by
  // design" posture as VITE_CLERK_PUBLISHABLE_KEY above. Never set outside
  // a local .env; must never reach .env.production or a deployed build's
  // environment config.
  VITE_DEV_IDENTITY_USER_ID: z.string().optional(),
})

export const env = envSchema.parse(import.meta.env)
