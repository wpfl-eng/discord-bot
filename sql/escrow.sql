-- Wager Escrow
-- Run: psql $DATABASE_URL -f sql/escrow.sql
--
-- Holds coins that have left a player's wallet but have not yet been resolved by a
-- game. Every debit taken by roulette or blackjack opens a row here in the SAME
-- transaction as the wallet update, so the two can never disagree.
--
-- A row is 'open' only while money is genuinely at risk. Anything still 'open' when
-- the bot boots belongs to a round or hand that a crash or restart ended early, and
-- is refunded by the startup sweep.

CREATE TABLE IF NOT EXISTS wager_escrow (
    id          SERIAL PRIMARY KEY,
    user_id     VARCHAR(20)  NOT NULL,
    username    VARCHAR(100) NOT NULL,

    -- 'roulette' | 'blackjack'
    game        VARCHAR(20)  NOT NULL,

    -- Groups every row belonging to one round or one hand, so a session can be
    -- settled or voided as a unit.
    session_key VARCHAR(64)  NOT NULL,

    -- What the debit was for: 'bet' | 'double' | 'split' | 'insurance'
    purpose     VARCHAR(20)  NOT NULL DEFAULT 'bet',

    amount      INTEGER      NOT NULL CHECK (amount > 0),

    -- open     - coins are held, outcome unknown
    -- settled  - the game resolved it normally (win or loss both settle)
    -- voided   - player pulled the bet back before resolution; coins returned
    -- refunded - returned by the startup sweep after an interrupted game
    status      VARCHAR(10)  NOT NULL DEFAULT 'open'
                CHECK (status IN ('open', 'settled', 'voided', 'refunded')),

    -- Game-specific context (bet type, hand index, table) for stats and debugging
    detail      JSONB,

    opened_at   TIMESTAMP    NOT NULL DEFAULT NOW(),
    closed_at   TIMESTAMP
);

-- The startup sweep and the "is anything at risk" checks only ever look at open rows.
CREATE INDEX IF NOT EXISTS idx_wager_escrow_open
    ON wager_escrow(status) WHERE status = 'open';

-- Settling or voiding a whole round/hand at once.
CREATE INDEX IF NOT EXISTS idx_wager_escrow_session
    ON wager_escrow(game, session_key);

CREATE INDEX IF NOT EXISTS idx_wager_escrow_user
    ON wager_escrow(user_id);
