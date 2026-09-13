import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'

// T7b/F29: the guard that makes the dev-side APP_ORIGINS widening safe.
// Piece 1 turns APP_ORIGIN into a comma-separated allow-list so dev can
// list `http://localhost:5173` (and, at deploy time, a LAN-IP origin for a
// two-real-devices pass) -- but if a dev origin ever leaked into
// production's value, clerkAuth() would start accepting tokens minted for
// a non-production frontend. This test reads the real wrangler.jsonc (not
// a copy of its values) and asserts production's APP_ORIGINS parses to
// exactly one entry, the real production origin -- same shape/spirit as
// profileStorePayloadGuard.test.ts's readFileSync-against-real-source
// drift guard, and lives in the "static" Vitest project for the same
// reason (plain Node, not workerd).
//
// wrangler.jsonc is JSONC (`//` comments), not plain JSON -- naively
// stripping `//` would corrupt values like "https://getcodoro.com" that
// contain "//" themselves. `ts.parseConfigFileTextToJson` is TypeScript's
// own tolerant tsconfig-style JSONC parser (comments, trailing commas)
// against a dependency this repo already has (`typescript`), so this adds
// no new dependency.
describe('wrangler.jsonc APP_ORIGINS (T7b/F29)', () => {
  const wranglerPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'wrangler.jsonc')

  interface WranglerConfig {
    env: { production: { vars: { APP_ORIGINS: string } }; dev: { vars: { APP_ORIGINS: string } } }
  }

  function readWranglerConfig(): WranglerConfig {
    const text = readFileSync(wranglerPath, 'utf-8')
    const result = ts.parseConfigFileTextToJson(wranglerPath, text)
    if (result.error) {
      throw new Error(`Failed to parse wrangler.jsonc: ${JSON.stringify(result.error)}`)
    }
    return result.config as WranglerConfig
  }

  it('production\'s APP_ORIGINS parses to exactly ["https://getcodoro.com"]', () => {
    const config = readWranglerConfig()
    const parsed = config.env.production.vars.APP_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    expect(parsed).toEqual(['https://getcodoro.com'])
  })

  it("sanity: dev's APP_ORIGINS is not the same single-entry value (the guard above isn't vacuously true)", () => {
    const config = readWranglerConfig()
    expect(config.env.dev.vars.APP_ORIGINS).not.toBe('https://getcodoro.com')
  })
})
