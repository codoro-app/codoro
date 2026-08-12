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
  { label: string; Icon: (props: IconProps) => React.JSX.Element }
> = {
  trace: { label: 'Trace', Icon: TraceIcon },
  speed: { label: 'Speed Round', Icon: RushIcon },
  boss: { label: 'Boss', Icon: BossIcon },
}
