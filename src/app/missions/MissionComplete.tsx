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
    <div className="daily-hero">
      <div className="daily-hero__top">
        <div className="daily-hero__icon" aria-hidden="true">
          <MissionIcon size={22} />
        </div>
        <div className="daily-hero__copy">
          <p className="daily-hero__verdict">Mission complete</p>
          {finishedStats && finishedStats.completions > 1 && (
            <p className="daily-hero__badge">{finishedStats.completions} missions completed</p>
          )}
        </div>
      </div>

      <ul className="mission-complete__recap">
        {completedStages.map((summary) => {
          const meta = MISSION_STAGE_META[summary.stats.stageId]
          const Icon = meta.Icon
          return (
            <li key={summary.stats.stageId} className="mission-complete__recap-item">
              <Icon size={20} />
              <span className="mission-complete__recap-label">{meta.label}</span>
              <span className="mission-complete__recap-detail">{recapDetail(summary.stats)}</span>
            </li>
          )
        })}
      </ul>

      <button
        type="button"
        className="share-card__button"
        onClick={missionSession.handleRunItAgain}
      >
        Run it back
      </button>
    </div>
  )
}
