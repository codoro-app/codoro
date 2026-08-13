/**
 * Shared per-stage display metadata (label + icon) for Missions' UI —
 * split out from MissionCheckpoint.tsx (which also imports this) purely so
 * that file only exports a component, per react-refresh/only-export-
 * components: fast refresh only works cleanly when a component file's only
 * exports are components. MissionComplete.tsx imports this directly too,
 * rather than re-exporting it through MissionCheckpoint.tsx, for the same
 * reason.
 */
import { BossIcon, RushIcon, TraceIcon } from '../Icons'
import type { IconProps } from '../Icons'
import type { MissionStageId } from '../../storage'

export const MISSION_STAGE_META: Record<
  MissionStageId,
  // `description` (2b.3): what the stage actually involves, one sentence —
  // shown on MissionCheckpoint's pre-stage preview and StageTracker's
  // expanded mobile view, so a first-time player can tell what's about to
  // happen from the name alone. `label`/`Icon` predate this phase.
  { label: string; description: string; Icon: (props: IconProps) => React.JSX.Element }
> = {
  trace: {
    label: 'Trace',
    description: 'Scrub through code step-by-step and predict what happens next.',
    Icon: TraceIcon,
  },
  speed: {
    label: 'Speed Round',
    description: 'Answer as many puzzles as you can before the clock runs out.',
    Icon: RushIcon,
  },
  boss: {
    label: 'Boss',
    description: 'Survive three wrong answers — how deep can you get?',
    Icon: BossIcon,
  },
}
