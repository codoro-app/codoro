import { readFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * F25's grep guard, kept even under the "wrap saveProfile()" design
 * (option 1) per the Phase 5.2 plan's own recommendation: option 1 makes it
 * structurally impossible for a *saveProfile() caller* to forget to notify
 * the sync engine (saveProfile() itself always does), but nothing stops a
 * *new* file from bypassing saveProfile() entirely and writing to
 * PROFILE_STORE directly (via `db.put`/`objectStore(...).put` against the
 * IndexedDB store), which would skip the notify hook the same way a missed
 * per-call-site convention would have under option 2.
 *
 * This test reads the real source of every .ts file under src/storage/ (the
 * only place PROFILE_STORE is legitimately reachable at all -- outside
 * callers only ever see it through profile.ts's saveProfile()/loadProfile())
 * and asserts that only the two already-known, already-audited exceptions
 * write to it directly:
 *
 *  - profile.ts itself (saveProfile()/loadProfile()'s own putProfile()) --
 *    the one place this is supposed to happen.
 *  - exportImport.ts (importData()/commitImport()) -- a deliberately
 *    separate, wholesale-replace path for user-initiated import, documented
 *    in that file's own top comment as intentionally not routed through
 *    saveProfile()'s single-field-write contract.
 *
 * Same shape as workers/test/static/appOriginsGuard.test.ts (T7b) and this
 * repo's other readFileSync-against-real-source structural guards -- a
 * regression test against a *new* bypass appearing, not a claim that no
 * bypass exists today (there are exactly two, both already accounted for).
 */
describe('PROFILE_STORE direct-write guard (F25)', () => {
  const storageDir = dirname(fileURLToPath(import.meta.url))
  const DIRECT_WRITE_PATTERN =
    /\.(?:put|delete|clear)\(\s*PROFILE_STORE\b|objectStore\(PROFILE_STORE\)\.(?:put|delete|clear)\(/

  const KNOWN_DIRECT_WRITERS = new Set(['profile.ts', 'exportImport.ts'])

  function sourceFiles(): string[] {
    return readdirSync(storageDir)
      .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
      .filter((name) => name !== 'db.ts') // db.ts only *declares* PROFILE_STORE, never writes through it itself
  }

  it('every known writer that references PROFILE_STORE directly is on the audited allowlist', () => {
    const offenders: string[] = []
    for (const file of sourceFiles()) {
      const text = readFileSync(join(storageDir, file), 'utf-8')
      if (DIRECT_WRITE_PATTERN.test(text) && !KNOWN_DIRECT_WRITERS.has(file)) {
        offenders.push(file)
      }
    }
    expect(offenders).toEqual([])
  })

  it('the allowlist is not vacuous -- both known writers still actually reference PROFILE_STORE today', () => {
    for (const file of KNOWN_DIRECT_WRITERS) {
      const text = readFileSync(join(storageDir, file), 'utf-8')
      expect(DIRECT_WRITE_PATTERN.test(text)).toBe(true)
    }
  })

  it('saveProfile() itself is the only PROFILE_STORE writer outside the storage directory tree', () => {
    // A coarse but real check: nothing outside src/storage/ should import
    // PROFILE_STORE at all (it's an implementation detail per index.ts's
    // own "public entry point" doc comment) -- if it's never importable
    // from outside, it can never be written to from outside either.
    const srcDir = join(storageDir, '..')
    const offenders: string[] = []
    function walk(dir: string): void {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === 'storage' || entry.name === 'node_modules') continue
          walk(full)
        } else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) {
          const text = readFileSync(full, 'utf-8')
          if (/\bPROFILE_STORE\b/.test(text)) {
            offenders.push(relative(srcDir, full))
          }
        }
      }
    }
    walk(srcDir)
    expect(offenders).toEqual([])
  })
})
