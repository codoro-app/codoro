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
 * Decode contract: every failure mode — bad/truncated base64, truncated
 * UTF-8, invalid JSON, wrong shape, unknown version — collapses to a single
 * `null`, the same "reject wholesale" standard as importData
 * (src/storage/exportImport.ts). The caller renders one legible
 * broken-link state for all of them, never a partial payload.
 */
import { CHALLENGE_PAYLOAD_VERSION, ChallengePayloadSchema, MAX_CHALLENGE_PUZZLES } from './schema'
import type { ChallengeAttemptInput, ChallengePayload } from './schema'

// Scheme-less on purpose: matches the existing share-text convention
// (getcodoro.com/puzzle/<id> — see each surface's shareText.ts), which the
// browsers every paste target runs in resolve to https. Not a wouter href —
// /challenge is a link-only route with no in-app navigation into it.
const SITE_URL = 'getcodoro.com'

const JSON_ENCODER = new TextEncoder()
// fatal: a truncated/otherwise-malformed UTF-8 sequence throws instead of
// silently substituting U+FFFD — so decode can catch it and return null
// rather than handing a garbage string to JSON.parse.
const JSON_DECODER = new TextDecoder('utf-8', { fatal: true })

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

/** Full shareable challenge URL — the entire payload encoded into the fragment. */
export function buildChallengeUrl(payload: ChallengePayload): string {
  return `${SITE_URL}/challenge#${toBase64Url(JSON_ENCODER.encode(JSON.stringify(payload)))}`
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
