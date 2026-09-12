# T6 merge-engine fixtures

Real exports (via Settings → Export my data), not hand-typed objects — see F27 in
`docs/superpowers/plans/2026-09-12-v5-phase-5.2-sync-implementation-plan.md`. Generated
2026-09-12 by driving the local dev app (`pnpm dev`) through Claude in Chrome, not
assumed from the schema.

- **`fresh-install.json`** — exported before touching the first-run sequence.
  `firstRunCompleted: false`, zero attempts, default rating (1200), `anonId` present
  (stamped on first load). This is the actual shape `createDefaultProfile()` produces
  today, not a description of it — see F26.
- **`long-lived.json`** — first-run sequence (3 puzzles) completed, then several more
  Practice puzzles across multiple pattern types (multiple-choice, swipe, tap-the-line,
  drag-to-reorder). 9 attempts, rating moved off default (~1225.6), `firstRunCompleted:
true`. Note `streak.currentStreak` is still `0` — streak only advances on Daily
  completion, not Practice; that's real app behavior, not a fixture bug.
- **`post-mission.json`** — local storage reset (fresh `anonId`), then a full Missions
  run (Trace → Speed Round → Boss, ended by a 3rd wrong answer in Boss) played to
  "Mission complete". 7 attempts, `missionStats` populated (`completions: 1`,
  `lastRunAt`/`lastCompletedAt` stamped), `missionProgress: null` (a completed run
  clears in-progress state). Notably `rating`/`ratedAttemptCount` are unchanged at
  their defaults despite 7 recorded attempts — mission attempts don't feed the rated
  pool, a real distinction T6's `rating`/`ratedAttemptCount` recompute rule needs to
  respect, not an artifact of how this fixture was produced.

Regenerate by resetting local storage (`indexedDB.deleteDatabase('codoro')` +
`localStorage.clear()` in the page console) and replaying the same flow, if these ever
need refreshing against a newer `CURRENT_SCHEMA_VERSION`.
