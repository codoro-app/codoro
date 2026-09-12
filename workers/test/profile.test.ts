import { env } from 'cloudflare:workers'
import { beforeAll, describe, expect, it } from 'vitest'
import { insertUser } from '../src/db'
import app from '../src/index'
import type { Env } from '../src/env'
import type {
  ApiErrorResponse,
  ProfileConflictResponse,
  ProfileGetResponse,
  ProfilePutResponse,
} from '../shared/api-types'
import { applyAllMigrations } from './support/migrations'
import { generateTestKeypair, signTestToken } from './support/jwt'
import type { TestKeypair } from './support/jwt'

const TEST_ORIGIN = 'https://getcodoro.test'

describe('PUT/GET /api/profile (T7)', () => {
  let keypair: TestKeypair

  const testEnv = (): Env => ({
    ...env,
    CLERK_JWT_KEY: keypair.publicKeyPem,
    CLERK_SECRET_KEY: 'test-secret-not-real',
    APP_ORIGIN: TEST_ORIGIN,
  })

  beforeAll(async () => {
    await applyAllMigrations()
    keypair = await generateTestKeypair()
  })

  async function tokenFor(sub: string): Promise<string> {
    return signTestToken({ privateKey: keypair.privateKey, sub, azp: TEST_ORIGIN })
  }

  function put(body: unknown, token: string | undefined, ip: string) {
    return app.request(
      '/api/profile',
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'CF-Connecting-IP': ip,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(body),
      },
      testEnv(),
    )
  }

  function get(token: string | undefined, ip: string) {
    return app.request(
      '/api/profile',
      {
        method: 'GET',
        headers: {
          'CF-Connecting-IP': ip,
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      },
      testEnv(),
    )
  }

  it('rejects PUT with no token', async () => {
    const res = await put(
      { schemaVersion: 1, payload: {}, baseRevision: 0 },
      undefined,
      '203.0.113.1',
    )
    expect(res.status).toBe(401)
  })

  it('rejects GET with no token', async () => {
    const res = await get(undefined, '203.0.113.2')
    expect(res.status).toBe(401)
  })

  it('404s on GET for a signed-in user with no profile row yet', async () => {
    const userId = 'profile_user_get404'
    await insertUser(env.DB, { clerk_user_id: userId, created_at: Date.now() })
    const res = await get(await tokenFor(userId), '203.0.113.3')
    expect(res.status).toBe(404)
  })

  it('rejects a malformed body with 400', async () => {
    const userId = 'profile_user_badbody'
    await insertUser(env.DB, { clerk_user_id: userId, created_at: Date.now() })
    const res = await put({ schemaVersion: 'not-a-number' }, await tokenFor(userId), '203.0.113.4')
    expect(res.status).toBe(400)
  })

  it('first PUT creates the row at revision 1 (201), then GET returns it', async () => {
    const userId = 'profile_user_first'
    const token = await tokenFor(userId)
    const payload = { rating: 1200, attempts: [] }

    const putRes = await put({ schemaVersion: 13, payload, baseRevision: 0 }, token, '203.0.113.5')
    expect(putRes.status).toBe(201)
    const putBody: ProfilePutResponse = await putRes.json()
    expect(putBody).toEqual({ ok: true, revision: 1 })

    const getRes = await get(token, '203.0.113.5')
    expect(getRes.status).toBe(200)
    const getBody: ProfileGetResponse = await getRes.json()
    expect(getBody.revision).toBe(1)
    expect(getBody.schemaVersion).toBe(13)
    expect(getBody.payload).toEqual(payload)
    expect(typeof getBody.updatedAt).toBe('number')
  })

  it('a second PUT with the correct baseRevision succeeds (200) and increments revision', async () => {
    const userId = 'profile_user_second'
    const token = await tokenFor(userId)
    await put({ schemaVersion: 13, payload: { v: 1 }, baseRevision: 0 }, token, '203.0.113.6')

    const res = await put(
      { schemaVersion: 13, payload: { v: 2 }, baseRevision: 1 },
      token,
      '203.0.113.6',
    )
    expect(res.status).toBe(200)
    const body: ProfilePutResponse = await res.json()
    expect(body).toEqual({ ok: true, revision: 2 })

    const getRes = await get(token, '203.0.113.6')
    const getBody: ProfileGetResponse = await getRes.json()
    expect(getBody.payload).toEqual({ v: 2 })
  })

  it('two writers racing from the same baseRevision: exactly one 200/201, one 409 with current state', async () => {
    const userId = 'profile_user_race'
    const token = await tokenFor(userId)
    await put({ schemaVersion: 13, payload: { v: 'base' }, baseRevision: 0 }, token, '203.0.113.7')

    const [resA, resB] = await Promise.all([
      put({ schemaVersion: 13, payload: { v: 'A' }, baseRevision: 1 }, token, '203.0.113.7'),
      put({ schemaVersion: 13, payload: { v: 'B' }, baseRevision: 1 }, token, '203.0.113.7'),
    ])
    const statuses = [resA.status, resB.status].sort()
    expect(statuses).toEqual([200, 409])

    const conflictRes = resA.status === 409 ? resA : resB
    const conflictBody: ProfileConflictResponse = await conflictRes.json()
    expect(conflictBody.error).toBe('Conflict')
    expect(conflictBody.current.revision).toBe(2)
    expect(['A', 'B']).toContain((conflictBody.current.payload as { v: string }).v)
  })

  it('accepts a 256 KB payload, rejects a 257 KB one', async () => {
    const userId256 = 'profile_user_256kb'
    const userId257 = 'profile_user_257kb'
    const token256 = await tokenFor(userId256)
    const token257 = await tokenFor(userId257)

    // JSON.stringify({"text":"..."}) adds 11 bytes of structural overhead
    // ('{"text":"' is 9 chars, the closing '"}' is 2) around the string
    // content -- the filler length is chosen so the whole serialized body
    // lands exactly on the target byte count, not just the string itself.
    const makePayload = (totalBytes: number) => ({ text: 'a'.repeat(totalBytes - 11) })

    const okRes = await put(
      { schemaVersion: 13, payload: makePayload(256 * 1024), baseRevision: 0 },
      token256,
      '203.0.113.8',
    )
    expect(okRes.status).toBe(201)

    const tooBigRes = await put(
      { schemaVersion: 13, payload: makePayload(257 * 1024), baseRevision: 0 },
      token257,
      '203.0.113.9',
    )
    expect(tooBigRes.status).toBe(413)
    const body: ApiErrorResponse = await tooBigRes.json()
    expect(body.error).toBeTruthy()

    // Rejected write must not have created a row.
    const getRes = await get(token257, '203.0.113.9')
    expect(getRes.status).toBe(404)
  })

  it("only reads/writes the caller's own profile row, never another user's", async () => {
    const victim = 'profile_user_victim'
    const attacker = 'profile_user_attacker'
    await put(
      { schemaVersion: 13, payload: { owner: 'victim' }, baseRevision: 0 },
      await tokenFor(victim),
      '203.0.113.10',
    )

    const attackerGet = await get(await tokenFor(attacker), '203.0.113.11')
    expect(attackerGet.status).toBe(404)

    const attackerPut = await put(
      { schemaVersion: 13, payload: { owner: 'attacker' }, baseRevision: 0 },
      await tokenFor(attacker),
      '203.0.113.11',
    )
    expect(attackerPut.status).toBe(201)

    const victimGet = await get(await tokenFor(victim), '203.0.113.10')
    const victimBody: ProfileGetResponse = await victimGet.json()
    expect(victimBody.payload).toEqual({ owner: 'victim' })
  })

  it('anonId is first-write-wins: a second PUT with a different anonId does not change the stored one', async () => {
    const userId = 'profile_user_anon'
    const token = await tokenFor(userId)

    await put(
      { schemaVersion: 13, payload: { v: 1 }, baseRevision: 0, anonId: 'anon-first' },
      token,
      '203.0.113.12',
    )
    let row = await env.DB.prepare('SELECT linked_anon_id FROM users WHERE clerk_user_id = ?')
      .bind(userId)
      .first<{ linked_anon_id: string | null }>()
    expect(row?.linked_anon_id).toBe('anon-first')

    await put(
      { schemaVersion: 13, payload: { v: 2 }, baseRevision: 1, anonId: 'anon-second' },
      token,
      '203.0.113.12',
    )
    row = await env.DB.prepare('SELECT linked_anon_id FROM users WHERE clerk_user_id = ?')
      .bind(userId)
      .first<{ linked_anon_id: string | null }>()
    expect(row?.linked_anon_id).toBe('anon-first')
  })
})
