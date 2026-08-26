import { useEffect, useRef, useState } from 'react'
import { Link } from 'wouter'
import { PATTERN_LABELS, puzzleMeta } from '../../content'
import { listAttempts } from '../../storage'
import type { Attempt } from '../../storage'
import { computeMastery } from './mastery'

/**
 * 2b.7: replaces the full `MasteryView` list that used to live in Practice's
 * desktop sidebar + mobile "Mastery" view and Daily's desktop sidebar — the
 * per-pattern list itself now lives on `/stats`. This teaser keeps ambient
 * mastery visibility mid-session (the thing that would otherwise be lost)
 * without duplicating the full list at either call site.
 *
 * Shared by both `PracticePage.tsx` and `DailyPage.tsx` (was duplicated
 * verbatim in both as an initial 2b.7 fix-wave finding — extracted here to
 * restore the single-shared-component shape `MasteryView` originally had).
 * Lives in `practice/` despite Daily also using it because `mastery.ts`
 * (which this component depends on for `computeMastery`) already lives here
 * too, and `DailyPage.tsx` already reaches into `../practice/` for other
 * imports (`PuzzleCardShell`, `computeMastery` itself) — this follows that
 * same established import direction rather than introducing a new shared
 * location.
 *
 * Fetches its own attempts (mirrors `MasteryView`'s mount +
 * refreshKey-driven refetch) rather than taking them as a prop — neither
 * page's session hook exposes a raw attempts array, only a bump counter
 * (`attemptVersion`) meant for exactly this: driving a refetch elsewhere in
 * the tree. Callers pass that counter as `refreshKey`.
 *
 * While the fetch is in flight, `rows` is `null` and this renders a neutral
 * "Loading…" state rather than the "Solve a few puzzles…" fallback — that
 * fallback is only correct once the fetch has resolved and genuinely found
 * no pattern with enough data. Rendering it during the initial fetch would
 * misinform a returning user with real history for the brief window before
 * `listAttempts()` resolves.
 */
export function MasteryTeaser({ refreshKey }: { refreshKey: number }) {
  const [rows, setRows] = useState<ReturnType<typeof computeMastery> | null>(null)

  // A ref, not a plain `let` closure var — see usePracticeSession.ts's
  // identical pattern (also used by MasteryView) for why.
  const cancelledRef = useRef(false)
  useEffect(() => {
    cancelledRef.current = false
    void (async () => {
      const attempts: Attempt[] = await listAttempts()
      if (cancelledRef.current) return
      setRows(computeMastery(attempts, puzzleMeta))
    })()
    return () => {
      cancelledRef.current = true
    }
  }, [refreshKey])

  const weakest = rows
    ?.filter((row) => row.accuracy !== null)
    .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0))[0]

  return (
    <div className="flex flex-col gap-2">
      {rows === null ? (
        <p className="m-0 text-sm text-text-1">Loading…</p>
      ) : weakest ? (
        <p className="m-0 text-sm text-text-1">
          Weakest: <span className="font-bold text-text-0">{PATTERN_LABELS[weakest.pattern]}</span>{' '}
          · {Math.round((weakest.accuracy ?? 0) * 100)}%
        </p>
      ) : (
        <p className="m-0 text-sm text-text-1">Solve a few puzzles to see your weakest pattern.</p>
      )}
      <Link href="/stats" className="text-sm font-bold text-accent no-underline">
        View full stats →
      </Link>
    </div>
  )
}
