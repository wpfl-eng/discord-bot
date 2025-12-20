// Stock Holdings Database Operations
// Handles buying, selling, and querying stock positions

import { sql } from '@vercel/postgres';
import * as economyDb from '../economy/economyDb.js';

// ============ Read Operations ============

/**
 * Get all stock holdings for a user
 * @param {string} userId - Discord user ID
 * @returns {Promise<Array>} - Array of holdings
 */
export async function getPortfolio(userId) {
  const result = await sql`
    SELECT * FROM stock_holdings
    WHERE user_id = ${userId}
    ORDER BY ticker
  `;
  return result.rows;
}

/**
 * Get a specific holding for a user
 * @param {string} userId - Discord user ID
 * @param {string} ticker - Stock ticker symbol
 * @returns {Promise<object|null>} - Holding or null if not found
 */
export async function getHolding(userId, ticker) {
  const normalizedTicker = ticker.toUpperCase().trim();
  const result = await sql`
    SELECT * FROM stock_holdings
    WHERE user_id = ${userId}
      AND ticker = ${normalizedTicker}
    LIMIT 1
  `;
  return result.rows[0] || null;
}

// ============ Buy Operations ============

/**
 * Buy shares of a stock
 * Atomic operation: deducts from wallet and adds/updates holding
 * @param {string} userId - Discord user ID
 * @param {string} ticker - Stock ticker symbol
 * @param {number} shares - Number of shares to buy
 * @param {number} pricePerShare - Current price per share
 * @param {number} totalCost - Total cost in coins
 * @returns {Promise<{success: boolean, holding?: object, user?: object, error?: string}>}
 */
export async function buyShares(userId, ticker, shares, pricePerShare, totalCost) {
  const normalizedTicker = ticker.toUpperCase().trim();

  // First, deduct from wallet (atomic - fails if insufficient funds)
  const updatedUser = await economyDb.deductFromWallet(userId, Math.floor(totalCost));

  if (!updatedUser) {
    return { success: false, error: 'INSUFFICIENT_FUNDS' };
  }

  // Get existing holding to calculate new average cost
  const existingHolding = await getHolding(userId, normalizedTicker);

  let newShares;
  let newAverageCost;

  if (existingHolding) {
    // Calculate weighted average cost for existing position
    const existingValue =
      parseFloat(existingHolding.shares) * parseFloat(existingHolding.average_cost);
    const newValue = shares * pricePerShare;
    newShares = parseFloat(existingHolding.shares) + shares;
    newAverageCost = (existingValue + newValue) / newShares;
  } else {
    // New position
    newShares = shares;
    newAverageCost = pricePerShare;
  }

  // Upsert the holding
  const result = await sql`
    INSERT INTO stock_holdings (user_id, ticker, shares, average_cost, first_purchased_at, last_updated_at)
    VALUES (${userId}, ${normalizedTicker}, ${newShares}, ${newAverageCost}, NOW(), NOW())
    ON CONFLICT (user_id, ticker) DO UPDATE SET
      shares = ${newShares},
      average_cost = ${newAverageCost},
      last_updated_at = NOW()
    RETURNING *
  `;

  return {
    success: true,
    holding: result.rows[0],
    user: updatedUser,
  };
}

// ============ Sell Operations ============

/**
 * Sell shares of a stock
 * Atomic operation: removes/reduces holding and adds to wallet
 * @param {string} userId - Discord user ID
 * @param {string} ticker - Stock ticker symbol
 * @param {number} sharesToSell - Number of shares to sell
 * @param {number} pricePerShare - Current price per share
 * @returns {Promise<{success: boolean, proceeds?: number, profit?: number, holding?: object, user?: object, error?: string}>}
 */
export async function sellShares(userId, ticker, sharesToSell, pricePerShare) {
  const normalizedTicker = ticker.toUpperCase().trim();

  // Get existing holding
  const existingHolding = await getHolding(userId, normalizedTicker);

  if (!existingHolding) {
    return { success: false, error: 'NO_HOLDING' };
  }

  const currentShares = parseFloat(existingHolding.shares);

  if (currentShares < sharesToSell) {
    return { success: false, error: 'INSUFFICIENT_SHARES' };
  }

  // Calculate proceeds and profit/loss
  const proceeds = Math.floor(sharesToSell * pricePerShare);
  const costBasis = sharesToSell * parseFloat(existingHolding.average_cost);
  const profit = proceeds - costBasis;

  const remainingShares = currentShares - sharesToSell;

  // Update or delete the holding
  let holdingResult;
  if (remainingShares <= 0.000001) {
    // Delete if effectively zero shares remain
    await sql`
      DELETE FROM stock_holdings
      WHERE user_id = ${userId}
        AND ticker = ${normalizedTicker}
    `;
    holdingResult = null;
  } else {
    // Update with remaining shares (average cost stays the same)
    const result = await sql`
      UPDATE stock_holdings
      SET shares = ${remainingShares},
          last_updated_at = NOW()
      WHERE user_id = ${userId}
        AND ticker = ${normalizedTicker}
      RETURNING *
    `;
    holdingResult = result.rows[0];
  }

  // Add proceeds to wallet
  const updatedUser = await economyDb.addToWallet(userId, proceeds);

  if (!updatedUser) {
    // This shouldn't happen, but handle it gracefully
    console.error(
      `Failed to add ${proceeds} to wallet for user ${userId} after selling ${sharesToSell} shares of ${normalizedTicker}`
    );
    // Attempt to restore the shares
    await sql`
      INSERT INTO stock_holdings (user_id, ticker, shares, average_cost, last_updated_at)
      VALUES (${userId}, ${normalizedTicker}, ${sharesToSell}, ${existingHolding.average_cost}, NOW())
      ON CONFLICT (user_id, ticker) DO UPDATE SET
        shares = stock_holdings.shares + ${sharesToSell},
        last_updated_at = NOW()
    `;
    return { success: false, error: 'WALLET_UPDATE_FAILED' };
  }

  return {
    success: true,
    proceeds,
    profit,
    holding: holdingResult,
    user: updatedUser,
  };
}

// ============ Portfolio Stats ============

/**
 * Get portfolio summary statistics for a user
 * @param {string} userId - Discord user ID
 * @returns {Promise<{uniqueStocks: number, totalCostBasis: number}>}
 */
export async function getPortfolioStats(userId) {
  const result = await sql`
    SELECT
      COUNT(*) as unique_stocks,
      COALESCE(SUM(shares * average_cost), 0) as total_cost_basis
    FROM stock_holdings
    WHERE user_id = ${userId}
  `;

  return {
    uniqueStocks: parseInt(result.rows[0]?.unique_stocks) || 0,
    totalCostBasis: parseFloat(result.rows[0]?.total_cost_basis) || 0,
  };
}
