-- Migration 0001: initial schema.
--
-- DDL source: docs/superpowers/plans/2026-08-27-v5-accounts-implementation-plan.md,
-- the 2026-08-31 amendment at the bottom of that file (S1: profiles.payload
-- compressed BLOB + payload_bytes; S3: scores/scores_best split; the
-- reports table, missing entirely from the document's original body DDL).
-- That amendment supersedes the DDL in the body of the same document --
-- see docs/v5-build-plan.md's amendment banner under "Locked decisions".
-- Column-by-column documentation lives in workers/README.md; this file is
-- the executable source of truth, not the explanation.

CREATE TABLE users (
  clerk_user_id TEXT PRIMARY KEY,
  username TEXT UNIQUE,               -- lowercase; NULL until claimed (T9)
  username_changed_at INTEGER,        -- unix ms; change throttling (T9)
  public_profile INTEGER NOT NULL DEFAULT 0,
  linked_anon_id TEXT,                -- v2 anonId, for telemetry continuity
  created_at INTEGER NOT NULL
);

-- S1: payload is gzip-compressed IN THE WORKER (CompressionStream /
-- DecompressionStream) -- never on the client. The API contract stays JSON
-- on both ends (PUT takes JSON, GET returns JSON). S2: workers/src/profileStore.ts
-- is the ONLY module allowed to read or write this column -- enforced by a
-- drift-guard test (workers/test/static/profileStorePayloadGuard.test.ts),
-- not just this comment.
CREATE TABLE profiles (
  clerk_user_id  TEXT PRIMARY KEY REFERENCES users(clerk_user_id) ON DELETE CASCADE,
  revision       INTEGER NOT NULL,    -- server-incremented, optimistic concurrency (T7)
  schema_version INTEGER NOT NULL,    -- client CURRENT_SCHEMA_VERSION at write time
  payload        BLOB NOT NULL,       -- gzip of the export-format JSON (S1)
  payload_bytes  INTEGER NOT NULL,    -- compressed size, for the S4 ceiling check
  updated_at     INTEGER NOT NULL
);

-- S3: the 90-day rolling window. One row per user/mode/day; upsert-keep-best
-- (see recordScore() in db.ts). Pruned by a scheduled job on the Workers
-- Cron trigger Phase 5.5 introduces -- until then this table simply grows,
-- which is fine for the window between phases and must not become the
-- permanent state.
CREATE TABLE scores (
  clerk_user_id TEXT NOT NULL REFERENCES users(clerk_user_id) ON DELETE CASCADE,
  mode          TEXT NOT NULL CHECK (mode IN ('daily', 'rush', 'boss')),
  day           TEXT NOT NULL,        -- YYYY-MM-DD, UTC day key (same fn as DAILY_CALENDAR, F15)
  score         INTEGER NOT NULL,
  run_meta      TEXT,                 -- JSON, bounded 2 KB, display-only, never read by server logic
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (clerk_user_id, mode, day)
);
CREATE INDEX idx_scores_board ON scores (mode, day, score DESC);

-- S3: all-time bests, exactly one row per user per mode, never pruned. This
-- is the correctness fix, not an optimization: ranking the day-keyed
-- `scores` table for window=all let one strong player with many good days
-- occupy multiple top-ten slots (idx_scores_alltime from the pre-amendment
-- DDL is deleted, not renamed -- see the amendment's own note). This table
-- is what GET /api/leaderboard?window=all reads exclusively; window=day
-- reads `scores`.
CREATE TABLE scores_best (
  clerk_user_id TEXT NOT NULL REFERENCES users(clerk_user_id) ON DELETE CASCADE,
  mode          TEXT NOT NULL CHECK (mode IN ('daily', 'rush', 'boss')),
  score         INTEGER NOT NULL,
  achieved_day  TEXT NOT NULL,
  updated_at    INTEGER NOT NULL,
  PRIMARY KEY (clerk_user_id, mode)
);
CREATE INDEX idx_scores_best_board ON scores_best (mode, score DESC);

CREATE TABLE email_prefs (
  clerk_user_id TEXT PRIMARY KEY REFERENCES users(clerk_user_id) ON DELETE CASCADE,
  digest INTEGER NOT NULL DEFAULT 0,      -- weekly digest: off by default (marketing, explicit opt-in)
  streak INTEGER NOT NULL DEFAULT 0,      -- streak-at-risk nudge: off by default (also marketing)
  challenge INTEGER NOT NULL DEFAULT 1,   -- challenge-answered notify: on (transactional response to something the user initiated)
  unsubscribed_all INTEGER NOT NULL DEFAULT 0
);

-- Unauthenticated by design (build plan Phase 5.0 item 5 / plan T4a) -- most
-- reporters will not have accounts, which makes this the only anonymous
-- write in the system and its sharpest abuse surface. No clerk_user_id (an
-- authenticated variant is a v6 decision, not this one). No IP column,
-- hashed or otherwise: abuse control is the edge rate limiter, and an IP is
-- PII the PII practice does not permit keeping. `reason` is a fixed enum,
-- enforced here AND by request validation (Zod, T4a) -- belt and braces on
-- the one endpoint that accepts anonymous writes. No free-text column
-- exists in v5.
CREATE TABLE reports (
  id          TEXT PRIMARY KEY,            -- uuid v4, server-generated
  puzzle_id   TEXT NOT NULL,               -- validated against the real content index before insert (T4a)
  reason      TEXT NOT NULL CHECK (reason IN ('wrong-answer', 'unclear', 'renders-broken', 'typo', 'other')),
  app_version TEXT NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_reports_puzzle ON reports (puzzle_id, created_at DESC);
