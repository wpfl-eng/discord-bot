-- Migration: Create redzone_stats table for tracking Red Zone game statistics
-- Run this in your Vercel Postgres database

CREATE TABLE IF NOT EXISTS redzone_stats (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(20) NOT NULL UNIQUE,
  username VARCHAR(100),

  -- Game counts
  games_played INTEGER DEFAULT 0 CHECK (games_played >= 0),
  touchdowns INTEGER DEFAULT 0 CHECK (touchdowns >= 0),
  fumbles INTEGER DEFAULT 0 CHECK (fumbles >= 0),
  cashouts INTEGER DEFAULT 0 CHECK (cashouts >= 0),

  -- Streaks (current_td_streak: positive = TD streak, negative = fumble streak)
  current_td_streak INTEGER DEFAULT 0,
  best_td_streak INTEGER DEFAULT 0 CHECK (best_td_streak >= 0),
  worst_fumble_streak INTEGER DEFAULT 0 CHECK (worst_fumble_streak >= 0),

  -- Yards
  total_yards_gained INTEGER DEFAULT 0 CHECK (total_yards_gained >= 0),
  longest_drive INTEGER DEFAULT 0 CHECK (longest_drive >= 0),

  -- Financial tracking
  total_wagered INTEGER DEFAULT 0 CHECK (total_wagered >= 0),
  total_won INTEGER DEFAULT 0 CHECK (total_won >= 0),
  biggest_win INTEGER DEFAULT 0 CHECK (biggest_win >= 0),

  -- Timestamps
  last_played_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_redzone_stats_user ON redzone_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_redzone_stats_touchdowns ON redzone_stats(touchdowns DESC);
CREATE INDEX IF NOT EXISTS idx_redzone_stats_games ON redzone_stats(games_played DESC);
CREATE INDEX IF NOT EXISTS idx_redzone_stats_profit ON redzone_stats((total_won - total_wagered) DESC);
CREATE INDEX IF NOT EXISTS idx_redzone_stats_streak ON redzone_stats(best_td_streak DESC);
CREATE INDEX IF NOT EXISTS idx_redzone_stats_drive ON redzone_stats(longest_drive DESC);
