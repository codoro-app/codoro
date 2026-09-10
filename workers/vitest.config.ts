// Node's own URL/fileURLToPath, explicitly -- workers/tsconfig.json's global
// "@cloudflare/workers-types" types apply to this file too (it's covered by
// the same "include"), which shadows the ambient `URL` global with the
// Workers-runtime one and makes it incompatible with fileURLToPath's
// expected `import("url").URL` parameter type. Importing both from
// 'node:url' sidesteps the clash instead of relying on either global.
import { URL, fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-pool-workers'

// Two Vitest 4 "projects" (F7: 0.22.0 targets the Test Projects API, not
// vitest.workspace.ts) sharing this one config file:
//
// - "workers": the real suite, running *inside workerd* via local Miniflare
//   bindings (D1, rate limiters) sourced from wrangler.jsonc's `dev` env --
//   not jsdom, not node, and not a real Cloudflare account. This is the
//   property F5/F7 depend on: `pnpm validate` must be green from a fresh
//   clone with zero Cloudflare credentials (docs/v5-build-plan.md amendment
//   section A).
// - "static": plain Node, no workerd. workerd test files can't do an
//   unbounded filesystem walk of arbitrary source directories (no real host
//   fs inside the sandbox), so the profileStore payload-boundary drift
//   guard (T2a) -- same readFileSync-against-real-source shape as
//   src/app/routes.test.ts's SW denylist guard -- runs here instead.
//
// readD1Migrations() (T2) reads the real workers/migrations/*.sql files at
// config-build time and hands them to the "workers" project as a
// TEST_MIGRATIONS binding (see test/support/migrations.ts) -- test state
// and deployed state come from the exact same files, never a copy.
export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        plugins: [
          cloudflareTest(async () => ({
            wrangler: { configPath: './wrangler.jsonc', environment: 'dev' },
            miniflare: {
              bindings: {
                TEST_MIGRATIONS: await readD1Migrations(
                  fileURLToPath(new URL('./migrations', import.meta.url)),
                ),
              },
            },
          })),
        ],
        test: {
          name: 'workers',
          include: ['test/**/*.test.ts'],
          exclude: ['test/static/**'],
        },
      },
      {
        extends: true,
        test: {
          name: 'static',
          environment: 'node',
          include: ['test/static/**/*.test.ts'],
        },
      },
    ],
  },
})
