-- Roulette Inside Bets
--
-- The felt went from 50 bets (12 outside + 38 straight up) to 158, adding the 62
-- splits, 12 streets, 22 corners, 11 six lines and the five-number basket.
--
-- roulette_bets.bet_type is free text with no enumeration, so the new bets need no
-- column changes at all. What this migration does is make the length dependency
-- explicit: the key scheme was chosen to fit VARCHAR(20), and a longer key would be
-- rejected on write rather than silently truncated into a bet that never matches.
--
--   17            straight up
--   split-17-20   two pockets          (longest at 11 characters)
--   street-16     16 17 18
--   corner-13     13 14 16 17
--   line-13       13..18
--   basket        0 00 1 2 3
--
-- Run: psql $DATABASE_URL -f migrations/011_roulette_inside_bets.sql
--
-- NOTE: this repository has no automated migration runner. Roulette plays correctly
-- without this applied; the constraint and index are hardening, not a dependency.

BEGIN;

ALTER TABLE roulette_bets
    DROP CONSTRAINT IF EXISTS roulette_bets_bet_type_length;
ALTER TABLE roulette_bets
    ADD CONSTRAINT roulette_bets_bet_type_length CHECK (char_length(bet_type) <= 20);

COMMENT ON COLUMN roulette_bets.bet_type IS
    'Outside: red | black | odd | even | low | high | {first,second,third}-{dozen,column}. '
    'Inside: <pocket> | split-<a>-<b> | street-<n> | corner-<n> | line-<n> | basket.';

-- The stats command groups a player's history by bet type to find their favourite and
-- their biggest hit. With 158 possible values instead of 50 that grouping is worth an
-- index.
CREATE INDEX IF NOT EXISTS idx_roulette_bets_type
    ON roulette_bets(bet_type);

COMMIT;
