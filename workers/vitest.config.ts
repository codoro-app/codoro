import { defineConfig } from 'vitest/config'
import { cloudflareTest } from '@cloudflare/vitest-pool-workers'

// Tests run *inside workerd* via real local Miniflare bindings (D1, rate
// limiters) sourced from wrangler.jsonc's `dev` env — not jsdom, not node,
// and not a real Cloudflare account. This is the property F5/F7 depend on:
// `pnpm validate` must be green from a fresh clone with zero Cloudflare
// credentials, because it's the concrete evidence the D1-over-Postgres
// decision was made on (docs/v5-build-plan.md amendment section A).
//
// F7: the installed version (0.22.0) targets Vitest 4's Test Projects API —
// a Vite plugin (`cloudflareTest`), not the `defineWorkersConfig()` wrapper
// the plan's Vitest-3-era examples describe. Checked at install; the
// `wrangler: { configPath, environment }` option shape is unchanged.
export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc', environment: 'dev' } })],
})
