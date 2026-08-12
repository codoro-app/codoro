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
    <div className="flex flex-col items-center gap-4 text-center py-6">
      {isResume && (
        <ul
          className="flex flex-wrap justify-center gap-2 list-none m-0 p-0"
          aria-label="Completed stages"
        >
          {missionSession.completedStages.map((summary) => {
            const meta = MISSION_STAGE_META[summary.stats.stageId]
            const Icon = meta.Icon
            return (
              <li
                key={summary.stats.stageId}
                className="flex items-center gap-1.5 py-1.5 px-3 rounded-full bg-surface-1 border border-border text-text-1 text-sm"
              >
                <Icon size={16} />
                <span>{meta.label}</span>
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex flex-col items-center gap-2">
        <span
          className="flex items-center justify-center w-14 h-14 rounded-full bg-accent-dim text-accent"
          aria-hidden="true"
        >
          <NextIcon size={28} />
        </span>
        <p className="text-2xl font-semibold text-text-0 m-0">{nextMeta.label}</p>
        <p className="text-text-1 m-0">{MISSION_STAGE_DURATION_SECONDS} seconds</p>
      </div>

      <button
        type="button"
        className="min-h-11 py-3 px-6 rounded-md border-0 bg-accent text-accent-ink font-semibold cursor-pointer"
        onClick={missionSession.handleStartStage}
      >
        {isResume ? 'Continue' : 'Start mission'}
      </button>

      {isResume &&
        (confirmingExit ? (
          <div
            className="flex flex-col items-center gap-3 p-4 rounded-lg border border-border bg-surface-1 text-text-1"
            role="group"
            aria-label="Exit mission?"
          >
            <p>Exit mission? Your progress in this run will be lost.</p>
            <div className="flex gap-3">
              <button
                type="button"
                className="min-h-11 py-2 px-4 rounded-md cursor-pointer border border-border bg-surface-2 text-text-0"
                onClick={() => {
                  setConfirmingExit(false)
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="min-h-11 py-2 px-4 rounded-md cursor-pointer border border-danger bg-danger-dim text-danger"
                onClick={missionSession.handleAbandon}
              >
                Exit mission
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            className="min-h-11 py-2 px-3 border-0 bg-transparent text-text-2 underline cursor-pointer"
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
