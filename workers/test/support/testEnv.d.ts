import type { D1Migration } from '@cloudflare/vitest-pool-workers'

/**
 * TEST_MIGRATIONS is injected only by vitest.config.ts's cloudflareTest()
 * miniflare.bindings (see readD1Migrations() there) -- it never exists in
 * the real deployed Worker, so it's declared here (test/) rather than in
 * src/env.d.ts, additive to the same Cloudflare.Env merge via declaration
 * merging.
 */
declare global {
  namespace Cloudflare {
    interface Env {
      TEST_MIGRATIONS: D1Migration[]
    }
  }
}

export {}
