-- Stock Prices Cache Table
-- Caches latest stock prices for leaderboard calculations
-- Populated by stockApi.getQuote() on successful fetches

CREATE TABLE IF NOT EXISTS stock_prices (
  ticker VARCHAR(10) PRIMARY KEY,
  price NUMERIC(12, 2) NOT NULL,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Index for finding stale prices if needed
CREATE INDEX IF NOT EXISTS idx_stock_prices_updated ON stock_prices(updated_at);
