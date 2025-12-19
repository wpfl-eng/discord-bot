-- Migration: Create training system tables
-- Run this in your Vercel Postgres database

-- Training Grounds (one per user)
CREATE TABLE IF NOT EXISTS training_grounds (
  user_id TEXT PRIMARY KEY,
  username TEXT,
  notify_ready BOOLEAN DEFAULT FALSE,
  total_graduated INTEGER DEFAULT 0,
  total_busted INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Training Slots (9 per user, 3x3 grid)
CREATE TABLE IF NOT EXISTS training_slots (
  id SERIAL PRIMARY KEY,
  user_id TEXT REFERENCES training_grounds(user_id) ON DELETE CASCADE,
  slot_index INTEGER NOT NULL CHECK (slot_index >= 0 AND slot_index <= 8),
  state TEXT DEFAULT 'empty' CHECK (state IN ('empty', 'prepared', 'hydrated', 'training', 'ready', 'busted')),
  rookie_type TEXT CHECK (rookie_type IS NULL OR rookie_type IN ('QB', 'RB', 'WR', 'TE')),
  planted_at TIMESTAMP,
  ready_at TIMESTAMP,
  wilts_at TIMESTAMP,
  UNIQUE(user_id, slot_index)
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_training_slots_user ON training_slots(user_id);
CREATE INDEX IF NOT EXISTS idx_training_slots_state ON training_slots(state);
