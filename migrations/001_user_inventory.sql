-- Migration: Create user_inventory table
-- Run this in your Vercel Postgres database

CREATE TABLE IF NOT EXISTS user_inventory (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  item_type TEXT NOT NULL,
  quantity INTEGER DEFAULT 1,
  item_value INTEGER,
  acquired_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, item_type)
);

-- Index for faster user lookups
CREATE INDEX IF NOT EXISTS idx_inventory_user ON user_inventory(user_id);

-- Example: Add test item for a user
-- INSERT INTO user_inventory (user_id, item_type, quantity, item_value)
-- VALUES ('123456789', 'rookie_qb', 3, 400)
-- ON CONFLICT (user_id, item_type) DO UPDATE SET quantity = user_inventory.quantity + 3;
