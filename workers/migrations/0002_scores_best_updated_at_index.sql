-- Migration 0002: dry-runs the migration-application machinery end-to-end
-- once (T2 DoD: "migration #2 isn't the first time this process runs in
-- anger"). Genuinely harmless and additive -- no data migration, no column
-- change: an index supporting a future ops/observability query pattern
-- ("which scores_best rows changed most recently"), relevant to T14's S4
-- size/activity checks.

CREATE INDEX idx_scores_best_updated_at ON scores_best (updated_at DESC);
