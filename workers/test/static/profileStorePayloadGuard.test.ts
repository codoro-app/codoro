import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// S2 (profileStore boundary): profiles.payload is the only field in the
// schema with unbounded per-user growth and no natural retention policy --
// the eventual R2 migration mentioned in the amendment becomes a swap
// behind profileStore.ts instead of a refactor of every sync path. This
// test is the enforcement, not the comment: it fails if the literal string
// "payload" appears anywhere in workers/src outside profileStore.ts itself.
// Same shape/spirit as src/app/routes.test.ts's SW navigateFallbackDenylist
// drift guard (readFileSync against real source, not a copy of the rule
// under test) -- but lives here, in the "static" Vitest project (see
// vitest.config.ts), because it needs an unbounded filesystem walk that the
// workerd-backed "workers" project's sandboxed test files cannot do.
//
// Scoped to workers/src deliberately, not workers/shared or workers/test:
// this rule is about *application code* accidentally reaching around
// profileStore to touch the column directly. workers/shared/api-types.ts's
// future PUT /api/profile body type (T7) will legitimately have a
// `payload: string` wire-format field with the same name for a different
// (decompressed JSON, not the D1 column) concept -- that's a T7 decision,
// not this guard's concern. Test fixtures under workers/test/ legitimately
// reference the column name directly when seeding/asserting raw schema
// state (e.g. migrations.test.ts's cascade test) -- also out of scope here.
function collectTsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return collectTsFiles(full)
    return entry.name.endsWith('.ts') ? [full] : []
  })
}

describe('profiles.payload boundary (S2)', () => {
  const srcDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'src')

  it('touches the literal string "payload" only in profileStore.ts', () => {
    const offenders = collectTsFiles(srcDir)
      .filter((file) => relative(srcDir, file) !== 'profileStore.ts')
      .filter((file) => readFileSync(file, 'utf-8').includes('payload'))
      .map((file) => relative(srcDir, file))

    expect(
      offenders,
      `payload referenced outside profileStore.ts: ${offenders.join(', ')}`,
    ).toEqual([])
  })

  it('sanity: profileStore.ts itself does reference "payload" (the guard above isn\'t vacuously true)', () => {
    const source = readFileSync(join(srcDir, 'profileStore.ts'), 'utf-8')
    expect(source).toContain('payload')
  })
})
