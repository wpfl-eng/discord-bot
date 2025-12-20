-- Wordle Game Tables
-- Run this SQL to create the wordle game tables

-- Global word state (one active word at a time)
-- Uses singleton pattern - only the most recent row is the "current" word
CREATE TABLE IF NOT EXISTS wordle_words (
  id SERIAL PRIMARY KEY,
  current_word VARCHAR(5) NOT NULL,
  word_number INTEGER NOT NULL DEFAULT 1 CHECK (word_number >= 1),
  set_at TIMESTAMP NOT NULL DEFAULT NOW(),
  solved BOOLEAN NOT NULL DEFAULT FALSE,
  first_solver_id VARCHAR(20),
  first_solver_username VARCHAR(100),
  first_solved_at TIMESTAMP,
  solve_count INTEGER NOT NULL DEFAULT 0 CHECK (solve_count >= 0)
);

-- Index for getting the current word quickly
CREATE INDEX IF NOT EXISTS idx_wordle_words_id_desc ON wordle_words(id DESC);

-- Per-user game state for each word
-- Tracks guesses and completion status for each user/word combination
CREATE TABLE IF NOT EXISTS wordle_user_games (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(20) NOT NULL,
  username VARCHAR(100) NOT NULL,
  word VARCHAR(5) NOT NULL,
  word_number INTEGER NOT NULL,
  guesses JSONB NOT NULL DEFAULT '[]',
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  won BOOLEAN NOT NULL DEFAULT FALSE,
  started_at TIMESTAMP NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMP,
  UNIQUE (user_id, word)
);

-- Indexes for user game lookups
CREATE INDEX IF NOT EXISTS idx_wordle_user_games_user_id ON wordle_user_games(user_id);
CREATE INDEX IF NOT EXISTS idx_wordle_user_games_user_word ON wordle_user_games(user_id, word);
CREATE INDEX IF NOT EXISTS idx_wordle_user_games_word_number ON wordle_user_games(word_number);

-- User statistics for wordle
-- Tracks lifetime stats for achievements and leaderboards
CREATE TABLE IF NOT EXISTS wordle_stats (
  user_id VARCHAR(20) PRIMARY KEY,
  username VARCHAR(100) NOT NULL,
  games_played INTEGER NOT NULL DEFAULT 0 CHECK (games_played >= 0),
  games_won INTEGER NOT NULL DEFAULT 0 CHECK (games_won >= 0),
  current_streak INTEGER NOT NULL DEFAULT 0,
  best_streak INTEGER NOT NULL DEFAULT 0 CHECK (best_streak >= 0),
  first_solves INTEGER NOT NULL DEFAULT 0 CHECK (first_solves >= 0),
  total_guesses INTEGER NOT NULL DEFAULT 0 CHECK (total_guesses >= 0),
  guess_distribution JSONB NOT NULL DEFAULT '{"1":0,"2":0,"3":0,"4":0,"5":0,"6":0}',
  created_at TIMESTAMP DEFAULT NOW(),
  last_played_at TIMESTAMP
);

-- Indexes for leaderboard queries
CREATE INDEX IF NOT EXISTS idx_wordle_stats_games_won ON wordle_stats(games_won DESC);
CREATE INDEX IF NOT EXISTS idx_wordle_stats_best_streak ON wordle_stats(best_streak DESC);
CREATE INDEX IF NOT EXISTS idx_wordle_stats_first_solves ON wordle_stats(first_solves DESC);
