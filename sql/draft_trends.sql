-- Tables for storing precomputed draft trends data

-- Main draft picks table (mirrors API data)
CREATE TABLE IF NOT EXISTS draft_picks (
    id SERIAL PRIMARY KEY,
    owner VARCHAR(100) NOT NULL,
    player VARCHAR(200),
    player_nfl_team VARCHAR(10),
    player_nfl_position VARCHAR(10),
    league VARCHAR(50),
    draft_position INTEGER,
    auction_value INTEGER,
    season INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_owner_season (owner, season),
    INDEX idx_player_season (player, season)
);

-- Player scores table (for performance calculations)
CREATE TABLE IF NOT EXISTS player_scores (
    id SERIAL PRIMARY KEY,
    player VARCHAR(200) NOT NULL,
    season INTEGER NOT NULL,
    total_points DECIMAL(10,2) DEFAULT 0,
    games_played INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_player_season (player, season),
    INDEX idx_player_season (player, season)
);

-- Precomputed owner stats table
CREATE TABLE IF NOT EXISTS owner_draft_stats (
    id SERIAL PRIMARY KEY,
    owner VARCHAR(100) NOT NULL,
    season_min INTEGER NOT NULL,
    season_max INTEGER NOT NULL,
    total_picks INTEGER DEFAULT 0,
    snake_picks INTEGER DEFAULT 0,
    auction_picks INTEGER DEFAULT 0,
    avg_draft_position DECIMAL(10,2),
    earliest_pick INTEGER,
    latest_pick INTEGER,
    auction_total_spent INTEGER DEFAULT 0,
    auction_avg_value DECIMAL(10,2),
    auction_max_bid INTEGER,
    auction_min_bid INTEGER,
    auction_roi DECIMAL(10,2),
    auction_hit_rate DECIMAL(10,2),
    auction_bust_rate DECIMAL(10,2),
    stats_json JSON, -- Store complex stats like position frequencies, team frequencies, etc.
    computed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY unique_owner_range (owner, season_min, season_max),
    INDEX idx_owner (owner),
    INDEX idx_computed_at (computed_at)
);

-- Table for tracking computation status
CREATE TABLE IF NOT EXISTS draft_computation_status (
    id SERIAL PRIMARY KEY,
    status VARCHAR(50) NOT NULL,
    season_min INTEGER,
    season_max INTEGER,
    total_records INTEGER,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);