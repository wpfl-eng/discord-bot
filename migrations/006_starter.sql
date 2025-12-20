-- Add starter_claimed column to track one-time starter selection
ALTER TABLE nflmon_stats ADD COLUMN IF NOT EXISTS starter_claimed BOOLEAN DEFAULT FALSE;
