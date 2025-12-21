-- Roulette History Tables
-- Run: psql $DATABASE_URL -f sql/roulette.sql

-- Completed rounds history
CREATE TABLE IF NOT EXISTS roulette_rounds (
    id SERIAL PRIMARY KEY,
    result_number VARCHAR(2) NOT NULL,
    result_color VARCHAR(5) NOT NULL,
    total_wagered INTEGER NOT NULL,
    total_paid INTEGER NOT NULL,
    bet_count INTEGER NOT NULL,
    player_count INTEGER NOT NULL,
    spun_at TIMESTAMP DEFAULT NOW()
);

-- Individual bet history
CREATE TABLE IF NOT EXISTS roulette_bets (
    id SERIAL PRIMARY KEY,
    round_id INTEGER REFERENCES roulette_rounds(id) ON DELETE CASCADE,
    user_id VARCHAR(20) NOT NULL,
    username VARCHAR(100) NOT NULL,
    bet_type VARCHAR(20) NOT NULL,
    amount INTEGER NOT NULL,
    won BOOLEAN NOT NULL,
    returned INTEGER NOT NULL DEFAULT 0,
    placed_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_roulette_rounds_spun_at ON roulette_rounds(spun_at DESC);
CREATE INDEX IF NOT EXISTS idx_roulette_bets_user_id ON roulette_bets(user_id);
CREATE INDEX IF NOT EXISTS idx_roulette_bets_round_id ON roulette_bets(round_id);
CREATE INDEX IF NOT EXISTS idx_roulette_bets_user_bet ON roulette_bets(user_id, bet_type);
