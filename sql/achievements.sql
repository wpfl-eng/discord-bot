-- Achievements table
-- Run this SQL to create the achievements table

CREATE TABLE IF NOT EXISTS achievements (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(50) NOT NULL,
  username VARCHAR(100) NOT NULL,
  achievement_key VARCHAR(50) NOT NULL,
  achieved_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, achievement_key)
);

-- Index for faster lookups by user
CREATE INDEX IF NOT EXISTS idx_achievements_user_id ON achievements(user_id);

-- Index for faster lookups by achievement key
CREATE INDEX IF NOT EXISTS idx_achievements_key ON achievements(achievement_key);
