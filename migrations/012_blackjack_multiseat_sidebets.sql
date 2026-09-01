-- Blackjack Multi-Seat and Side Bets
--
-- Blackjack became one shared multi-seat table on a persistent six-deck shoe, and
-- gained two side bets that settle at the deal: 21+3 and Perfect Pairs.
--
-- Main-game stats are unchanged - a seat's hands are still recorded one row at a time
-- through recordGameResult, which already handles splits. What is new is the side-bet
-- accounting, which does not belong in the main win/loss counters: they are separate
-- wagers with their own paytables and their own (much worse) edge, and folding them in
-- would quietly distort every existing leaderboard.
--
-- Run: psql $DATABASE_URL -f migrations/012_blackjack_multiseat_sidebets.sql
--
-- NOTE: this repository has no automated migration runner. Until this is applied by
-- hand, blackjack plays correctly and side bets pay correctly - they simply are not
-- counted in lifetime stats.

BEGIN;

ALTER TABLE blackjack_stats
    -- 21+3
    ADD COLUMN IF NOT EXISTS p3_bets           INTEGER DEFAULT 0 CHECK (p3_bets >= 0),
    ADD COLUMN IF NOT EXISTS p3_wins           INTEGER DEFAULT 0 CHECK (p3_wins >= 0),
    ADD COLUMN IF NOT EXISTS p3_wagered        BIGINT  DEFAULT 0 CHECK (p3_wagered >= 0),
    ADD COLUMN IF NOT EXISTS p3_won            BIGINT  DEFAULT 0 CHECK (p3_won >= 0),

    -- Perfect Pairs
    ADD COLUMN IF NOT EXISTS pairs_bets        INTEGER DEFAULT 0 CHECK (pairs_bets >= 0),
    ADD COLUMN IF NOT EXISTS pairs_wins        INTEGER DEFAULT 0 CHECK (pairs_wins >= 0),
    ADD COLUMN IF NOT EXISTS pairs_wagered     BIGINT  DEFAULT 0 CHECK (pairs_wagered >= 0),
    ADD COLUMN IF NOT EXISTS pairs_won         BIGINT  DEFAULT 0 CHECK (pairs_won >= 0),

    -- The best single side-bet hit, which is the number people will actually brag
    -- about: suited trips pays 100:1.
    ADD COLUMN IF NOT EXISTS biggest_side_win  INTEGER DEFAULT 0
        CHECK (biggest_side_win >= 0),
    ADD COLUMN IF NOT EXISTS best_side_tier    VARCHAR(20),

    -- Rounds played at the shared table, as distinct from hands. One round can produce
    -- up to four hands through re-splitting.
    ADD COLUMN IF NOT EXISTS rounds_seated     INTEGER DEFAULT 0 CHECK (rounds_seated >= 0);

COMMENT ON COLUMN blackjack_stats.best_side_tier IS
    'perfect | colored | mixed | suited_trips | straight_flush | trips | straight | flush';

CREATE INDEX IF NOT EXISTS idx_blackjack_stats_side_win
    ON blackjack_stats(biggest_side_win DESC);

COMMIT;
