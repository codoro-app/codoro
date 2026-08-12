/**
 * Missions' page-level component — mounted at `/missions`. Owns the single
 * `useMissionSession` instance (Rules of Hooks: see useMissionSession.ts's
 * own doc comment for why the outer state machine and each stage's own
 * session hook can't live in the same function body) and conditionally
 * renders exactly one child per `phase`: `MissionCheckpoint` for
 * `'checkpoint'`, one of `TraceStage`/`SpeedStage`/`BossStage` while that
 * stage is actively playing, and `MissionComplete` once the arc finishes.
 * Mirrors RushPage.tsx's own status-branching shape (loading/error guards
 * before the phase switch).
 */
import { useMissionSession } from './useMissionSession'
import { MissionCheckpoint } from './MissionCheckpoint'
import { MissionComplete } from './MissionComplete'
import { TraceStage } from './TraceStage'
import { SpeedStage } from './SpeedStage'
import { BossStage } from './BossStage'
import './missionsPage.css'

export function MissionsPage() {
  const missionSession = useMissionSession()

  if (missionSession.status === 'error') {
    return (
      <div className="missions-page app-shell__main">
        <p className="missions-page__status">We couldn&apos;t load Missions. Please try again.</p>
        <button
          type="button"
          className="min-h-11 py-2 px-3 border-0 bg-transparent text-accent text-md font-semibold cursor-pointer"
          onClick={missionSession.retryLoad}
        >
          Try again
        </button>
      </div>
    )
  }

  if (missionSession.status === 'loading' || missionSession.profile === null) {
    return (
      <div className="missions-page app-shell__main">
        <p className="missions-page__status">Loading Missions…</p>
      </div>
    )
  }

  return (
    <div className="missions-page app-shell__main">
      {missionSession.phase === 'checkpoint' && (
        <MissionCheckpoint missionSession={missionSession} />
      )}
      {missionSession.phase === 'trace' && <TraceStage missionSession={missionSession} />}
      {missionSession.phase === 'speed' && <SpeedStage missionSession={missionSession} />}
      {missionSession.phase === 'boss' && <BossStage missionSession={missionSession} />}
      {missionSession.phase === 'complete' && <MissionComplete missionSession={missionSession} />}
    </div>
  )
}
