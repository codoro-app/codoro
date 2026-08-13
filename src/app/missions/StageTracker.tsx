/**
 * 2b.3: the persistent stage tracker (build item 1) — MissionCheckpoint used
 * to be the only place a player could see mission progress, and only the
 * *completed* stages, and only while resting at a checkpoint. This renders
 * for every phase except `'complete'` (MissionsPage.tsx), so progress stays
 * visible through the active-play stages too, not just between them.
 *
 * Mobile (<1024px): collapsed to a row of plain dots — no stage-label text
 * by default, just an `aria-label` summarizing progress on the toggle
 * button. Tapping it expands an inline breakdown (icon + label +
 * description + status per stage); tapping again collapses it. Kept this
 * minimal deliberately (direct user choice over a persistent top stepper
 * bar) — Missions' mobile screens are already tight during active play
 * (Trace's scrubber, Rush/Boss's puzzle card), and a full label row would
 * compete with them for space on every single render, not just checkpoints.
 *
 * Desktop (>=1024px): a persistent vertical rail, no collapse — matches
 * PracticePage.tsx/DailyPage.tsx's own `.app-shell__sidebar` desktop-only
 * aside convention (same grid slot, same `isDesktop` gate), placed to the
 * right per the direct user request behind this build item.
 *
 * `variant` is an explicit prop, not an internal `useMediaQuery` check: the
 * desktop copy has to mount inside `.app-shell__sidebar` (a different grid
 * area than the mobile copy's inline spot in the main column), and only the
 * caller (MissionsPage.tsx) knows which container it's placing this into —
 * same split MissionsPage's own PracticePage.tsx/DailyPage.tsx siblings
 * already use for their desktop sidebars. A single conditional render, not
 * a CSS-only show/hide of two duplicated subtrees — same reasoning as
 * PuzzleCardShell.tsx's `isDesktop` Continue-button placement: a real
 * duplicate-DOM approach would force every stage label into
 * `getAllByRole(..., {hidden:true})`-style queries everywhere this
 * component's text is asserted on, for no behavioral gain.
 */
import { useState } from 'react'
import { MISSION_STAGE_META } from './missionStageMeta'
import type { MissionStageId, MissionStageSummary } from '../../storage'
import { MISSION_STAGE_ORDER } from '../../storage'

export interface StageTrackerProps {
  currentStage: MissionStageId
  completedStages: readonly MissionStageSummary[]
  variant: 'mobile' | 'desktop'
}

type StageStatus = 'completed' | 'current' | 'upcoming'

function statusLabel(status: StageStatus): string {
  if (status === 'completed') return 'Done'
  if (status === 'current') return 'In progress'
  return 'Up next'
}

function stageStatus(
  stageId: MissionStageId,
  currentStage: MissionStageId,
  completedStages: readonly MissionStageSummary[],
): StageStatus {
  if (completedStages.some((summary) => summary.stats.stageId === stageId)) return 'completed'
  if (stageId === currentStage) return 'current'
  return 'upcoming'
}

const DOT_CLASS: Record<StageStatus, string> = {
  completed: 'bg-accent',
  current: 'bg-accent-dim border-2 border-accent',
  upcoming: 'bg-surface-2 border border-border',
}

export function StageTracker({ currentStage, completedStages, variant }: StageTrackerProps) {
  const [expanded, setExpanded] = useState(false)

  const currentIndex = MISSION_STAGE_ORDER.indexOf(currentStage)
  const summaryLabel = `Stage ${String(currentIndex + 1)} of ${String(MISSION_STAGE_ORDER.length)}: ${MISSION_STAGE_META[currentStage].label}`

  if (variant === 'desktop') {
    return (
      <nav aria-label="Mission stages">
        <ul className="flex flex-col gap-3 list-none m-0 p-0">
          {MISSION_STAGE_ORDER.map((stageId) => {
            const meta = MISSION_STAGE_META[stageId]
            const Icon = meta.Icon
            const status = stageStatus(stageId, currentStage, completedStages)
            return (
              <li
                key={stageId}
                className="flex items-center gap-3 p-3 rounded-md border border-border bg-surface-1 text-text-0"
              >
                <span
                  className={`flex items-center justify-center shrink-0 w-9 h-9 rounded-full ${status === 'completed' || status === 'current' ? 'bg-accent-dim text-accent' : 'bg-surface-2 text-text-2'}`}
                  aria-hidden="true"
                >
                  <Icon size={18} />
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="font-semibold">{meta.label}</span>
                  <span className="text-text-1 text-sm">{statusLabel(status)}</span>
                </span>
              </li>
            )
          })}
        </ul>
      </nav>
    )
  }

  return (
    <div className="sticky top-0 z-10 pb-3 bg-surface-0">
      <button
        type="button"
        className="flex items-center gap-2 min-h-11 py-2 px-3 rounded-full border border-border bg-surface-1 cursor-pointer"
        aria-expanded={expanded}
        aria-label={summaryLabel}
        onClick={() => {
          setExpanded((current) => !current)
        }}
      >
        {MISSION_STAGE_ORDER.map((stageId) => (
          <span
            key={stageId}
            aria-hidden="true"
            className={`w-2.5 h-2.5 rounded-full ${DOT_CLASS[stageStatus(stageId, currentStage, completedStages)]}`}
          />
        ))}
      </button>

      {expanded && (
        <ul className="flex flex-col gap-2 mt-2 list-none m-0 p-0">
          {MISSION_STAGE_ORDER.map((stageId) => {
            const meta = MISSION_STAGE_META[stageId]
            const Icon = meta.Icon
            const status = stageStatus(stageId, currentStage, completedStages)
            return (
              <li
                key={stageId}
                className="flex items-center gap-3 p-3 rounded-md border border-border bg-surface-1 text-text-0"
              >
                <span
                  className={`flex items-center justify-center shrink-0 w-9 h-9 rounded-full ${status === 'completed' || status === 'current' ? 'bg-accent-dim text-accent' : 'bg-surface-2 text-text-2'}`}
                  aria-hidden="true"
                >
                  <Icon size={18} />
                </span>
                <span className="flex flex-col gap-0.5 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-semibold">{meta.label}</span>
                    <span className="text-text-1 text-sm">{statusLabel(status)}</span>
                  </span>
                  <span className="text-text-1 text-sm">{meta.description}</span>
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
