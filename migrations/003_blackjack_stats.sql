-- Migration: Create blackjack_stats table for tracking player statistics
-- Run this in your Vercel Postgres database

CREATE TABLE IF NOT EXISTS blackjack_stats (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(20) NOT NULL UNIQUE,
  username VARCHAR(100),

  -- Game counts
  games_played INTEGER DEFAULT 0 CHECK (games_played >= 0),
  games_won INTEGER DEFAULT 0 CHECK (games_won >= 0),
  games_lost INTEGER DEFAULT 0 CHECK (games_lost >= 0),
  pushes INTEGER DEFAULT 0 CHECK (pushes >= 0),
  blackjacks_hit INTEGER DEFAULT 0 CHECK (blackjacks_hit >= 0),
  busts INTEGER DEFAULT 0 CHECK (busts >= 0),

  -- Streaks (current_streak: positive = wins, negative = losses, 0 = neutral/push)
  current_streak INTEGER DEFAULT 0,
  best_win_streak INTEGER DEFAULT 0 CHECK (best_win_streak >= 0),
  worst_loss_streak INTEGER DEFAULT 0 CHECK (worst_loss_streak >= 0),

  -- Financial tracking
  total_wagered INTEGER DEFAULT 0 CHECK (total_wagered >= 0),
  total_won INTEGER DEFAULT 0 CHECK (total_won >= 0),
  biggest_win INTEGER DEFAULT 0 CHECK (biggest_win >= 0),

  -- Action tracking
  doubles_attempted INTEGER DEFAULT 0 CHECK (doubles_attempted >= 0),
  doubles_won INTEGER DEFAULT 0 CHECK (doubles_won >= 0),
  splits_attempted INTEGER DEFAULT 0 CHECK (splits_attempted >= 0),
  insurances_taken INTEGER DEFAULT 0 CHECK (insurances_taken >= 0),
  surrenders INTEGER DEFAULT 0 CHECK (surrenders >= 0),

  -- Timestamps
  last_played_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_blackjack_stats_user ON blackjack_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_blackjack_stats_games ON blackjack_stats(games_played DESC);
CREATE INDEX IF NOT EXISTS idx_blackjack_stats_wins ON blackjack_stats(games_won DESC);
CREATE INDEX IF NOT EXISTS idx_blackjack_stats_profit ON blackjack_stats((total_won - total_wagered) DESC);
CREATE INDEX IF NOT EXISTS idx_blackjack_stats_blackjacks ON blackjack_stats(blackjacks_hit DESC);
CREATE INDEX IF NOT EXISTS idx_blackjack_stats_streak ON blackjack_stats(best_win_streak DESC);
