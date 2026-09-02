-- Migration: /ask agent -- sessions, usage ledger, tool-exception log, feedback
-- Run this in your Vercel Postgres database:
--   npx tsx scripts/runMigration.ts migrations/014_ask_agent.sql
--
-- Numbered 014: this file was 009 while 009_widen_economy_money_columns.sql
-- already existed on main. Renamed before it was ever applied (log Stage 14).
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
  closed          BOOLEAN NOT NULL DEFAULT FALSE,     -- set when the thread archives
  -- TRUE when /ask opened the thread itself. In such a thread the opener
  -- continues the conversation by just typing; in a thread the bot did not
  -- create, everyone has to address it (design §6.2).
  bot_thread      BOOLEAN NOT NULL DEFAULT FALSE
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
  -- What a member is charged for. FALSE when the run never reached the model
  -- (no session id was ever observed) or the SDK reported one of its
  -- ops-failure codes: an expired login, a rate limit, an overloaded API. The
  -- caps count rows WHERE counted; the row itself stays for observability.
  counted      BOOLEAN NOT NULL DEFAULT TRUE,
  error        TEXT,                          -- what the run died of, when it did
  message_id   TEXT,                          -- the Discord message the answer landed in
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

-- One row per person per answer: the 👍 or 👎 on the answer's buttons. Keyed
-- by the Discord message rather than the ledger row, so a vote survives a
-- ledger write that failed; the join to ask_usage.message_id is optional.
-- Triage, not learning: a thumbs-down says which thread to open.
CREATE TABLE IF NOT EXISTS ask_feedback (
  id          SERIAL PRIMARY KEY,
  message_id  TEXT NOT NULL,
  thread_id   TEXT,
  user_id     TEXT NOT NULL,
  rating      SMALLINT NOT NULL CHECK (rating IN (-1, 1)),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ask_feedback_message ON ask_feedback (message_id);

COMMIT;
