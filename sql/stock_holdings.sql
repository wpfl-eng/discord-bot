-- Stock Holdings Table
-- Tracks user stock portfolios for the /stock command

CREATE TABLE IF NOT EXISTS stock_holdings (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(20) NOT NULL,
  ticker VARCHAR(10) NOT NULL,
  shares DECIMAL(18, 6) NOT NULL CHECK (shares > 0),
  average_cost DECIMAL(18, 6) NOT NULL CHECK (average_cost > 0),
  first_purchased_at TIMESTAMP DEFAULT NOW(),
  last_updated_at TIMESTAMP DEFAULT NOW(),

  -- Each user can only have one row per ticker
  CONSTRAINT unique_user_ticker UNIQUE (user_id, ticker)
);

-- Index for user portfolio lookups
CREATE INDEX IF NOT EXISTS idx_stock_holdings_user ON stock_holdings(user_id);

-- Index for ticker-based queries (e.g., "who owns AAPL?")
CREATE INDEX IF NOT EXISTS idx_stock_holdings_ticker ON stock_holdings(ticker);
