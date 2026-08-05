/**
 * Versioned challenge-payload schema (v2 Phase 5c) — the entire challenge
 * lives in the URL fragment (`/challenge#<base64url>`), so this is the whole
 * data model: puzzle ids in play order, one result per id, and the
 * challenger's total time (the tiebreaker a recipient's own run is compared
 * against). No backend, no integrity check — forgeability is accepted in
 * writing per the Phase 5c build plan (a friend hand-editing a URL to claim a
 * perfect run is a social problem at friend scale, not an engineering one).
 */
import { z } from 'zod'

/** Version of the on-the-wire payload format. Bump on any breaking shape change; decoders reject anything else wholesale. */
export const CHALLENGE_PAYLOAD_VERSION = 1

/**
 * Hard cap on the number of puzzles a challenge carries. Keeps the encoded
 * URL comfortably under the ~2K practical length limit (the Phase 5c build
 * plan's own cap); longer runs truncate to their last `MAX_CHALLENGE_PUZZLES`
 * puzzles — the freshest, highest-difficulty data — via truncateToChallengeLimit.
 */
export const MAX_CHALLENGE_PUZZLES = 5

/**
 * What each surface's session hook accumulates per solved puzzle before a
 * challenge is encoded. `puzzleId` is what the recipient's /challenge page
 * resolves against puzzlePool; `correct`/`time_ms` are what the comparison
 * screen shows. Scrubber puzzles report aggregate only (correct/time_ms) —
 * no per-checkpoint detail in the payload, matching /puzzle/:id's own
 * telemetry precedent.
 */
export interface ChallengeAttemptInput {
  puzzleId: string
  correct: boolean
  time_ms: number
}

const ChallengeResultSchema = z.object({
  correct: z.boolean(),
  time_ms: z.number().int().nonnegative(),
})

/**
 * The versioned on-the-wire challenge payload. `ids` and `results` are
 * parallel arrays (same length, enforced by the refine below); `totalMs` is
 * the sum over the kept results — the number a recipient's own total time is
 * compared against for tie-breaking.
 */
export const ChallengePayloadSchema = z
  .object({
    v: z.literal(CHALLENGE_PAYLOAD_VERSION),
    ids: z.array(z.string().min(1)).min(1).max(MAX_CHALLENGE_PUZZLES),
    results: z.array(ChallengeResultSchema).min(1).max(MAX_CHALLENGE_PUZZLES),
    totalMs: z.number().int().nonnegative(),
  })
  .refine((payload) => payload.ids.length === payload.results.length, {
    message: 'ids and results must have the same length',
  })

export type ChallengePayload = z.infer<typeof ChallengePayloadSchema>
