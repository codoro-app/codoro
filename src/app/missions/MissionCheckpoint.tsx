/**
 * Missions' reusable pre-stage screen — rendered for first entry, every
 * inter-stage transition, and mid-arc resume alike (all three are the same
 * `phase === 'checkpoint'` state, per useMissionSession.ts's own doc
 * comment). Satisfies the click-meaningfulness gating-tap test
 * (docs/design/click-meaningfulness.md §1/§2) at the one boundary the
 * design doc calls out by name: the next stage's icon, name, and duration
 * are all visible before the Start/Continue tap, so the destination is
 * legible ahead of time rather than only revealed after tapping.
 *
 * "Exit mission?" only appears once completedStages.length > 0 (decision 7
 * — a fresh, never-started run has no progress an accidental tap could
 * lose) and is a real two-step inline confirm, not a single-tap action: the
 * first tap only reveals the confirm, matching this session's own gating-
 * tap standard for any destructive action.
 */
import { useState } from 'react'
import { MISSION_STAGE_DURATION_MS } from './missionStageClock'
import { MISSION_STAGE_META } from './missionStageMeta'
import type { MissionSession } from './useMissionSession'

const MISSION_STAGE_DURATION_SECONDS = MISSION_STAGE_DURATION_MS / 1000

export interface MissionCheckpointProps {
  missionSession: MissionSession
}

export function MissionCheckpoint({ missionSession }: MissionCheckpointProps) {
  const [confirmingExit, setConfirmingExit] = useState(false)
  const nextMeta = MISSION_STAGE_META[missionSession.currentStage]
  const NextIcon = nextMeta.Icon
  const isResume = missionSession.completedStages.length > 0

  return (
    <div className="mission-checkpoint">
      {isResume && (
        <ul className="mission-checkpoint__completed" aria-label="Completed stages">
          {missionSession.completedStages.map((summary) => {
            const meta = MISSION_STAGE_META[summary.stats.stageId]
            const Icon = meta.Icon
            return (
              <li key={summary.stats.stageId} className="mission-checkpoint__completed-item">
                <Icon size={16} />
                <span>{meta.label}</span>
              </li>
            )
          })}
        </ul>
      )}

      <div className="mission-checkpoint__next">
        <span className="mission-checkpoint__next-icon" aria-hidden="true">
          <NextIcon size={28} />
        </span>
        <p className="mission-checkpoint__next-label">{nextMeta.label}</p>
        <p className="mission-checkpoint__next-duration">
          {MISSION_STAGE_DURATION_SECONDS} seconds
        </p>
      </div>

      <button
        type="button"
        className="mission-checkpoint__start"
        onClick={missionSession.handleStartStage}
      >
        {isResume ? 'Continue' : 'Start mission'}
      </button>

      {isResume &&
        (confirmingExit ? (
          <div className="mission-checkpoint__exit-confirm" role="group" aria-label="Exit mission?">
            <p>Exit mission? Your progress in this run will be lost.</p>
            <div className="mission-checkpoint__exit-actions">
              <button
                type="button"
                className="mission-checkpoint__exit-cancel"
                onClick={() => {
                  setConfirmingExit(false)
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="mission-checkpoint__exit-confirm-button"
                onClick={missionSession.handleAbandon}
              >
                Exit mission
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="mission-checkpoint__exit-link"
            onClick={() => {
              setConfirmingExit(true)
            }}
          >
            Exit mission
          </button>
        ))}
    </div>
  )
}
