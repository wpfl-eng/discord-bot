// Shared Database Types
// Types used across multiple database modules

// ============ Economy System ============

/**
 * Economy user record from economy_users table
 * Used by: economyDb, stockDb, inventoryDb, nflmonDb
 */
export interface EconomyUser {
  readonly user_id: string;
  readonly username: string;
  readonly wallet: number;
  readonly bank: number;
  readonly bank_capacity: number;
  readonly total_earned: number;
  readonly total_lost: number;
  readonly last_daily: Date | null;
  readonly last_work: Date | null;
  readonly last_rob: Date | null;
  readonly last_robbed_at: Date | null;
  readonly last_robbed_by: string | null;
  readonly has_padlock: boolean;
  readonly daily_streak: number;
  readonly created_at: Date;
}

/**
 * Result of transferring between two users
 */
export interface TransferResult {
  readonly from: EconomyUser | null;
  readonly to: EconomyUser | null;
}

/**
 * Economy leaderboard entry
 */
export interface EconomyLeaderboardEntry {
  readonly user_id: string;
  readonly username: string;
  readonly wallet: number;
  readonly bank: number;
  readonly total_wealth: number;
  readonly total_earned: number;
  readonly total_lost: number;
}

/**
 * Total wealth leaderboard entry including stocks and inventory
 */
export interface TotalWealthEntry {
  readonly user_id: string;
  readonly username: string;
  readonly cash_wealth: number;
  readonly stock_wealth: number;
  readonly inventory_wealth: number;
  readonly total_wealth: number;
}

// ============ Inventory System ============

/**
 * Inventory item record from user_inventory table
 */
export interface InventoryItem {
  readonly user_id: string;
  readonly item_type: string;
  readonly quantity: number;
  readonly item_value: number | null;
  readonly acquired_at: Date;
}

// ============ Stock System ============

/**
 * Stock holding record from stock_holdings table
 */
export interface StockHolding {
  readonly user_id: string;
  readonly ticker: string;
  readonly shares: number;
  readonly average_cost: number;
  readonly first_purchased_at: Date;
  readonly last_updated_at: Date;
}

// ============ Betting System ============

/**
 * Bet record from Bets table
 * Used by: betcreate, betlist commands
 */
export interface Bet {
  readonly id: number;
  readonly bettorone: string;
  readonly bettortwo: string;
  readonly description: string;
  readonly amount: number;
  readonly created_at?: Date;
}

// ============ Utility Types ============

/**
 * Generic success/failure result pattern
 * Used for operations that can fail with specific error codes
 */
export type OperationResult<TSuccess, TError extends string> =
  | ({ success: true } & TSuccess)
  | { success: false; error: TError };
