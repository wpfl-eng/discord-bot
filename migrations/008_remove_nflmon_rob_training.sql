-- Migration 008: retire NFLmon, /rob and the training-ground schema
--
-- NOT APPLIED AUTOMATICALLY. There is no migration runner in this repo -
-- run this by hand when you are ready to drop the data permanently.
--
-- The application code no longer references anything below, so the bot
-- runs correctly whether or not this has been applied. Applying it is
-- irreversible: NFLmon collections, stats and trade history are lost.
--
-- Migrations 002, 005 and 006 are kept in the repo as the historical
-- record of what these tables looked like.

BEGIN;

-- ============================================================
-- NFLmon (created by 005_nflmon.sql, altered by 006_starter.sql)
-- ============================================================
-- Order matters: nflmon_trades.from_nflmon_id / to_nflmon_id are foreign
-- keys into nflmon_bench(id), so trades must be dropped first.
DROP TABLE IF EXISTS nflmon_trades;
DROP TABLE IF EXISTS nflmon_bench;
DROP TABLE IF EXISTS nflmon_stats;

-- ============================================================
-- /rob and the padlock (columns on economy_users)
-- ============================================================
ALTER TABLE economy_users
  DROP COLUMN IF EXISTS last_rob,
  DROP COLUMN IF EXISTS last_robbed_at,
  DROP COLUMN IF EXISTS last_robbed_by,
  DROP COLUMN IF EXISTS has_padlock;

-- ============================================================
-- Training Ground (created by 002_training_system.sql)
-- ============================================================
-- The /train feature was removed earlier; no code has referenced these
-- tables since. training_slots has a FK to training_grounds, so it must
-- be dropped first.
DROP TABLE IF EXISTS training_slots;
DROP TABLE IF EXISTS training_grounds;

COMMIT;

-- ============================================================
-- Deliberately NOT dropped
-- ============================================================
-- user_inventory rows for the retired contract/tool/rookie item types.
--   They resolve to null in getItemDefinition and are skipped when the
--   inventory embed is built, so they are inert. Left in place so the
--   data survives if those items are ever reintroduced.
--
-- achievements rows with achievement_key = 'THIEF'.
--   The definition is gone, but nothing reads the achievements table
--   for display today, and players did earn the badge.
