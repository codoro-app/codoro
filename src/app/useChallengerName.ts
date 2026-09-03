/**
 * Thin, presentation-only hook (challenge redesign) that reads/writes a
 * player's `challengerName` (src/storage/schema.ts's `UserProfile` field) —
 * the display name threaded into every outgoing challenge link so a
 * recipient's `/challenge` landing hero can greet them by name instead of
 * staying anonymous.
 *
 * Deliberately has NO storage access of its own — it takes the caller's own
 * `profile` (already loaded, however that page owns it) and an
 * `onProfileChange` callback, the same shape every session hook's own
 * `profile` state + `saveProfile` side effect already provides. `setName`
 * only ever computes the next profile object and hands it to
 * `onProfileChange`; persisting it (a real `saveProfile` call) is entirely
 * the caller's responsibility, so there is exactly one storage write path
 * for `UserProfile`, never a second one duplicated in here — the same
 * "presentation-only" boundary `useFeedbackNudge` keeps for its own,
 * simpler, dismissed-state concern.
 *
 * `name` tracks a local optimistic override once `setName` has been called,
 * rather than only ever deriving from `profile.challengerName` — this
 * matters for callers whose own `profile` state doesn't necessarily
 * re-render synchronously after `onProfileChange` runs (e.g. a component
 * that loads its own read-mostly profile snapshot, like
 * ChallengeComparison.tsx's counter-challenge). Once set, the override wins
 * for the lifetime of this hook instance — a fresh `profile` value can only
 * ever confirm what was just saved, never race it backward to `null`.
 */
import { useCallback, useState } from 'react'
import type { UserProfile } from '../storage'

export interface UseChallengerNameResult {
  /** The player's saved challenger name, or null if never set (or set then skipped this session) — see this file's module doc comment for the optimistic-override semantics. */
  name: string | null
  /** Trims and persists `name` via the caller's own `onProfileChange`. A blank/whitespace-only name, or a call with no profile loaded yet, is a silent no-op — callers only invoke this from a form that already validates non-blank input (ChallengerNameSheet.tsx). */
  setName: (name: string) => Promise<void>
}

export function useChallengerName(
  profile: UserProfile | null,
  onProfileChange: (profile: UserProfile) => Promise<void>,
): UseChallengerNameResult {
  const [override, setOverride] = useState<string | null>(null)

  const setName = useCallback(
    async (nextName: string) => {
      const trimmed = nextName.trim()
      if (trimmed.length === 0 || !profile) return
      setOverride(trimmed)
      await onProfileChange({ ...profile, challengerName: trimmed })
    },
    [profile, onProfileChange],
  )

  return { name: override ?? profile?.challengerName ?? null, setName }
}
