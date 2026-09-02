-- Casino Table Persistence
--
-- Holds the between-round state of each casino table so a restart does not wipe the
-- room: who is seated and for how much, the blackjack shoe and its cut card, the craps
-- shooter rotation, and each table's recent history.
--
-- Deliberately does NOT hold anything mid-round. Every wager is escrow-backed, so
-- runStartupRefundSweep returns whatever was at risk when the process died and the
-- round is simply redealt. Storing a half-played hand is the hardest part to get right
-- and buys nothing that the escrow sweep does not already guarantee.
--
-- One row per game, replaced in place.
--
-- Run: psql $DATABASE_URL -f migrations/013_casino_table_state.sql
--
-- NOTE: this repository has no automated migration runner. Until this is applied, every
-- table plays correctly but starts empty after a restart, exactly as before.

BEGIN;

CREATE TABLE IF NOT EXISTS casino_table_state (
    -- 'craps' | 'blackjack'. Roulette holds nothing durable between spins.
    game        VARCHAR(20)  PRIMARY KEY,

    -- Where the table was running, so it reopens in the right room
    channel_id  VARCHAR(32)  NOT NULL,

    -- Shape varies by game; see the *Snapshot interfaces in casino/casinoPersistence.ts
    state       JSONB        NOT NULL,

    saved_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- Snapshots older than an hour are ignored on load: a table nobody has touched that
-- long is not one anyone is waiting to rejoin.
CREATE INDEX IF NOT EXISTS idx_casino_table_state_saved
    ON casino_table_state(saved_at DESC);

COMMIT;
