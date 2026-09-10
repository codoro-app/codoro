import { applyD1Migrations } from 'cloudflare:test'
import { env } from 'cloudflare:workers'

// applyD1Migrations only exists on cloudflare:test (cloudflare:workers has
// no equivalent) -- T1's amendment prefers cloudflare:workers's `env` over
// cloudflare:test's deprecated one, so only the one helper that has no
// other home is imported from cloudflare:test here; `env` itself comes from
// cloudflare:workers everywhere in this test suite. env.TEST_MIGRATIONS'
// type comes from ./testEnv.d.ts, an ambient global augmentation picked up
// automatically via tsconfig.json's "include" -- no explicit import needed
// (or resolvable: it has no runtime module to import, only types).

/**
 * Applies the full migration chain (0001, 0002, ...) from the real
 * workers/migrations/*.sql files -- see vitest.config.ts's
 * readD1Migrations() call, which populates env.TEST_MIGRATIONS. Each `it()`
 * gets fresh, isolated D1 storage by default, so this must be called
 * explicitly per test rather than once for the whole file.
 */
export async function applyAllMigrations(): Promise<void> {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS)
}

/**
 * Applies only the first `count` migrations, in order. Migration-by-
 * migration seed/apply/assert tests use this to control exactly how far
 * the schema has progressed before seeding and asserting -- the isolated-
 * migration-test convention carried from the client (see migrations.test.ts).
 */
export async function applyMigrationsUpTo(count: number): Promise<void> {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS.slice(0, count))
}
