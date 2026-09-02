-- Widen every economy_users money column from INTEGER to BIGINT
-- Run: psql $DATABASE_URL -f migrations/009_widen_economy_money_columns.sql
--
-- WHY
--
-- INTEGER tops out at 2,147,483,647.
--
-- total_earned and total_lost are monotonic - nothing ever decrements them over a
-- player's lifetime - so they reach that ceiling eventually no matter what the bet
-- limits are. Raising the roulette and blackjack caps to 100,000 makes a single
-- straight-up hit pay 3,500,000, which shortens the runway from roughly 86,000 max
-- wins to roughly 613. Once it is reached the payout UPDATE raises "integer out of
-- range" and the win fails outright: a player wins and is not paid.
--
-- wallet, bank and bank_capacity are widened as well, for two reasons:
--
--   1. The leaderboard index is built on the expression (wallet + bank). In Postgres
--      int4 + int4 yields int4, so that sum can overflow while both columns are
--      individually in range - a failure in the index expression, not the columns.
--   2. Keeping one type across the whole money domain means a value can be moved
--      between any two of these columns without a range check.
--
-- Per-transaction columns elsewhere (roulette_rounds.total_wagered, stock holdings,
-- and so on) are deliberately left as INTEGER: they are bounded by a single round or
-- trade rather than accumulating, and cannot approach the ceiling.
--
-- SAFETY
--
-- economy_users holds one row per league member, so this rewrite is effectively
-- instantaneous. CHECK constraints (wallet >= 0, bank >= 0, bank <= bank_capacity)
-- and the idx_economy_wealth expression index carry over automatically.
--
-- REQUIRED COMPANION CHANGE
--
-- node-postgres returns BIGINT (int8) as a STRING, unlike INTEGER which returns a
-- number. Applying this migration WITHOUT db/pgTypes.ts would silently turn
-- EconomyUser.wallet into a string at runtime while TypeScript still declares it a
-- number - and `wallet + amount` would then concatenate instead of add. That module
-- registers an int8 parser that returns a number, and is imported by economyDb and
-- escrowDb. Deploy the code and this migration together.

ALTER TABLE economy_users
    ALTER COLUMN wallet         TYPE BIGINT,
    ALTER COLUMN bank           TYPE BIGINT,
    ALTER COLUMN bank_capacity  TYPE BIGINT,
    ALTER COLUMN total_earned   TYPE BIGINT,
    ALTER COLUMN total_lost     TYPE BIGINT;
