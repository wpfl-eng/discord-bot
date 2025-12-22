// Stock Holdings Database Operations
// Handles buying, selling, and querying stock positions

import { sql } from '@vercel/postgres';
import * as economyDb from '../economy/economyDb.js';
import { STOCK_CONFIG } from './stockConfig.js';
import type { EconomyUser } from '../types/database.js';

// ============ Type Definitions ============

/**
 * Stock holding record from stock_holdings table
 */
export interface StockHolding {
  readonly user_id: string;
  readonly ticker: string;
  readonly shares: string; // numeric comes as string from postgres
  readonly average_cost: string; // numeric comes as string from postgres
  readonly first_purchased_at: Date;
  readonly last_updated_at: Date;
}

/**
 * Buy operation error types
 */
export type BuyError = 'INSUFFICIENT_FUNDS';

/**
 * Sell operation error types
 */
export type SellError = 'NO_HOLDING' | 'INSUFFICIENT_SHARES' | 'WALLET_UPDATE_FAILED';

/**
 * Successful buy result
 */
export interface BuySuccess {
  readonly success: true;
  readonly holding: StockHolding;
  readonly user: EconomyUser;
  readonly commission: number;
  readonly totalWithCommission: number;
}

/**
 * Failed buy result
 */
export interface BuyFailure {
  readonly success: false;
  readonly error: BuyError;
}

/**
 * Buy operation result (discriminated union)
 */
export type BuyResult = BuySuccess | BuyFailure;

/**
 * Successful sell result
 */
export interface SellSuccess {
  readonly success: true;
  readonly proceeds: number;
  readonly commission: number;
  readonly netProceeds: number;
  readonly profit: number;
  readonly holding: StockHolding | null;
  readonly user: EconomyUser;
}

/**
 * Failed sell result
 */
export interface SellFailure {
  readonly success: false;
  readonly error: SellError;
}

/**
 * Sell operation result (discriminated union)
 */
export type SellResult = SellSuccess | SellFailure;

/**
 * Portfolio statistics
 */
export interface PortfolioStats {
  readonly uniqueStocks: number;
  readonly totalCostBasis: number;
}

// ============ Read Operations ============

/**
 * Get all stock holdings for a user
 * @param userId - Discord user ID
 * @returns Array of holdings
 */
export async function getPortfolio(userId: string): Promise<StockHolding[]> {
  const result = await sql<StockHolding>`
    SELECT * FROM stock_holdings
    WHERE user_id = ${userId}
    ORDER BY ticker
  `;
  return result.rows;
}

/**
 * Get a specific holding for a user
 * @param userId - Discord user ID
 * @param ticker - Stock ticker symbol
 * @returns Holding or null if not found
 */
export async function getHolding(
  userId: string,
  ticker: string
): Promise<StockHolding | null> {
  const normalizedTicker = ticker.toUpperCase().trim();
  const result = await sql<StockHolding>`
    SELECT * FROM stock_holdings
    WHERE user_id = ${userId}
      AND ticker = ${normalizedTicker}
    LIMIT 1
  `;
  return result.rows[0] ?? null;
}

// ============ Buy Operations ============

/**
 * Buy shares of a stock
 * Atomic operation: deducts from wallet and adds/updates holding
 * @param userId - Discord user ID
 * @param ticker - Stock ticker symbol
 * @param shares - Number of shares to buy
 * @param pricePerShare - Current price per share
 * @param totalCost - Total cost in coins
 * @returns Buy result with success/failure discriminated union
 */
export async function buyShares(
  userId: string,
  ticker: string,
  shares: number,
  pricePerShare: number,
  totalCost: number
): Promise<BuyResult> {
  const normalizedTicker = ticker.toUpperCase().trim();

  // Calculate commission (2% fee)
  const commission = Math.floor(totalCost * STOCK_CONFIG.COMMISSION_RATE);
  const totalWithCommission = Math.floor(totalCost) + commission;

  // First, deduct from wallet (atomic - fails if insufficient funds)
  const updatedUser = await economyDb.deductFromWallet(userId, totalWithCommission);

  if (!updatedUser) {
    return { success: false, error: 'INSUFFICIENT_FUNDS' };
  }

  // Get existing holding to calculate new average cost
  const existingHolding = await getHolding(userId, normalizedTicker);

  let newShares: number;
  let newAverageCost: number;

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
  const result = await sql<StockHolding>`
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
    commission,
    totalWithCommission,
  };
}

// ============ Sell Operations ============

/**
 * Sell shares of a stock
 * Atomic operation: removes/reduces holding and adds to wallet
 * @param userId - Discord user ID
 * @param ticker - Stock ticker symbol
 * @param sharesToSell - Number of shares to sell
 * @param pricePerShare - Current price per share
 * @returns Sell result with success/failure discriminated union
 */
export async function sellShares(
  userId: string,
  ticker: string,
  sharesToSell: number,
  pricePerShare: number
): Promise<SellResult> {
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

  // Calculate proceeds and commission (2% fee)
  const grossProceeds = Math.floor(sharesToSell * pricePerShare);
  const commission = Math.floor(grossProceeds * STOCK_CONFIG.COMMISSION_RATE);
  const netProceeds = grossProceeds - commission;
  const costBasis = sharesToSell * parseFloat(existingHolding.average_cost);
  const profit = netProceeds - costBasis;

  const remainingShares = currentShares - sharesToSell;

  // Update or delete the holding
  let holdingResult: StockHolding | null;
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
    const result = await sql<StockHolding>`
      UPDATE stock_holdings
      SET shares = ${remainingShares},
          last_updated_at = NOW()
      WHERE user_id = ${userId}
        AND ticker = ${normalizedTicker}
      RETURNING *
    `;
    holdingResult = result.rows[0];
  }

  // Add net proceeds to wallet (after commission)
  const updatedUser = await economyDb.addToWallet(userId, netProceeds);

  if (!updatedUser) {
    // This shouldn't happen, but handle it gracefully
    console.error(
      `Failed to add ${netProceeds} to wallet for user ${userId} after selling ${sharesToSell} shares of ${normalizedTicker}`
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
    proceeds: grossProceeds,
    commission,
    netProceeds,
    profit,
    holding: holdingResult,
    user: updatedUser,
  };
}

// ============ Portfolio Stats ============

/**
 * Get portfolio summary statistics for a user
 * @param userId - Discord user ID
 * @returns Portfolio statistics
 */
export async function getPortfolioStats(userId: string): Promise<PortfolioStats> {
  const result = await sql<{ unique_stocks: string; total_cost_basis: string }>`
    SELECT
      COUNT(*) as unique_stocks,
      COALESCE(SUM(shares * average_cost), 0) as total_cost_basis
    FROM stock_holdings
    WHERE user_id = ${userId}
  `;

  return {
    uniqueStocks: parseInt(result.rows[0]?.unique_stocks ?? '0', 10),
    totalCostBasis: parseFloat(result.rows[0]?.total_cost_basis ?? '0'),
  };
}
