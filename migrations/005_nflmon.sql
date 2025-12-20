-- NFLmon System Tables
-- Pokemon-style collectible system for NFL players
-- Run this in your Vercel Postgres database

-- =============================================================================
-- User's collected NFLmon (main collection table)
-- =============================================================================
CREATE TABLE IF NOT EXISTS nflmon_bench (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(20) NOT NULL,
  player_id VARCHAR(50) NOT NULL,
  nickname VARCHAR(50),
  level INTEGER DEFAULT 1 CHECK (level >= 1 AND level <= 100),
  current_xp INTEGER DEFAULT 0 CHECK (current_xp >= 0),
  evolution_stage VARCHAR(20) DEFAULT 'rookie',
  rarity VARCHAR(20) NOT NULL,

  -- Individual Values (IVs) - random 0-15 at acquisition
  iv_speed INTEGER CHECK (iv_speed >= 0 AND iv_speed <= 15),
  iv_power INTEGER CHECK (iv_power >= 0 AND iv_power <= 15),
  iv_agility INTEGER CHECK (iv_agility >= 0 AND iv_agility <= 15),
  iv_awareness INTEGER CHECK (iv_awareness >= 0 AND iv_awareness <= 15),
  iv_hp INTEGER CHECK (iv_hp >= 0 AND iv_hp <= 15),

  -- Acquisition tracking
  acquired_source VARCHAR(50) NOT NULL,
  acquired_from_user VARCHAR(20),
  acquired_at TIMESTAMP DEFAULT NOW(),

  -- Status flags
  is_favorite BOOLEAN DEFAULT FALSE,
  training_slot INTEGER,  -- NULL = not training, validated in code

  -- Extensibility fields
  variant VARCHAR(50) DEFAULT 'standard',
  metadata JSONB DEFAULT '{}'
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_nflmon_user ON nflmon_bench(user_id);
CREATE INDEX IF NOT EXISTS idx_nflmon_training ON nflmon_bench(user_id) WHERE training_slot IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_nflmon_level ON nflmon_bench(level DESC);
CREATE INDEX IF NOT EXISTS idx_nflmon_rarity ON nflmon_bench(rarity);

-- =============================================================================
-- User statistics table
-- =============================================================================
CREATE TABLE IF NOT EXISTS nflmon_stats (
  user_id VARCHAR(20) PRIMARY KEY,
  username VARCHAR(100),
  total_caught INTEGER DEFAULT 0 CHECK (total_caught >= 0),
  total_evolved INTEGER DEFAULT 0 CHECK (total_evolved >= 0),
  legendary_count INTEGER DEFAULT 0 CHECK (legendary_count >= 0),
  highest_level_reached INTEGER DEFAULT 0 CHECK (highest_level_reached >= 0 AND highest_level_reached <= 100),
  max_training_slots INTEGER DEFAULT 1 CHECK (max_training_slots >= 1 AND max_training_slots <= 5),
  created_at TIMESTAMP DEFAULT NOW()
);

-- =============================================================================
-- Trade escrow system (for Phase 6)
-- =============================================================================
CREATE TABLE IF NOT EXISTS nflmon_trades (
  id SERIAL PRIMARY KEY,
  from_user_id VARCHAR(20) NOT NULL,
  to_user_id VARCHAR(20) NOT NULL,
  from_nflmon_id INTEGER REFERENCES nflmon_bench(id) ON DELETE SET NULL,
  to_nflmon_id INTEGER REFERENCES nflmon_bench(id) ON DELETE SET NULL,
  coins_offered INTEGER DEFAULT 0 CHECK (coins_offered >= 0),
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP DEFAULT NOW() + INTERVAL '24 hours'
);

-- Index for pending trades lookup
CREATE INDEX IF NOT EXISTS idx_nflmon_trades_pending ON nflmon_trades(to_user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_nflmon_trades_from ON nflmon_trades(from_user_id);
