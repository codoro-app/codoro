import { z } from 'zod'

/**
 * Typed, validated access to build-time env vars.
 * Fails fast at startup instead of surfacing `undefined` deep in a component.
 */
const envSchema = z.object({
  VITE_POSTHOG_KEY: z.string().optional(),
  VITE_POSTHOG_HOST: z.url().default('https://us.i.posthog.com'),
})

export const env = envSchema.parse(import.meta.env)
