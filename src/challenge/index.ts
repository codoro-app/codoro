/**
 * Public entry point for the challenge domain (v2 Phase 5c).
 *
 * Everything outside src/challenge/ must import from here, never from
 * schema.ts/codec.ts directly — same barrel convention as engine/, storage/,
 * content/, and telemetry/.
 */
export { CHALLENGE_PAYLOAD_VERSION, MAX_CHALLENGE_PUZZLES } from './schema'
export type { ChallengeAttemptInput, ChallengePayload } from './schema'
export {
  buildChallengePayload,
  buildChallengeUrl,
  decodeChallengePayload,
  truncateToChallengeLimit,
} from './codec'
