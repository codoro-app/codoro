-- Migration 0003: v6 Phase 6.2a entitlements + Stripe webhook idempotency.
--
-- DDL source: docs/superpowers/plans/2026-09-20-v6-phase6-2-payments-spec.md
-- §4, verbatim. §1's design ("events are triggers, not truth") is why this
-- table exists at all: `stripe.ts`'s authoritative-read helper is the only
-- writer, deriving `tier` from a freshly-retrieved Subscription object
-- (§5's table), never from a webhook event's own payload.

CREATE TABLE entitlements (
  clerk_user_id          TEXT PRIMARY KEY REFERENCES users(clerk_user_id) ON DELETE CASCADE,
  tier                   TEXT NOT NULL CHECK (tier IN ('free', 'coach')) DEFAULT 'free',
  stripe_customer_id     TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  stripe_status          TEXT,            -- raw Stripe status, for debugging a disputed state
  current_period_end     INTEGER,         -- unix seconds, from the authoritative read
  cancel_at_period_end   INTEGER NOT NULL DEFAULT 0,
  updated_at             INTEGER NOT NULL
);

-- Idempotency ledger. A processed event id is never processed again (F42).
CREATE TABLE stripe_events (
  event_id     TEXT PRIMARY KEY,
  type         TEXT NOT NULL,
  processed_at INTEGER NOT NULL
);
CREATE INDEX idx_stripe_events_processed_at ON stripe_events (processed_at);
