-- scripts/migrations/add-trivia-active-columns.sql
-- Add question type and multiple choice support

-- Add type column (free_form or multiple_choice)
ALTER TABLE trivia_active
ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'free_form';

-- Add choices column for multiple choice questions (stores shuffled A/B/C/D)
ALTER TABLE trivia_active
ADD COLUMN IF NOT EXISTS choices TEXT[];

-- Add index on sent_at for efficient 30-day queries
CREATE INDEX IF NOT EXISTS idx_trivia_active_sent_at ON trivia_active(sent_at);
