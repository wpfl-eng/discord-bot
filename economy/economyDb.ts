// Economy Database Operations
// User wallet, bank, transactions, and leaderboards

import { sql } from '@vercel/postgres';
import type {
  EconomyUser,
  TransferResult,
  EconomyLeaderboardEntry,
  TotalWealthEntry,
} from '../types/database.js';

// Re-export shared types for consumers
export type { EconomyUser, TransferResult, EconomyLeaderboardEntry, TotalWealthEntry };

// ============ User Management ============

/**
 * Get or create a user's economy account
 * @param userId - Discord user ID
 * @param username - Discord username
 * @returns User economy data
 */
export async function getOrCreateUser(userId: string, username: string): Promise<EconomyUser> {
  const result = await sql<EconomyUser>`
    INSERT INTO economy_users (user_id, username, created_at)
    VALUES (${userId}, ${username}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      username = ${username}
    RETURNING *
  `;
  return result.rows[0];
}

/**
 * Get a user's economy data
 * @param userId - Discord user ID
 * @returns User data or null
 */
export async function getUser(userId: string): Promise<EconomyUser | null> {
  const result = await sql<EconomyUser>`
    SELECT * FROM economy_users
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  return result.rows[0] ?? null;
}

// ============ Atomic Wallet Operations ============

/**
 * Add coins to a user's wallet (for earnings only)
 * @param userId - Discord user ID
 * @param amount - Amount to add (must be positive)
 * @returns Updated user data or null if amount invalid
 */
export async function addToWallet(userId: string, amount: number): Promise<EconomyUser | null> {
  if (amount <= 0) return null;

  const result = await sql<EconomyUser>`
    UPDATE economy_users
    SET
      wallet = wallet + ${amount},
      total_earned = total_earned + ${amount}
    WHERE user_id = ${userId}
    RETURNING *
  `;
  return result.rows[0] ?? null;
}

/**
 * Deduct coins from a user's wallet (atomic - fails if insufficient funds)
 * @param userId - Discord user ID
 * @param amount - Amount to deduct (must be positive)
 * @returns Updated user data or null if insufficient funds
 */
export async function deductFromWallet(
  userId: string,
  amount: number
): Promise<EconomyUser | null> {
  if (amount <= 0) return null;

  const result = await sql<EconomyUser>`
    UPDATE economy_users
    SET
      wallet = wallet - ${amount},
      total_lost = total_lost + ${amount}
    WHERE user_id = ${userId}
      AND wallet >= ${amount}
    RETURNING *
  `;
  return result.rows[0] ?? null;
}

/**
 * Transfer coins between two users atomically
 * Deducts from one wallet and adds to the other
 * Uses a proper database transaction to ensure both operations succeed or both fail
 * NOTE: currently unreferenced - the /rob command was its only caller
 * @param fromUserId - Source Discord user ID
 * @param toUserId - Destination Discord user ID
 * @param amount - Amount to transfer
 * @returns Both updated users or nulls if failed
 */
export async function transferBetweenUsers(
  fromUserId: string,
  toUserId: string,
  amount: number
): Promise<TransferResult> {
  if (amount <= 0) return { from: null, to: null };

  const client = await sql.connect();
  try {
    await client.query('BEGIN');

    // Deduct from victim (atomic - will fail if insufficient)
    const fromResult = await client.query<EconomyUser>(
      `UPDATE economy_users
       SET wallet = wallet - $1, total_lost = total_lost + $1
       WHERE user_id = $2 AND wallet >= $1
       RETURNING *`,
      [amount, fromUserId]
    );

    if (!fromResult.rows[0]) {
      await client.query('ROLLBACK');
      return { from: null, to: null };
    }

    // Add to attacker
    const toResult = await client.query<EconomyUser>(
      `UPDATE economy_users
       SET wallet = wallet + $1, total_earned = total_earned + $1
       WHERE user_id = $2
       RETURNING *`,
      [amount, toUserId]
    );

    await client.query('COMMIT');
    return { from: fromResult.rows[0], to: toResult.rows[0] ?? null };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Transfer money from wallet to bank (atomic)
 * @param userId - Discord user ID
 * @param amount - Amount to transfer
 * @returns Updated user data or null if insufficient funds/capacity
 */
export async function transferToBank(userId: string, amount: number): Promise<EconomyUser | null> {
  if (amount <= 0) return null;

  const result = await sql<EconomyUser>`
    UPDATE economy_users
    SET
      wallet = wallet - ${amount},
      bank = bank + ${amount}
    WHERE user_id = ${userId}
      AND wallet >= ${amount}
      AND bank + ${amount} <= bank_capacity
    RETURNING *
  `;
  return result.rows[0] ?? null;
}

/**
 * Transfer money from bank to wallet (atomic)
 * @param userId - Discord user ID
 * @param amount - Amount to transfer
 * @returns Updated user data or null if insufficient funds
 */
export async function transferToWallet(
  userId: string,
  amount: number
): Promise<EconomyUser | null> {
  if (amount <= 0) return null;

  const result = await sql<EconomyUser>`
    UPDATE economy_users
    SET
      wallet = wallet + ${amount},
      bank = bank - ${amount}
    WHERE user_id = ${userId}
      AND bank >= ${amount}
    RETURNING *
  `;
  return result.rows[0] ?? null;
}

// ============ Daily/Work Cooldowns ============

/**
 * Update last daily timestamp, streak, and add reward atomically
 * @param userId - Discord user ID
 * @param streak - New streak value
 * @param reward - Coins to add to wallet
 * @returns Updated user data or null
 */
export async function claimDaily(
  userId: string,
  streak: number,
  reward: number
): Promise<EconomyUser | null> {
  const result = await sql<EconomyUser>`
    UPDATE economy_users
    SET
      last_daily = NOW(),
      daily_streak = ${streak},
      wallet = wallet + ${reward},
      total_earned = total_earned + ${reward}
    WHERE user_id = ${userId}
    RETURNING *
  `;
  return result.rows[0] ?? null;
}

/**
 * Update last work timestamp and add reward atomically
 * @param userId - Discord user ID
 * @param reward - Coins to add to wallet (0 for failed work)
 * @returns Updated user data or null
 */
export async function claimWork(userId: string, reward: number): Promise<EconomyUser | null> {
  const result = await sql<EconomyUser>`
    UPDATE economy_users
    SET
      last_work = NOW(),
      wallet = wallet + ${reward},
      total_earned = CASE WHEN ${reward} > 0 THEN total_earned + ${reward} ELSE total_earned END
    WHERE user_id = ${userId}
    RETURNING *
  `;
  return result.rows[0] ?? null;
}

// ============ Shop Items ============

/**
 * Purchase bank expansion (atomic)
 * @param userId - Discord user ID
 * @param cost - Cost of expansion
 * @param expansionAmount - How much to expand capacity
 * @returns Updated user data or null if can't afford
 */
export async function buyBankExpansion(
  userId: string,
  cost: number,
  expansionAmount: number
): Promise<EconomyUser | null> {
  const result = await sql<EconomyUser>`
    UPDATE economy_users
    SET
      wallet = wallet - ${cost},
      bank_capacity = bank_capacity + ${expansionAmount},
      total_lost = total_lost + ${cost}
    WHERE user_id = ${userId}
      AND wallet >= ${cost}
    RETURNING *
  `;
  return result.rows[0] ?? null;
}

/**
 * Expand a user's bank capacity (legacy - use buyBankExpansion instead)
 * @param userId - Discord user ID
 * @param amount - Amount to expand by
 * @returns Updated user data or null
 */
export async function expandBank(userId: string, amount: number): Promise<EconomyUser | null> {
  const result = await sql<EconomyUser>`
    UPDATE economy_users
    SET bank_capacity = bank_capacity + ${amount}
    WHERE user_id = ${userId}
    RETURNING *
  `;
  return result.rows[0] ?? null;
}

// ============ Gamble ============

/**
 * Process a gamble win (atomic - adds winnings)
 * @param userId - Discord user ID
 * @param winnings - Amount won
 * @returns Updated user data or null
 */
export async function gambleWin(userId: string, winnings: number): Promise<EconomyUser | null> {
  const result = await sql<EconomyUser>`
    UPDATE economy_users
    SET
      wallet = wallet + ${winnings},
      total_earned = total_earned + ${winnings}
    WHERE user_id = ${userId}
    RETURNING *
  `;
  return result.rows[0] ?? null;
}

/**
 * Process a gamble loss (atomic - deducts bet)
 * @param userId - Discord user ID
 * @param bet - Amount lost
 * @returns Updated user data or null if insufficient funds
 */
export async function gambleLose(userId: string, bet: number): Promise<EconomyUser | null> {
  const result = await sql<EconomyUser>`
    UPDATE economy_users
    SET
      wallet = wallet - ${bet},
      total_lost = total_lost + ${bet}
    WHERE user_id = ${userId}
      AND wallet >= ${bet}
    RETURNING *
  `;
  return result.rows[0] ?? null;
}

// ============ Leaderboard ============

/**
 * Get the economy leaderboard
 * @param limit - Number of users to return
 * @returns Top users sorted by total wealth
 */
export async function getLeaderboard(limit: number = 10): Promise<EconomyLeaderboardEntry[]> {
  const result = await sql<EconomyLeaderboardEntry>`
    SELECT user_id, username, wallet, bank, (wallet + bank) as total_wealth, total_earned, total_lost
    FROM economy_users
    ORDER BY (wallet + bank) DESC
    LIMIT ${limit}
  `;
  return result.rows;
}

/**
 * Get a user's rank on the leaderboard
 * @param userId - Discord user ID
 * @returns User's rank (1-based) or null if not found
 */
export async function getUserRank(userId: string): Promise<number | null> {
  const user = await getUser(userId);
  if (!user) return null;

  const userWealth = user.wallet + user.bank;
  const result = await sql<{ rank: string }>`
    SELECT COUNT(*) + 1 as rank
    FROM economy_users
    WHERE (wallet + bank) > ${userWealth}
  `;
  return parseInt(result.rows[0]?.rank ?? '1', 10);
}

/**
 * Get total number of users in the economy
 * @returns Total user count
 */
export async function getTotalUsers(): Promise<number> {
  const result = await sql<{ count: string }>`
    SELECT COUNT(*) as count FROM economy_users
  `;
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

// ============ Total Wealth Leaderboard ============

// Sellable item types - keep in sync with inventoryConfig.ts ITEM_DEFINITIONS
// These are items with sellable: true that contribute to total wealth
// Hardcoded in SQL queries below for type safety with @vercel/postgres

/**
 * Get the total wealth leaderboard (cash + stocks + inventory)
 * @param limit - Number of users to return
 * @returns Top users sorted by total wealth
 */
export async function getTotalWealthLeaderboard(limit: number = 10): Promise<TotalWealthEntry[]> {
  const safeLimit = Math.min(Math.max(1, limit), 25);

  const result = await sql<TotalWealthEntry>`
    SELECT
      e.user_id,
      e.username,
      (e.wallet + e.bank) AS cash_wealth,
      COALESCE(s.stock_wealth, 0)::numeric AS stock_wealth,
      COALESCE(i.inventory_wealth, 0)::numeric AS inventory_wealth,
      (e.wallet + e.bank + COALESCE(s.stock_wealth, 0) + COALESCE(i.inventory_wealth, 0))::numeric AS total_wealth
    FROM economy_users e
    LEFT JOIN (
      SELECT h.user_id, SUM(h.shares * COALESCE(p.price, h.average_cost)) AS stock_wealth
      FROM stock_holdings h
      LEFT JOIN stock_prices p ON h.ticker = p.ticker
      GROUP BY h.user_id
    ) s ON e.user_id = s.user_id
    LEFT JOIN (
      SELECT user_id, SUM(quantity * COALESCE(item_value, 0)) AS inventory_wealth
      FROM user_inventory
      WHERE item_type IN ('rookie_te', 'rookie_rb', 'rookie_wr', 'rookie_qb', 'wordle_lucky_letter')
      GROUP BY user_id
    ) i ON e.user_id = i.user_id
    ORDER BY total_wealth DESC
    LIMIT ${safeLimit}
  `;

  return result.rows.map((row) => ({
    user_id: row.user_id,
    username: row.username,
    cash_wealth: Number(row.cash_wealth),
    stock_wealth: Number(row.stock_wealth),
    inventory_wealth: Number(row.inventory_wealth),
    total_wealth: Number(row.total_wealth),
  }));
}

/**
 * Get a user's rank on the total wealth leaderboard
 * @param userId - Discord user ID
 * @returns User's rank (1-based) or null if not found
 */
export async function getTotalWealthUserRank(userId: string): Promise<number | null> {
  const userWealth = await getUserTotalWealth(userId);
  if (!userWealth) return null;

  const result = await sql<{ rank: string }>`
    SELECT COUNT(*) + 1 as rank
    FROM economy_users e
    LEFT JOIN (
      SELECT h.user_id, SUM(h.shares * COALESCE(p.price, h.average_cost)) AS stock_wealth
      FROM stock_holdings h
      LEFT JOIN stock_prices p ON h.ticker = p.ticker
      GROUP BY h.user_id
    ) s ON e.user_id = s.user_id
    LEFT JOIN (
      SELECT user_id, SUM(quantity * COALESCE(item_value, 0)) AS inventory_wealth
      FROM user_inventory
      WHERE item_type IN ('rookie_te', 'rookie_rb', 'rookie_wr', 'rookie_qb', 'wordle_lucky_letter')
      GROUP BY user_id
    ) i ON e.user_id = i.user_id
    WHERE (e.wallet + e.bank + COALESCE(s.stock_wealth, 0) + COALESCE(i.inventory_wealth, 0)) > ${userWealth.total_wealth}
  `;

  return parseInt(result.rows[0]?.rank ?? '1', 10);
}

/**
 * Get a single user's total wealth breakdown
 * @param userId - Discord user ID
 * @returns User's wealth breakdown or null if not found
 */
export async function getUserTotalWealth(userId: string): Promise<TotalWealthEntry | null> {
  const result = await sql<TotalWealthEntry>`
    SELECT
      e.user_id,
      e.username,
      (e.wallet + e.bank) AS cash_wealth,
      COALESCE(s.stock_wealth, 0)::numeric AS stock_wealth,
      COALESCE(i.inventory_wealth, 0)::numeric AS inventory_wealth,
      (e.wallet + e.bank + COALESCE(s.stock_wealth, 0) + COALESCE(i.inventory_wealth, 0))::numeric AS total_wealth
    FROM economy_users e
    LEFT JOIN (
      SELECT h.user_id, SUM(h.shares * COALESCE(p.price, h.average_cost)) AS stock_wealth
      FROM stock_holdings h
      LEFT JOIN stock_prices p ON h.ticker = p.ticker
      GROUP BY h.user_id
    ) s ON e.user_id = s.user_id
    LEFT JOIN (
      SELECT user_id, SUM(quantity * COALESCE(item_value, 0)) AS inventory_wealth
      FROM user_inventory
      WHERE item_type IN ('rookie_te', 'rookie_rb', 'rookie_wr', 'rookie_qb', 'wordle_lucky_letter')
      GROUP BY user_id
    ) i ON e.user_id = i.user_id
    WHERE e.user_id = ${userId}
    LIMIT 1
  `;

  const row = result.rows[0];
  if (!row) return null;

  return {
    user_id: row.user_id,
    username: row.username,
    cash_wealth: Number(row.cash_wealth),
    stock_wealth: Number(row.stock_wealth),
    inventory_wealth: Number(row.inventory_wealth),
    total_wealth: Number(row.total_wealth),
  };
}
