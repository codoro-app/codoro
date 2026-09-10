import { SignJWT, exportSPKI, generateKeyPair } from 'jose'

/**
 * Test-only JWT signing (T3's plan explicitly calls for "a throwaway
 * keypair generated in-test" for the forged-signature test). Real Clerk
 * session tokens are RS256, verified against a PEM public key
 * (CLERK_JWT_KEY) — this generates a matching keypair and signs tokens
 * shaped like a real Clerk session token (sub, azp, iat, exp), so
 * `verifyToken()` exercises the exact same code path it would against a
 * real token, just with test-controlled keys and claims.
 */
export interface TestKeypair {
  publicKeyPem: string
  privateKey: CryptoKey
}

export async function generateTestKeypair(): Promise<TestKeypair> {
  const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true })
  return { publicKeyPem: await exportSPKI(publicKey), privateKey }
}

export interface SignTestTokenOptions {
  privateKey: CryptoKey
  sub?: string
  azp?: string
  /** How far in the past `iat` is set, in seconds. Default 0 (issued now). */
  issuedAtSecondsAgo?: number
  /** Seconds from `iat` until `exp`. Default 60 (a real session token's short lifetime). */
  expiresInSeconds?: number
}

export async function signTestToken(options: SignTestTokenOptions): Promise<string> {
  const {
    privateKey,
    sub = 'user_test_default',
    azp,
    issuedAtSecondsAgo = 0,
    expiresInSeconds = 60,
  } = options
  const nowSeconds = Math.floor(Date.now() / 1000)
  const iat = nowSeconds - issuedAtSecondsAgo

  return new SignJWT(azp === undefined ? {} : { azp })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(sub)
    .setIssuedAt(iat)
    .setExpirationTime(iat + expiresInSeconds)
    .sign(privateKey)
}
