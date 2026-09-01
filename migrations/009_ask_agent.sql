-- Migration: /ask agent -- sessions, usage ledger, and a tool-exception log
-- Run this in your Vercel Postgres database:
--   npx tsx scripts/runMigration.ts migrations/009_ask_agent.sql
--
-- NOT APPLIED AUTOMATICALLY. Nothing runs migrations on startup. Wrapped in a
-- transaction so a failure part-way leaves no half-built schema behind.

BEGIN;

-- One row per /ask conversation, keyed by the channel it lives in.
-- For a threaded ask that is the thread snowflake; for the in-place fallback
-- (forum posts, voice text) it is the channel snowflake.
CREATE TABLE IF NOT EXISTS ask_sessions (
  thread_id       TEXT PRIMARY KEY,
  session_id      TEXT NOT NULL,             -- Agent SDK session UUID
  opener_user_id  TEXT NOT NULL,
  question        TEXT NOT NULL,
  turns           INTEGER NOT NULL DEFAULT 1,
  total_cost_usd  NUMERIC(10, 6) NOT NULL DEFAULT 0,  -- ESTIMATE. Observability only.
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed          BOOLEAN NOT NULL DEFAULT FALSE      -- set when the thread archives
);

-- One row per query() call. Drives the daily and monthly caps, which count
-- rows here and never sum cost_usd.
--
-- thread_id is deliberately a plain correlation column with NO foreign key onto
-- ask_sessions. The ledger is written from inside runAsk() on every terminal
-- result -- before the Discord layer writes the session row, and on a run that
-- died before the SDK emitted a session id there is no session row to write at
-- all. A foreign key here made that insert fail (verified against Postgres 16:
-- `violates foreign key constraint "ask_usage_thread_id_fkey"`), writeLedger()
-- swallowed the error, and the caps -- which count rows in this table -- counted
-- nothing. An append-only accounting ledger must not depend on a mutable,
-- prunable session table for its right to exist.
CREATE TABLE IF NOT EXISTS ask_usage (
  id           SERIAL PRIMARY KEY,
  user_id      TEXT NOT NULL,
  thread_id    TEXT,                          -- correlation only; see above
  prompt       TEXT NOT NULL,
  model        TEXT,
  num_turns    INTEGER,
  cost_usd     NUMERIC(10, 6) NOT NULL DEFAULT 0,  -- ESTIMATE. Never gates anything.
  subtype      TEXT,                          -- success | error_max_budget_usd | ...
  duration_ms  INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ask_usage_user_day ON ask_usage (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ask_usage_created  ON ask_usage (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ask_usage_thread   ON ask_usage (thread_id, created_at);

-- One row per DENIED or FAILED tool call. The happy path is deliberately not
-- written here: the ticker already shows every file read and query run, in the
-- thread, in public, permanently, and in a form a league member can read
-- without database access. In normal operation this table stays near empty,
-- which is the point -- a row in it is a signal, not a log line.
CREATE TABLE IF NOT EXISTS ask_tool_calls (
  id          SERIAL PRIMARY KEY,
  thread_id   TEXT,
  user_id     TEXT,
  tool_name   TEXT NOT NULL,
  tool_input  JSONB,
  denied_by   TEXT,        -- 'path_guard' | 'domain_guard'; NULL when it failed rather than was denied
  error       TEXT,        -- the tool's own error, when there was one
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ask_tool_calls_thread ON ask_tool_calls (thread_id, created_at);

COMMIT;
