-- Craps Bet Expansion
--
-- The table went from five bet types to twenty: free odds on both sides of the line,
-- all six place numbers, four hardways and five one-roll props.
--
-- craps_stats previously carried a counter pair per bet FAMILY, which only worked while
-- there were four families. This adds counters for the new ones and widens the bet_type
-- column comment; no existing column changes type or is dropped.
--
-- Run: psql $DATABASE_URL -f migrations/010_craps_bet_expansion.sql
--
-- NOTE: this repository has no automated migration runner. Until this is applied by
-- hand, craps plays correctly but the new bet families are not counted in /craps stats.

BEGIN;

ALTER TABLE craps_stats
    ADD COLUMN IF NOT EXISTS odds_bets        INTEGER DEFAULT 0 CHECK (odds_bets >= 0),
    ADD COLUMN IF NOT EXISTS odds_wins        INTEGER DEFAULT 0 CHECK (odds_wins >= 0),
    ADD COLUMN IF NOT EXISTS hardway_bets     INTEGER DEFAULT 0 CHECK (hardway_bets >= 0),
    ADD COLUMN IF NOT EXISTS hardway_wins     INTEGER DEFAULT 0 CHECK (hardway_wins >= 0),
    ADD COLUMN IF NOT EXISTS prop_bets        INTEGER DEFAULT 0 CHECK (prop_bets >= 0),
    ADD COLUMN IF NOT EXISTS prop_wins        INTEGER DEFAULT 0 CHECK (prop_wins >= 0),
    -- Total coins backed at true odds. Tracked separately because it is the only
    -- wagering on the table the house has no edge on, so it does not belong in the
    -- same bucket as the rest.
    ADD COLUMN IF NOT EXISTS total_odds_backed BIGINT DEFAULT 0
        CHECK (total_odds_backed >= 0);

COMMENT ON COLUMN craps_bets.bet_type IS
    'pass_line | dont_pass | field | pass_odds | dont_pass_odds | place_4..place_10 | '
    'hard_4 | hard_6 | hard_8 | hard_10 | any_seven | any_craps | yo | snake_eyes | boxcars';

-- The longest key is dont_pass_odds at 14 characters, so VARCHAR(16) still fits. This
-- constraint makes that dependency explicit rather than incidental.
ALTER TABLE craps_bets
    DROP CONSTRAINT IF EXISTS craps_bets_bet_type_length;
ALTER TABLE craps_bets
    ADD CONSTRAINT craps_bets_bet_type_length CHECK (char_length(bet_type) <= 16);

CREATE INDEX IF NOT EXISTS idx_craps_stats_odds_backed
    ON craps_stats(total_odds_backed DESC);

COMMIT;
