/**
 * Missions' payoff screen (docs/design/click-meaningfulness.md §3, decision
 * 4): a celebration/summary screen only — arc recap across the 3 stages
 * plus a completions-based badge. Reuses the .daily-hero/.share-card__button
 * treatment verbatim, same reuse convention RushPage/BossPage's own
 * end-of-run cards document.
 *
 * HARD CONSTRAINT: no rating/Elo number is ever displayed here. Trace's
 * stage rates exactly as standalone Trace does (unchanged practice-pool
 * rating, persisted invisibly by useTraceSession itself); Rush/Boss stay
 * unrated exactly as they are standalone. recapDetail below only ever
 * reads solvedCount/streak/depth/cleared off MissionStageStats — there is
 * no ratingDelta-shaped field anywhere in that type to accidentally
 * surface (see schema.ts's MissionStageStats union) — see
 * MissionsPage.test.tsx's own regex-based guard against this regressing.
 */
import { MissionIcon } from '../Icons'
import { MISSION_STAGE_META } from './missionStageMeta'
import type { MissionSession } from './useMissionSession'
import type { MissionStageStats } from '../../storage'

function recapDetail(stats: MissionStageStats): string {
  switch (stats.stageId) {
    case 'trace':
      return `${String(stats.solvedCount)}/${String(stats.puzzlesCompleted)} solved`
    case 'speed':
      return `${String(stats.solvedCount)} solved · best streak ${String(stats.bestStreakThisRun)}`
    case 'boss':
      return stats.cleared ? 'Cleared' : `Reached puzzle ${String(stats.depthReached)}`
  }
}

export interface MissionCompleteProps {
  missionSession: MissionSession
}

export function MissionComplete({ missionSession }: MissionCompleteProps) {
  const { completedStages, finishedStats } = missionSession

  return (
    // 2b.0: was `.daily-hero`/`.daily-hero__*` (dailyPage.css) — always the
    // "correct"/accent styling here, never `--wrong`.
    <div className="flex flex-col gap-4 p-4 lg:py-[28px] lg:px-[30px] rounded-xl border-[1.5px] border-accent [background:linear-gradient(160deg,var(--accent-dim),var(--surface-1))]">
      <div className="flex items-center gap-3">
        <div
          className="flex items-center justify-center shrink-0 w-11 h-11 rounded-md bg-accent"
          aria-hidden="true"
        >
          <MissionIcon size={22} />
        </div>
        <div className="flex flex-col gap-1">
          <p className="m-0 text-lg font-bold text-text-0">Mission complete</p>
          {finishedStats && finishedStats.completions > 1 && (
            <p className="m-0 text-sm font-semibold text-accent">
              {finishedStats.completions} missions completed
            </p>
          )}
        </div>
      </div>

      <ul className="flex flex-col gap-3 list-none m-0 p-0">
        {completedStages.map((summary) => {
          const meta = MISSION_STAGE_META[summary.stats.stageId]
          const Icon = meta.Icon
          return (
            <li
              key={summary.stats.stageId}
              className="flex items-center gap-3 p-3 rounded-md border border-border bg-surface-1 text-text-0"
            >
              <Icon size={20} />
              <span className="font-semibold flex-1">{meta.label}</span>
              <span className="text-text-1 text-sm">{recapDetail(summary.stats)}</span>
            </li>
          )
        })}
      </ul>

      <button
        type="button"
        className="min-h-11 border-0 rounded-sm bg-accent text-accent-ink font-bold cursor-pointer transition-[transform,opacity] duration-[0.05s] ease-out active:scale-[0.98] active:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
        onClick={missionSession.handleRunItAgain}
      >
        Run it back
      </button>
    </div>
  )
}
