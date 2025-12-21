-- Prediction Bets Table
-- Stores user bets on Polymarket prediction markets

CREATE TABLE prediction_bets (
  id SERIAL PRIMARY KEY,
  user_id VARCHAR(20) NOT NULL,

  -- Market snapshot (stored at bet time for display without API)
  market_id VARCHAR(100) NOT NULL,
  market_slug VARCHAR(200),
  market_question TEXT NOT NULL,

  -- Outcome info (clob_token_id is canonical for resolution)
  outcome_name VARCHAR(100) NOT NULL,
  clob_token_id VARCHAR(100) NOT NULL,

  -- Bet details
  coins_wagered INTEGER NOT NULL CHECK (coins_wagered > 0),
  locked_odds DECIMAL(8, 6) NOT NULL CHECK (locked_odds > 0 AND locked_odds < 1),
  potential_payout INTEGER NOT NULL,

  -- Resolution
  status VARCHAR(20) NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'won', 'lost', 'voided')),
  payout INTEGER NOT NULL DEFAULT 0,
  resolved_at TIMESTAMP,

  -- Timestamps
  placed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMP
);

-- Index for user's bets lookup (/my-predictions)
CREATE INDEX idx_prediction_bets_user ON prediction_bets(user_id);

-- Partial index for resolution sweep (open bets past expiry)
CREATE INDEX idx_prediction_bets_open_expiring ON prediction_bets(status, expires_at)
  WHERE status = 'open';

-- Index for batch resolution by market
CREATE INDEX idx_prediction_bets_market ON prediction_bets(market_id);
