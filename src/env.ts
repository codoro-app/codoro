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
})

export const env = envSchema.parse(import.meta.env)
