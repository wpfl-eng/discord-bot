-- Craps Tables
-- Run: psql $DATABASE_URL -f sql/craps.sql

-- ============================================================
-- Completed Sessions History
-- ============================================================

CREATE TABLE IF NOT EXISTS craps_sessions (
    id SERIAL PRIMARY KEY,
    channel_id VARCHAR(32) NOT NULL,
    shooter_user_id VARCHAR(32),
    shooter_username VARCHAR(100),
    point INTEGER,
    roll_count INTEGER NOT NULL DEFAULT 0,
    outcome VARCHAR(16) NOT NULL, -- 'natural', 'craps', 'point_hit', 'seven_out'
    total_wagered INTEGER NOT NULL DEFAULT 0,
    total_paid INTEGER NOT NULL DEFAULT 0,
    roll_history JSONB NOT NULL DEFAULT '[]',
    started_at TIMESTAMP NOT NULL,
    ended_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- Individual Bet History
-- ============================================================

CREATE TABLE IF NOT EXISTS craps_bets (
    id SERIAL PRIMARY KEY,
    session_id INTEGER REFERENCES craps_sessions(id) ON DELETE CASCADE,
    user_id VARCHAR(32) NOT NULL,
    username VARCHAR(100) NOT NULL,
    bet_type VARCHAR(16) NOT NULL, -- 'pass_line', 'dont_pass', 'field', 'place_6', 'place_8'
    amount INTEGER NOT NULL,
    outcome VARCHAR(16) NOT NULL, -- 'won', 'lost', 'push'
    payout INTEGER NOT NULL DEFAULT 0,
    placed_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- Player Statistics
-- ============================================================

CREATE TABLE IF NOT EXISTS craps_stats (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(32) NOT NULL UNIQUE,
    username VARCHAR(100),

    -- Session counts
    sessions_played INTEGER DEFAULT 0 CHECK (sessions_played >= 0),
    sessions_as_shooter INTEGER DEFAULT 0 CHECK (sessions_as_shooter >= 0),

    -- Bet counts
    pass_line_bets INTEGER DEFAULT 0 CHECK (pass_line_bets >= 0),
    pass_line_wins INTEGER DEFAULT 0 CHECK (pass_line_wins >= 0),
    dont_pass_bets INTEGER DEFAULT 0 CHECK (dont_pass_bets >= 0),
    dont_pass_wins INTEGER DEFAULT 0 CHECK (dont_pass_wins >= 0),
    field_bets INTEGER DEFAULT 0 CHECK (field_bets >= 0),
    field_wins INTEGER DEFAULT 0 CHECK (field_wins >= 0),
    place_bets INTEGER DEFAULT 0 CHECK (place_bets >= 0),
    place_wins INTEGER DEFAULT 0 CHECK (place_wins >= 0),

    -- Financial tracking
    total_wagered BIGINT DEFAULT 0 CHECK (total_wagered >= 0),
    total_won BIGINT DEFAULT 0 CHECK (total_won >= 0),
    biggest_session_win INTEGER DEFAULT 0 CHECK (biggest_session_win >= 0),
    biggest_session_loss INTEGER DEFAULT 0,
    biggest_single_bet_win INTEGER DEFAULT 0 CHECK (biggest_single_bet_win >= 0),

    -- Notable events
    seven_outs_witnessed INTEGER DEFAULT 0 CHECK (seven_outs_witnessed >= 0),
    points_hit_witnessed INTEGER DEFAULT 0 CHECK (points_hit_witnessed >= 0),
    naturals_witnessed INTEGER DEFAULT 0 CHECK (naturals_witnessed >= 0),
    longest_roll_witnessed INTEGER DEFAULT 0 CHECK (longest_roll_witnessed >= 0),

    -- Shooter stats
    longest_roll_as_shooter INTEGER DEFAULT 0 CHECK (longest_roll_as_shooter >= 0),
    points_hit_as_shooter INTEGER DEFAULT 0 CHECK (points_hit_as_shooter >= 0),
    seven_outs_as_shooter INTEGER DEFAULT 0 CHECK (seven_outs_as_shooter >= 0),

    -- Timestamps
    last_played_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- Indexes
-- ============================================================

-- Sessions
CREATE INDEX IF NOT EXISTS idx_craps_sessions_ended_at ON craps_sessions(ended_at DESC);
CREATE INDEX IF NOT EXISTS idx_craps_sessions_channel ON craps_sessions(channel_id);
CREATE INDEX IF NOT EXISTS idx_craps_sessions_shooter ON craps_sessions(shooter_user_id);

-- Bets
CREATE INDEX IF NOT EXISTS idx_craps_bets_session ON craps_bets(session_id);
CREATE INDEX IF NOT EXISTS idx_craps_bets_user ON craps_bets(user_id);
CREATE INDEX IF NOT EXISTS idx_craps_bets_user_type ON craps_bets(user_id, bet_type);

-- Stats
CREATE INDEX IF NOT EXISTS idx_craps_stats_user ON craps_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_craps_stats_sessions ON craps_stats(sessions_played DESC);
CREATE INDEX IF NOT EXISTS idx_craps_stats_profit ON craps_stats((total_won - total_wagered) DESC);
CREATE INDEX IF NOT EXISTS idx_craps_stats_longest_roll ON craps_stats(longest_roll_as_shooter DESC);
