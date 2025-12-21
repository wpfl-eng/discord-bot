-- Migration: Create video_poker_stats table for tracking player statistics
-- Run this in your Vercel Postgres database

CREATE TABLE IF NOT EXISTS video_poker_stats (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(20) NOT NULL,
  username VARCHAR(100),
  variant_id VARCHAR(50) NOT NULL DEFAULT 'jacks_or_better',

  -- Game counts
  games_played INTEGER DEFAULT 0 CHECK (games_played >= 0),
  games_won INTEGER DEFAULT 0 CHECK (games_won >= 0),
  games_lost INTEGER DEFAULT 0 CHECK (games_lost >= 0),

  -- Streaks (current_streak: positive = wins, negative = losses)
  current_streak INTEGER DEFAULT 0,
  best_win_streak INTEGER DEFAULT 0 CHECK (best_win_streak >= 0),
  worst_loss_streak INTEGER DEFAULT 0 CHECK (worst_loss_streak >= 0),

  -- Financial tracking
  total_wagered INTEGER DEFAULT 0 CHECK (total_wagered >= 0),
  total_won INTEGER DEFAULT 0 CHECK (total_won >= 0),
  biggest_win INTEGER DEFAULT 0 CHECK (biggest_win >= 0),

  -- Hand type tracking (for achievements and stats)
  royal_flushes INTEGER DEFAULT 0 CHECK (royal_flushes >= 0),
  straight_flushes INTEGER DEFAULT 0 CHECK (straight_flushes >= 0),
  four_of_a_kinds INTEGER DEFAULT 0 CHECK (four_of_a_kinds >= 0),
  full_houses INTEGER DEFAULT 0 CHECK (full_houses >= 0),
  flushes INTEGER DEFAULT 0 CHECK (flushes >= 0),
  straights INTEGER DEFAULT 0 CHECK (straights >= 0),
  three_of_a_kinds INTEGER DEFAULT 0 CHECK (three_of_a_kinds >= 0),
  two_pairs INTEGER DEFAULT 0 CHECK (two_pairs >= 0),
  jacks_or_betters INTEGER DEFAULT 0 CHECK (jacks_or_betters >= 0),

  -- Timestamps
  last_played_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),

  -- Composite unique constraint for user + variant
  UNIQUE(user_id, variant_id)
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_video_poker_stats_user ON video_poker_stats(user_id);
CREATE INDEX IF NOT EXISTS idx_video_poker_stats_variant ON video_poker_stats(variant_id);
CREATE INDEX IF NOT EXISTS idx_video_poker_stats_games ON video_poker_stats(games_played DESC);
CREATE INDEX IF NOT EXISTS idx_video_poker_stats_wins ON video_poker_stats(games_won DESC);
CREATE INDEX IF NOT EXISTS idx_video_poker_stats_profit ON video_poker_stats((total_won - total_wagered) DESC);
CREATE INDEX IF NOT EXISTS idx_video_poker_stats_royals ON video_poker_stats(royal_flushes DESC);
CREATE INDEX IF NOT EXISTS idx_video_poker_stats_streak ON video_poker_stats(best_win_streak DESC);
CREATE INDEX IF NOT EXISTS idx_video_poker_stats_biggest ON video_poker_stats(biggest_win DESC);
