/**
 * Ghost-pace comparison copy for a finished Boss run — same "one obvious
 * template function, not hardcoded inline" convention as Rush/Daily's own
 * buildShareText functions (src/app/rush/shareText.ts). v1 scope,
 * deliberately: a static post-run comparison of this run's pace against
 * the player's own best-ever run at the same puzzle position, never a live
 * race, animated ghost marker, or simulated opponent — see the Boss
 * engagement pass's locked decisions. Exact wording is Thomas's to tweak;
 * this is the one obvious place to do it.
 */
export interface BossGhostPaceInput {
  /** 1-indexed position this run reached — same as BossRunSummary.depthReached. */
  depthReached: number
  /** This run's own elapsed-ms-per-position splits (BossRunSummary.splits). */
  splits: readonly number[]
  /** The prior best-depth run's splits (BossRunSummary.previousBestSplits) — null if none exists yet. */
  previousBestSplits: readonly number[] | null
}

/** m:ss formatting for a duration in ms — e.g. 118_000 -> "1:58". Seconds are always zero-padded to 2 digits; minutes are not. */
function formatMmSs(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes)}:${String(seconds).padStart(2, '0')}`
}

/**
 * Builds the ghost-pace comparison line, or null when there's nothing
 * honest to compare: no prior best-depth run has ever recorded splits
 * (first-ever run, or a bestDepth that predates split tracking via the
 * v7->v8 migration), or that prior run never reached this run's own
 * depthReached (so it has no recorded time for that exact position — a
 * "you're already deeper than your best run" moment the existing
 * isNewBestDepth badge already covers elsewhere, not this comparison's
 * job). When both runs DO have a split at depthReached, this is a simple
 * fixed-position delta — whichever run was faster there is left for the
 * reader to see from the two numbers, not called out by the copy itself.
 */
export function buildBossGhostPaceText({
  depthReached,
  splits,
  previousBestSplits,
}: BossGhostPaceInput): string | null {
  if (previousBestSplits === null) return null

  const thisRunMs = splits[depthReached - 1]
  const bestRunMs = previousBestSplits[depthReached - 1]
  if (thisRunMs === undefined || bestRunMs === undefined) return null

  return `You reached puzzle ${String(depthReached)} in ${formatMmSs(thisRunMs)} — your best run got there in ${formatMmSs(bestRunMs)}.`
}
