/**
 * base64url codec for challenge payloads (v2 Phase 5c) — the only way a
 * ChallengePayload becomes a shareable URL and back. Built from platform
 * btoa/atob/TextEncoder/TextDecoder, zero new dependencies (Phase 5c DoD).
 *
 * The encoded string goes in the URL *fragment* (`/challenge#...`), so it
 * never reaches Cloudflare or the service worker — which is what lets
 * /challenge be a plain static route (no _redirects glob, no SW denylist
 * entry beyond the route itself) rather than a dynamic one.
 *
 * v5 Phase 5.4, pulled forward pre-v5: `buildChallengeUrl` can also place a
 * separate, narrow `?og=` query param in front of that fragment (see
 * `buildChallengeOgParam`/`decodeChallengeOgParam` below), carrying only the
 * challenger's display name and puzzle count so a Cloudflare Pages Function
 * can render a real unfurl card. This is a deliberate, bounded exception to
 * the paragraph above: the challenger's name and puzzle count DO now reach
 * Cloudflare's edge (and whatever query-string logging happens there) —
 * puzzle ids, results, and totalMs still never leave the fragment, and
 * nothing about the fragment's own handling changes.
 *
 * Decode contract: every failure mode — bad/truncated base64, truncated
 * UTF-8, invalid JSON, wrong shape, unknown version — collapses to a single
 * `null`, the same "reject wholesale" standard as importData
 * (src/storage/exportImport.ts). The caller renders one legible
 * broken-link state for all of them, never a partial payload.
 */
import {
  CHALLENGE_PAYLOAD_VERSION,
  ChallengeOgParamSchema,
  ChallengePayloadSchema,
  MAX_CHALLENGE_PUZZLES,
} from './schema'
import type { ChallengeAttemptInput, ChallengeOgParam, ChallengePayload } from './schema'

// Scheme-less on purpose: matches the existing share-text convention
// (getcodoro.com/puzzle/<id> — see each surface's shareText.ts), which the
// browsers every paste target runs in resolve to https. Not a wouter href —
// /challenge is a link-only route with no in-app navigation into it.
const SITE_URL = 'getcodoro.com'

const JSON_ENCODER = new TextEncoder()
// fatal: a truncated/otherwise-malformed UTF-8 sequence throws instead of
// silently substituting U+FFFD — so decode can catch it and return null
// rather than handing a garbage string to JSON.parse. ignoreBOM: false is
// the spec default (unchanged behavior) — spelled out because this file is
// now also typechecked under functions/'s @cloudflare/workers-types project
// (v5 Phase 5.4, pulled forward), whose TextDecoder types require it
// explicitly where lib.dom.d.ts leaves it optional.
const JSON_DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(encoded: string): Uint8Array | null {
  // Reject anything outside the base64url alphabet up front — atob would
  // throw on most of it anyway, but this also cleanly rejects whitespace and
  // non-ASCII without relying on atob's exact error behavior.
  if (!/^[A-Za-z0-9_-]*$/.test(encoded)) return null
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
  try {
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
    return bytes
  } catch {
    return null
  }
}

/** Keeps the last `MAX_CHALLENGE_PUZZLES` attempts — the freshest, highest-difficulty puzzles of a longer run. */
export function truncateToChallengeLimit(
  attempts: ChallengeAttemptInput[],
): ChallengeAttemptInput[] {
  return attempts.slice(-MAX_CHALLENGE_PUZZLES)
}

/**
 * Builds a versioned payload from accumulated session attempts, truncating
 * longer runs to their last `MAX_CHALLENGE_PUZZLES`. `challengerName` (v2,
 * challenge redesign) is every call site's own `profile.challengerName` —
 * required here (not defaulted) so a caller can't forget to thread it
 * through; pass `null` explicitly for "no name set / skipped", which is a
 * legitimate, share-blocking-free value (see ChallengePayloadSchema's own
 * doc comment).
 */
export function buildChallengePayload(
  attempts: ChallengeAttemptInput[],
  challengerName: string | null,
): ChallengePayload {
  const kept = truncateToChallengeLimit(attempts)
  return {
    v: CHALLENGE_PAYLOAD_VERSION,
    ids: kept.map((attempt) => attempt.puzzleId),
    results: kept.map((attempt) => ({ correct: attempt.correct, time_ms: attempt.time_ms })),
    totalMs: kept.reduce((sum, attempt) => sum + attempt.time_ms, 0),
    challengerName,
  }
}

/**
 * Full shareable challenge URL — the entire payload encoded into the
 * fragment, exactly as before. `ogParam` (optional, built by
 * `buildChallengeOgParam`) is inserted as a `?og=` query param in front of
 * the fragment when supplied; omitting it reproduces the pre-5.4 URL shape
 * byte-for-byte, which is what keeps every existing caller/test unchanged.
 */
export function buildChallengeUrl(payload: ChallengePayload, ogParam?: string): string {
  const fragment = toBase64Url(JSON_ENCODER.encode(JSON.stringify(payload)))
  const query = ogParam ? `?og=${ogParam}` : ''
  return `${SITE_URL}/challenge${query}#${fragment}`
}

/**
 * Encodes the minimal `{ n, c }` OG-card companion (see `ChallengeOgParamSchema`
 * in schema.ts) for `buildChallengeUrl`'s `?og=` param. Same base64url
 * alphabet as the fragment codec above, but independently encoded/decoded —
 * the edge Pages Function that reads this never needs to touch the fragment
 * or `ChallengePayloadSchema` at all.
 */
export function buildChallengeOgParam(challengerName: string | null, puzzleCount: number): string {
  const param: ChallengeOgParam = { n: challengerName, c: puzzleCount }
  return toBase64Url(JSON_ENCODER.encode(JSON.stringify(param)))
}

/**
 * Decodes a `?og=` query param back into `{ n, c }`, or `null` for every
 * failure mode — same "reject wholesale" contract as `decodeChallengePayload`
 * above (bad base64, truncated UTF-8, invalid JSON, wrong shape all collapse
 * to one outcome). Accepts the raw param value (already `decodeURIComponent`d
 * by the caller reading it off a URL, same as `window.location.hash` for the
 * fragment).
 */
export function decodeChallengeOgParam(encoded: string): ChallengeOgParam | null {
  const bytes = fromBase64Url(encoded)
  if (!bytes) return null
  let json: string
  try {
    json = JSON_DECODER.decode(bytes)
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  const result = ChallengeOgParamSchema.safeParse(parsed)
  return result.success ? result.data : null
}

/**
 * Decodes a challenge link's fragment content back into a payload, or `null`
 * for every failure mode (see the module doc). Accepts the fragment content
 * *without* the leading '#' — the caller strips window.location.hash's '#'.
 */
export function decodeChallengePayload(encoded: string): ChallengePayload | null {
  const bytes = fromBase64Url(encoded)
  if (!bytes) return null
  let json: string
  try {
    json = JSON_DECODER.decode(bytes)
  } catch {
    return null
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  const result = ChallengePayloadSchema.safeParse(parsed)
  return result.success ? result.data : null
}
