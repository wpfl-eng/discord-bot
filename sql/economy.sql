-- Economy System Tables
-- Run this in your PostgreSQL database to create the required tables

CREATE TABLE IF NOT EXISTS economy_users (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(20) NOT NULL UNIQUE,
  username VARCHAR(100),
  wallet INTEGER DEFAULT 0 CHECK (wallet >= 0),
  bank INTEGER DEFAULT 0 CHECK (bank >= 0),
  bank_capacity INTEGER DEFAULT 1000 CHECK (bank_capacity >= 0),
  last_daily TIMESTAMP,
  daily_streak INTEGER DEFAULT 0 CHECK (daily_streak >= 0),
  last_work TIMESTAMP,
  total_earned INTEGER DEFAULT 0 CHECK (total_earned >= 0),
  total_lost INTEGER DEFAULT 0 CHECK (total_lost >= 0),
  created_at TIMESTAMP DEFAULT NOW(),

  -- Ensure bank never exceeds capacity
  CONSTRAINT bank_within_capacity CHECK (bank <= bank_capacity)
);

-- Index for leaderboard queries (sorted by total wealth)
CREATE INDEX IF NOT EXISTS idx_economy_wealth ON economy_users((wallet + bank) DESC);

-- Index for user lookups
CREATE INDEX IF NOT EXISTS idx_economy_user_id ON economy_users(user_id);

-- If table already exists, add constraints (run these separately if needed)
-- ALTER TABLE economy_users ADD CONSTRAINT wallet_non_negative CHECK (wallet >= 0);
-- ALTER TABLE economy_users ADD CONSTRAINT bank_non_negative CHECK (bank >= 0);
-- ALTER TABLE economy_users ADD CONSTRAINT bank_within_capacity CHECK (bank <= bank_capacity);
