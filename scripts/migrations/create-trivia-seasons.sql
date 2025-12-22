-- scripts/migrations/create-trivia-seasons.sql
-- Monthly trivia season winners and rewards tracking

CREATE TABLE IF NOT EXISTS trivia_seasons (
  id SERIAL PRIMARY KEY,
  year_month VARCHAR(7) NOT NULL,
  first_place_user_id VARCHAR(64),
  first_place_username VARCHAR(64),
  first_place_points INTEGER DEFAULT 0,
  second_place_user_id VARCHAR(64),
  second_place_username VARCHAR(64),
  second_place_points INTEGER DEFAULT 0,
  third_place_user_id VARCHAR(64),
  third_place_username VARCHAR(64),
  third_place_points INTEGER DEFAULT 0,
  rewards_paid BOOLEAN DEFAULT FALSE,
  ended_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(year_month)
);

-- Index for quick lookups by month
CREATE INDEX IF NOT EXISTS idx_trivia_seasons_year_month ON trivia_seasons(year_month);
