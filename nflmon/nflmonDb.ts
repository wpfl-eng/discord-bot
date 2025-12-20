// NFLmon Database Operations
// CRUD operations for the NFLmon collection system

import { sql, db } from '@vercel/postgres';
import * as economyDb from '../economy/economyDb.js';
import {
  getLevelFromXp,
  getEvolutionStage,
  getSellValue,
  TRAINING_CONFIG,
  LEVEL_CONFIG,
} from './nflmonConfig.js';
import type { EvolutionStage } from './nflmonConfig.js';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

/**
 * Individual Values for an NFLmon
 */
export interface IVs {
  readonly speed: number;
  readonly power: number;
  readonly agility: number;
  readonly awareness: number;
  readonly hp: number;
}

/**
 * NFLmon record from nflmon_bench table
 */
export interface Nflmon {
  readonly id: number;
  readonly user_id: string;
  readonly player_id: string;
  readonly nickname: string | null;
  readonly level: number;
  readonly current_xp: number;
  readonly evolution_stage: string;
  readonly rarity: string;
  readonly iv_speed: number;
  readonly iv_power: number;
  readonly iv_agility: number;
  readonly iv_awareness: number;
  readonly iv_hp: number;
  readonly acquired_source: string;
  readonly acquired_from_user: string | null;
  readonly is_favorite: boolean;
  readonly training_slot: number | null;
  readonly variant: string;
  readonly metadata: Record<string, unknown>;
  readonly acquired_at: Date;
}

/**
 * NFLmon stats record from nflmon_stats table
 */
export interface NflmonStats {
  readonly user_id: string;
  readonly username: string | null;
  readonly total_caught: number;
  readonly legendary_count: number;
  readonly highest_level_reached: number;
  readonly total_evolved: number;
  readonly max_training_slots: number;
  readonly starter_claimed: boolean;
  readonly created_at: Date;
}

/**
 * Trade record from nflmon_trades table
 */
export interface NflmonTrade {
  readonly id: number;
  readonly from_user_id: string;
  readonly to_user_id: string;
  readonly from_nflmon_id: number;
  readonly to_nflmon_id: number | null;
  readonly coins_offered: number;
  readonly status: 'pending' | 'completed' | 'cancelled' | 'rejected';
  readonly created_at: Date;
  readonly expires_at: Date;
}

/**
 * Data for adding a new NFLmon
 */
export interface AddNflmonData {
  readonly userId: string;
  readonly playerId: string;
  readonly rarity: string;
  readonly ivs: IVs;
  readonly acquiredSource: string;
  readonly acquiredFromUser?: string | null;
  readonly variant?: string;
  readonly metadata?: Record<string, unknown>;
}

/**
 * Data for creating a trade
 */
export interface CreateTradeData {
  readonly fromUserId: string;
  readonly toUserId: string;
  readonly fromNflmonId: number;
  readonly toNflmonId?: number | null;
  readonly coinsOffered?: number;
}

/**
 * Options for getting bench (collection)
 */
export interface GetBenchOptions {
  readonly rarity?: string;
  readonly page?: number;
  readonly limit?: number;
}

/**
 * Training slot operation errors
 */
export type TrainingSlotError =
  | 'INVALID_SLOT'
  | 'SLOT_OCCUPIED'
  | 'NOT_FOUND'
  | 'ALREADY_TRAINING'
  | 'UPDATE_FAILED';

/**
 * Sell NFLmon operation errors
 */
export type SellNflmonError =
  | 'NOT_FOUND'
  | 'IN_TRAINING'
  | 'IS_FAVORITE'
  | 'DELETE_FAILED'
  | 'WALLET_FAILED';

/**
 * Purchase training slot errors
 */
export type PurchaseSlotError = 'MAX_SLOTS_REACHED' | 'INSUFFICIENT_FUNDS';

/**
 * Accept trade errors
 */
export type AcceptTradeError =
  | 'NOT_FOUND'
  | 'NOT_RECIPIENT'
  | 'NOT_PENDING'
  | 'EXPIRED'
  | 'FROM_NFLMON_UNAVAILABLE'
  | 'FROM_NFLMON_TRAINING'
  | 'TO_NFLMON_UNAVAILABLE'
  | 'TO_NFLMON_TRAINING'
  | 'INSUFFICIENT_COINS'
  | 'TRANSACTION_FAILED';

/**
 * Stat names that can be incremented
 */
export type IncrementableStat = 'total_caught' | 'total_evolved' | 'legendary_count';

/**
 * Leaderboard category names
 */
export type LeaderboardCategory =
  | 'total_caught'
  | 'legendary_count'
  | 'highest_level_reached'
  | 'total_evolved';

/**
 * XP result with level/evolution info
 */
export interface XpResult {
  readonly nflmon: Nflmon;
  readonly xpGained: number;
  readonly levelsGained: number;
  readonly evolved: boolean;
  readonly newStage: EvolutionStage | null;
}

/**
 * Training slot operation success
 */
export interface TrainingSlotSuccess {
  readonly success: true;
  readonly nflmon: Nflmon;
}

/**
 * Training slot operation failure
 */
export interface TrainingSlotFailure {
  readonly success: false;
  readonly error: TrainingSlotError;
}

/**
 * Training slot operation result
 */
export type TrainingSlotResult = TrainingSlotSuccess | TrainingSlotFailure;

/**
 * Sell NFLmon success
 */
export interface SellNflmonSuccess {
  readonly success: true;
  readonly value: number;
  readonly nflmon: Nflmon;
}

/**
 * Sell NFLmon failure
 */
export interface SellNflmonFailure {
  readonly success: false;
  readonly error: SellNflmonError;
}

/**
 * Sell NFLmon result
 */
export type SellNflmonResult = SellNflmonSuccess | SellNflmonFailure;

/**
 * Purchase slot success
 */
export interface PurchaseSlotSuccess {
  readonly success: true;
  readonly newMax: number;
  readonly stats: NflmonStats;
}

/**
 * Purchase slot failure
 */
export interface PurchaseSlotFailure {
  readonly success: false;
  readonly error: PurchaseSlotError;
}

/**
 * Purchase slot result
 */
export type PurchaseSlotResult = PurchaseSlotSuccess | PurchaseSlotFailure;

/**
 * Accept trade success
 */
export interface AcceptTradeSuccess {
  readonly success: true;
  readonly trade: NflmonTrade;
  readonly fromNflmon: Nflmon;
  readonly toNflmon: Nflmon | null;
}

/**
 * Accept trade failure
 */
export interface AcceptTradeFailure {
  readonly success: false;
  readonly error: AcceptTradeError;
}

/**
 * Accept trade result
 */
export type AcceptTradeResult = AcceptTradeSuccess | AcceptTradeFailure;

/**
 * Leaderboard entry
 */
export interface LeaderboardEntry {
  readonly user_id: string;
  readonly username: string | null;
  readonly value: number;
}

/**
 * User rank result
 */
export interface UserRankResult {
  readonly rank: number;
  readonly value: number;
}

// =============================================================================
// BENCH OPERATIONS (NFLmon Collection)
// =============================================================================

/**
 * Get a single NFLmon by ID
 * @param nflmonId - NFLmon ID
 * @returns NFLmon or null
 */
export async function getNflmon(nflmonId: number): Promise<Nflmon | null> {
  const result = await sql<Nflmon>`
    SELECT * FROM nflmon_bench WHERE id = ${nflmonId} LIMIT 1
  `;
  return result.rows[0] ?? null;
}

/**
 * Get NFLmon with ownership verification
 * @param userId - User ID
 * @param nflmonId - NFLmon ID
 * @returns NFLmon or null
 */
export async function getNflmonByUser(
  userId: string,
  nflmonId: number
): Promise<Nflmon | null> {
  const result = await sql<Nflmon>`
    SELECT * FROM nflmon_bench
    WHERE id = ${nflmonId} AND user_id = ${userId}
    LIMIT 1
  `;
  return result.rows[0] ?? null;
}

/**
 * Get user's NFLmon collection with optional filters
 * @param userId - User ID
 * @param options - Query options
 * @returns Array of NFLmon
 */
export async function getBench(
  userId: string,
  options: GetBenchOptions = {}
): Promise<Nflmon[]> {
  const { rarity, page = 1, limit = 10 } = options;
  const offset = (page - 1) * limit;

  if (rarity) {
    const result = await sql<Nflmon>`
      SELECT * FROM nflmon_bench
      WHERE user_id = ${userId} AND rarity = ${rarity}
      ORDER BY level DESC, acquired_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    return result.rows;
  }

  const result = await sql<Nflmon>`
    SELECT * FROM nflmon_bench
    WHERE user_id = ${userId}
    ORDER BY level DESC, acquired_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return result.rows;
}

/**
 * Get count of user's NFLmon collection
 * @param userId - User ID
 * @param rarity - Optional rarity filter
 * @returns Count
 */
export async function getBenchCount(
  userId: string,
  rarity: string | null = null
): Promise<number> {
  if (rarity) {
    const result = await sql<{ count: string }>`
      SELECT COUNT(*) as count FROM nflmon_bench
      WHERE user_id = ${userId} AND rarity = ${rarity}
    `;
    return parseInt(result.rows[0]?.count ?? '0', 10);
  }

  const result = await sql<{ count: string }>`
    SELECT COUNT(*) as count FROM nflmon_bench
    WHERE user_id = ${userId}
  `;
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * Add a new NFLmon to user's bench
 * @param data - NFLmon data
 * @returns Created NFLmon or null
 */
export async function addNflmon(data: AddNflmonData): Promise<Nflmon | null> {
  const {
    userId,
    playerId,
    rarity,
    ivs,
    acquiredSource,
    acquiredFromUser = null,
    variant = 'standard',
    metadata = {},
  } = data;

  const result = await sql<Nflmon>`
    INSERT INTO nflmon_bench (
      user_id, player_id, rarity, evolution_stage,
      iv_speed, iv_power, iv_agility, iv_awareness, iv_hp,
      acquired_source, acquired_from_user, variant, metadata
    ) VALUES (
      ${userId}, ${playerId}, ${rarity}, 'rookie',
      ${ivs.speed}, ${ivs.power}, ${ivs.agility}, ${ivs.awareness}, ${ivs.hp},
      ${acquiredSource}, ${acquiredFromUser}, ${variant}, ${JSON.stringify(metadata)}
    )
    RETURNING *
  `;

  const nflmon = result.rows[0];

  if (nflmon) {
    // Update stats
    await incrementStat(userId, 'total_caught', 1);
    if (rarity === 'legendary') {
      await incrementStat(userId, 'legendary_count', 1);
    }
  }

  return nflmon ?? null;
}

// =============================================================================
// TRAINING OPERATIONS
// =============================================================================

/**
 * Get all NFLmon currently in training for a user
 * @param userId - User ID
 * @returns Array of training NFLmon
 */
export async function getTrainingNflmon(userId: string): Promise<Nflmon[]> {
  const result = await sql<Nflmon>`
    SELECT * FROM nflmon_bench
    WHERE user_id = ${userId} AND training_slot IS NOT NULL
    ORDER BY training_slot ASC
  `;
  return result.rows;
}

/**
 * Assign NFLmon to a training slot
 * @param userId - User ID
 * @param nflmonId - NFLmon ID
 * @param slot - Slot number (1-5)
 * @returns Training slot result
 */
export async function setTrainingSlot(
  userId: string,
  nflmonId: number,
  slot: number
): Promise<TrainingSlotResult> {
  // Validate slot is within user's available slots
  const stats = await getOrCreateStats(userId);
  if (slot < 1 || slot > stats.max_training_slots) {
    return { success: false, error: 'INVALID_SLOT' };
  }

  // Check if slot is already occupied
  const existing = await sql`
    SELECT id FROM nflmon_bench
    WHERE user_id = ${userId} AND training_slot = ${slot}
    LIMIT 1
  `;
  if (existing.rows.length > 0) {
    return { success: false, error: 'SLOT_OCCUPIED' };
  }

  // Check if NFLmon is already in training
  const nflmon = await getNflmonByUser(userId, nflmonId);
  if (!nflmon) {
    return { success: false, error: 'NOT_FOUND' };
  }
  if (nflmon.training_slot !== null) {
    return { success: false, error: 'ALREADY_TRAINING' };
  }

  // Assign slot (atomic with ownership check)
  const result = await sql<Nflmon>`
    UPDATE nflmon_bench
    SET training_slot = ${slot}
    WHERE id = ${nflmonId} AND user_id = ${userId}
    RETURNING *
  `;

  if (!result.rows[0]) {
    return { success: false, error: 'UPDATE_FAILED' };
  }

  return { success: true, nflmon: result.rows[0] };
}

/**
 * Remove NFLmon from training
 * @param userId - User ID
 * @param nflmonId - NFLmon ID
 * @returns Updated NFLmon or null
 */
export async function removeFromTraining(
  userId: string,
  nflmonId: number
): Promise<Nflmon | null> {
  const result = await sql<Nflmon>`
    UPDATE nflmon_bench
    SET training_slot = NULL
    WHERE id = ${nflmonId} AND user_id = ${userId}
    RETURNING *
  `;
  return result.rows[0] ?? null;
}

// =============================================================================
// XP & LEVELING OPERATIONS
// =============================================================================

/**
 * Add XP to an NFLmon and handle level-ups/evolution
 * @param nflmonId - NFLmon ID
 * @param amount - XP amount to add
 * @returns XP result or null
 */
export async function addXp(nflmonId: number, amount: number): Promise<XpResult | null> {
  if (amount <= 0) return null;

  // Get current state
  const nflmon = await getNflmon(nflmonId);
  if (!nflmon) return null;

  // Don't add XP if already at max level
  if (nflmon.level >= LEVEL_CONFIG.MAX_LEVEL) {
    return {
      nflmon,
      xpGained: 0,
      levelsGained: 0,
      evolved: false,
      newStage: null,
    };
  }

  const oldLevel = nflmon.level;
  const newXp = nflmon.current_xp + amount;
  const newLevel = Math.min(getLevelFromXp(newXp), LEVEL_CONFIG.MAX_LEVEL);
  const levelsGained = newLevel - oldLevel;

  // Check for evolution
  const newStage = getEvolutionStage(newLevel, nflmon.rarity);
  const evolved = newStage.id !== nflmon.evolution_stage;

  // Update NFLmon
  const result = await sql<Nflmon>`
    UPDATE nflmon_bench
    SET current_xp = ${newXp},
        level = ${newLevel},
        evolution_stage = ${newStage.id}
    WHERE id = ${nflmonId}
    RETURNING *
  `;

  // Update highest level stat if applicable
  if (newLevel > oldLevel) {
    await updateHighestLevel(nflmon.user_id, newLevel);
  }

  // Update evolved count if evolved
  if (evolved) {
    await incrementStat(nflmon.user_id, 'total_evolved', 1);
  }

  return {
    nflmon: result.rows[0],
    xpGained: amount,
    levelsGained,
    evolved,
    newStage: evolved ? newStage : null,
  };
}

/**
 * Add XP to all NFLmon in training for a user
 * @param userId - User ID
 * @param amount - XP amount to add to each
 * @returns Array of XP results
 */
export async function addXpToAllTraining(
  userId: string,
  amount: number
): Promise<XpResult[]> {
  const trainingNflmon = await getTrainingNflmon(userId);
  const results: XpResult[] = [];

  for (const nflmon of trainingNflmon) {
    const result = await addXp(nflmon.id, amount);
    if (result) {
      results.push(result);
    }
  }

  return results;
}

// =============================================================================
// SELL OPERATIONS
// =============================================================================

/**
 * Sell an NFLmon for coins
 * @param userId - User ID
 * @param nflmonId - NFLmon ID
 * @returns Sell result
 */
export async function sellNflmon(
  userId: string,
  nflmonId: number
): Promise<SellNflmonResult> {
  // Step 1: Get NFLmon with ownership check
  const nflmon = await getNflmonByUser(userId, nflmonId);
  if (!nflmon) {
    return { success: false, error: 'NOT_FOUND' };
  }

  // Step 2: Validate not in training
  if (nflmon.training_slot !== null) {
    return { success: false, error: 'IN_TRAINING' };
  }

  // Step 3: Validate not a favorite (optional safety)
  if (nflmon.is_favorite) {
    return { success: false, error: 'IS_FAVORITE' };
  }

  // Step 4: Calculate sell value
  const sellValue = getSellValue(nflmon.rarity);

  // Step 5: Delete NFLmon (atomic)
  const deleteResult = await sql<Nflmon>`
    DELETE FROM nflmon_bench
    WHERE id = ${nflmonId} AND user_id = ${userId}
    RETURNING *
  `;

  if (!deleteResult.rows[0]) {
    return { success: false, error: 'DELETE_FAILED' };
  }

  // Step 6: Add coins to wallet
  const walletResult = await economyDb.addToWallet(userId, sellValue);
  if (!walletResult) {
    // ROLLBACK: Re-add the NFLmon
    await sql`
      INSERT INTO nflmon_bench (
        user_id, player_id, nickname, level, current_xp,
        evolution_stage, rarity, iv_speed, iv_power, iv_agility,
        iv_awareness, iv_hp, acquired_source, acquired_from_user,
        is_favorite, training_slot, variant, metadata, acquired_at
      ) VALUES (
        ${nflmon.user_id}, ${nflmon.player_id},
        ${nflmon.nickname}, ${nflmon.level}, ${nflmon.current_xp},
        ${nflmon.evolution_stage}, ${nflmon.rarity}, ${nflmon.iv_speed},
        ${nflmon.iv_power}, ${nflmon.iv_agility}, ${nflmon.iv_awareness},
        ${nflmon.iv_hp}, ${nflmon.acquired_source}, ${nflmon.acquired_from_user},
        ${nflmon.is_favorite}, ${nflmon.training_slot}, ${nflmon.variant},
        ${JSON.stringify(nflmon.metadata)}, ${nflmon.acquired_at instanceof Date ? nflmon.acquired_at.toISOString() : nflmon.acquired_at}
      )
    `;
    console.error(`Rolled back sell: wallet update failed for user ${userId}`);
    return { success: false, error: 'WALLET_FAILED' };
  }

  return { success: true, value: sellValue, nflmon };
}

// =============================================================================
// STATS OPERATIONS
// =============================================================================

/**
 * Get or create user stats record
 * @param userId - User ID
 * @param username - Username to update
 * @returns User stats
 */
export async function getOrCreateStats(
  userId: string,
  username: string | null = null
): Promise<NflmonStats> {
  const result = await sql<NflmonStats>`
    INSERT INTO nflmon_stats (user_id, username)
    VALUES (${userId}, ${username})
    ON CONFLICT (user_id) DO UPDATE SET
      username = COALESCE(${username}, nflmon_stats.username)
    RETURNING *
  `;
  return result.rows[0];
}

/**
 * Increment a stat for a user
 * @param userId - User ID
 * @param stat - Stat name (total_caught, total_evolved, legendary_count)
 * @param amount - Amount to increment
 * @returns Updated stats or null
 */
export async function incrementStat(
  userId: string,
  stat: IncrementableStat,
  amount: number = 1
): Promise<NflmonStats | null> {
  // Ensure user exists
  await getOrCreateStats(userId);

  // Whitelist allowed stats to prevent SQL injection
  const allowedStats: readonly IncrementableStat[] = ['total_caught', 'total_evolved', 'legendary_count'];
  if (!allowedStats.includes(stat)) {
    throw new Error(`Invalid stat: ${stat}`);
  }

  const result = await sql.query<NflmonStats>(
    `UPDATE nflmon_stats SET ${stat} = ${stat} + $1 WHERE user_id = $2 RETURNING *`,
    [amount, userId]
  );
  return result.rows[0] ?? null;
}

/**
 * Update highest level reached for a user
 * @param userId - User ID
 * @param level - New level to compare
 * @returns Updated stats or null
 */
export async function updateHighestLevel(
  userId: string,
  level: number
): Promise<NflmonStats | null> {
  // Ensure user exists
  await getOrCreateStats(userId);

  const result = await sql<NflmonStats>`
    UPDATE nflmon_stats
    SET highest_level_reached = GREATEST(highest_level_reached, ${level})
    WHERE user_id = ${userId}
    RETURNING *
  `;
  return result.rows[0] ?? null;
}

/**
 * Purchase an additional training slot
 * @param userId - User ID
 * @param cost - Cost in coins
 * @returns Purchase result
 */
export async function purchaseTrainingSlot(
  userId: string,
  cost: number
): Promise<PurchaseSlotResult> {
  const stats = await getOrCreateStats(userId);

  // Check max slots
  if (stats.max_training_slots >= TRAINING_CONFIG.MAX_SLOTS) {
    return { success: false, error: 'MAX_SLOTS_REACHED' };
  }

  // Deduct cost from wallet (atomic - fails if insufficient funds)
  const walletResult = await economyDb.deductFromWallet(userId, cost);
  if (!walletResult) {
    return { success: false, error: 'INSUFFICIENT_FUNDS' };
  }

  // Increment max_training_slots
  const result = await sql<NflmonStats>`
    UPDATE nflmon_stats
    SET max_training_slots = max_training_slots + 1
    WHERE user_id = ${userId}
    RETURNING *
  `;

  return {
    success: true,
    newMax: result.rows[0].max_training_slots,
    stats: result.rows[0],
  };
}

// =============================================================================
// NICKNAME & FAVORITE OPERATIONS
// =============================================================================

/**
 * Set or clear nickname for an NFLmon
 * @param userId - User ID
 * @param nflmonId - NFLmon ID
 * @param nickname - Nickname (null to clear)
 * @returns Updated NFLmon or null
 */
export async function setNickname(
  userId: string,
  nflmonId: number,
  nickname: string | null
): Promise<Nflmon | null> {
  const result = await sql<Nflmon>`
    UPDATE nflmon_bench
    SET nickname = ${nickname ?? null}
    WHERE id = ${nflmonId} AND user_id = ${userId}
    RETURNING *
  `;
  return result.rows[0] ?? null;
}

/**
 * Toggle favorite status for an NFLmon
 * @param userId - User ID
 * @param nflmonId - NFLmon ID
 * @returns Updated NFLmon or null
 */
export async function toggleFavorite(
  userId: string,
  nflmonId: number
): Promise<Nflmon | null> {
  const result = await sql<Nflmon>`
    UPDATE nflmon_bench
    SET is_favorite = NOT is_favorite
    WHERE id = ${nflmonId} AND user_id = ${userId}
    RETURNING *
  `;
  return result.rows[0] ?? null;
}

// =============================================================================
// TRADE OPERATIONS (Phase 6 prep)
// =============================================================================

/**
 * Create a new trade offer
 * @param data - Trade data
 * @returns Created trade
 */
export async function createTrade(data: CreateTradeData): Promise<NflmonTrade> {
  const { fromUserId, toUserId, fromNflmonId, toNflmonId = null, coinsOffered = 0 } = data;

  const result = await sql<NflmonTrade>`
    INSERT INTO nflmon_trades (
      from_user_id, to_user_id, from_nflmon_id, to_nflmon_id, coins_offered
    ) VALUES (
      ${fromUserId}, ${toUserId}, ${fromNflmonId}, ${toNflmonId}, ${coinsOffered}
    )
    RETURNING *
  `;
  return result.rows[0];
}

/**
 * Get pending trades for a user (both sent and received)
 * @param userId - User ID
 * @returns Array of pending trades
 */
export async function getPendingTrades(userId: string): Promise<NflmonTrade[]> {
  const result = await sql<NflmonTrade>`
    SELECT * FROM nflmon_trades
    WHERE (to_user_id = ${userId} OR from_user_id = ${userId})
      AND status = 'pending'
      AND expires_at > NOW()
    ORDER BY created_at DESC
  `;
  return result.rows;
}

/**
 * Get a single trade by ID
 * @param tradeId - Trade ID
 * @returns Trade or null
 */
export async function getTrade(tradeId: number): Promise<NflmonTrade | null> {
  const result = await sql<NflmonTrade>`
    SELECT * FROM nflmon_trades WHERE id = ${tradeId} LIMIT 1
  `;
  return result.rows[0] ?? null;
}

/**
 * Cancel a trade (only by sender)
 * @param userId - User ID (must be sender)
 * @param tradeId - Trade ID
 * @returns Cancelled trade or null
 */
export async function cancelTrade(
  userId: string,
  tradeId: number
): Promise<NflmonTrade | null> {
  const result = await sql<NflmonTrade>`
    UPDATE nflmon_trades
    SET status = 'cancelled'
    WHERE id = ${tradeId} AND from_user_id = ${userId} AND status = 'pending'
    RETURNING *
  `;
  return result.rows[0] ?? null;
}

/**
 * Reject a trade (only by recipient)
 * @param userId - User ID (must be recipient)
 * @param tradeId - Trade ID
 * @returns Rejected trade or null
 */
export async function rejectTrade(
  userId: string,
  tradeId: number
): Promise<NflmonTrade | null> {
  const result = await sql<NflmonTrade>`
    UPDATE nflmon_trades
    SET status = 'rejected'
    WHERE id = ${tradeId} AND to_user_id = ${userId} AND status = 'pending'
    RETURNING *
  `;
  return result.rows[0] ?? null;
}

/**
 * Accept a trade (recipient only) - atomic ownership transfer with transaction safety
 * @param userId - Recipient user ID
 * @param tradeId - Trade ID
 * @returns Accept trade result
 */
export async function acceptTrade(
  userId: string,
  tradeId: number
): Promise<AcceptTradeResult> {
  // Get a dedicated client for transaction
  const client = await db.connect();

  try {
    // Start transaction
    await client.sql`BEGIN`;

    // 1. Fetch and validate trade with row-level lock
    const tradeResult = await client.sql<NflmonTrade>`
      SELECT * FROM nflmon_trades
      WHERE id = ${tradeId}
      FOR UPDATE
    `;
    const trade = tradeResult.rows[0];
    if (!trade) {
      await client.sql`ROLLBACK`;
      return { success: false, error: 'NOT_FOUND' };
    }
    if (trade.to_user_id !== userId) {
      await client.sql`ROLLBACK`;
      return { success: false, error: 'NOT_RECIPIENT' };
    }
    if (trade.status !== 'pending') {
      await client.sql`ROLLBACK`;
      return { success: false, error: 'NOT_PENDING' };
    }
    if (new Date() > new Date(trade.expires_at)) {
      await client.sql`ROLLBACK`;
      return { success: false, error: 'EXPIRED' };
    }

    // 2. Validate from_nflmon with lock
    const fromResult = await client.sql<Nflmon>`
      SELECT * FROM nflmon_bench
      WHERE id = ${trade.from_nflmon_id} AND user_id = ${trade.from_user_id}
      FOR UPDATE
    `;
    const fromNflmon = fromResult.rows[0];
    if (!fromNflmon) {
      await client.sql`ROLLBACK`;
      return { success: false, error: 'FROM_NFLMON_UNAVAILABLE' };
    }
    if (fromNflmon.training_slot !== null) {
      await client.sql`ROLLBACK`;
      return { success: false, error: 'FROM_NFLMON_TRAINING' };
    }

    // 3. Validate to_nflmon if 1:1 trade (with lock)
    let toNflmon: Nflmon | null = null;
    if (trade.to_nflmon_id) {
      const toResult = await client.sql<Nflmon>`
        SELECT * FROM nflmon_bench
        WHERE id = ${trade.to_nflmon_id} AND user_id = ${trade.to_user_id}
        FOR UPDATE
      `;
      toNflmon = toResult.rows[0] ?? null;
      if (!toNflmon) {
        await client.sql`ROLLBACK`;
        return { success: false, error: 'TO_NFLMON_UNAVAILABLE' };
      }
      if (toNflmon.training_slot !== null) {
        await client.sql`ROLLBACK`;
        return { success: false, error: 'TO_NFLMON_TRAINING' };
      }
    }

    // 4. Validate coins if offered (with lock on sender's economy record)
    if (trade.coins_offered > 0) {
      const senderResult = await client.sql<{ wallet: number }>`
        SELECT * FROM economy_users
        WHERE user_id = ${trade.from_user_id}
        FOR UPDATE
      `;
      const sender = senderResult.rows[0];
      if (!sender || sender.wallet < trade.coins_offered) {
        await client.sql`ROLLBACK`;
        return { success: false, error: 'INSUFFICIENT_COINS' };
      }
    }

    // 5. Execute transfers (all within transaction)
    // Transfer from_nflmon to recipient
    await client.sql`
      UPDATE nflmon_bench
      SET user_id = ${trade.to_user_id},
          acquired_source = 'trade',
          acquired_from_user = ${trade.from_user_id}
      WHERE id = ${trade.from_nflmon_id}
    `;

    // Transfer to_nflmon to sender (if 1:1 trade)
    if (trade.to_nflmon_id) {
      await client.sql`
        UPDATE nflmon_bench
        SET user_id = ${trade.from_user_id},
            acquired_source = 'trade',
            acquired_from_user = ${trade.to_user_id}
        WHERE id = ${trade.to_nflmon_id}
      `;
    }

    // Transfer coins if offered (direct SQL within transaction)
    if (trade.coins_offered > 0) {
      await client.sql`
        UPDATE economy_users
        SET wallet = wallet - ${trade.coins_offered}
        WHERE user_id = ${trade.from_user_id}
      `;
      await client.sql`
        UPDATE economy_users
        SET wallet = wallet + ${trade.coins_offered}
        WHERE user_id = ${trade.to_user_id}
      `;
    }

    // 6. Mark trade completed
    const completedResult = await client.sql<NflmonTrade>`
      UPDATE nflmon_trades
      SET status = 'completed'
      WHERE id = ${tradeId}
      RETURNING *
    `;

    // Commit transaction
    await client.sql`COMMIT`;

    return {
      success: true,
      trade: completedResult.rows[0],
      fromNflmon,
      toNflmon,
    };
  } catch (error) {
    // Rollback on any error
    await client.sql`ROLLBACK`;
    console.error('[NFLMON] acceptTrade transaction failed:', error);
    return { success: false, error: 'TRANSACTION_FAILED' };
  } finally {
    // Always release the client back to the pool
    client.release();
  }
}

// =============================================================================
// LEADERBOARD OPERATIONS
// =============================================================================

/**
 * Get leaderboard for a specific category
 * @param category - Category to rank by
 * @param limit - Number of entries to return
 * @returns Leaderboard entries
 */
export async function getLeaderboard(
  category: LeaderboardCategory = 'total_caught',
  limit: number = 10
): Promise<LeaderboardEntry[]> {
  // Whitelist allowed categories
  const allowedCategories: readonly LeaderboardCategory[] = [
    'total_caught',
    'legendary_count',
    'highest_level_reached',
    'total_evolved',
  ];
  const safeCategory = allowedCategories.includes(category) ? category : 'total_caught';

  const result = await sql.query<LeaderboardEntry>(
    `SELECT user_id, username, ${safeCategory} as value
     FROM nflmon_stats
     WHERE ${safeCategory} > 0
     ORDER BY ${safeCategory} DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

/**
 * Get a user's rank in a specific category
 * @param userId - User ID
 * @param category - Category to rank by
 * @returns User rank or null
 */
export async function getUserRank(
  userId: string,
  category: LeaderboardCategory = 'total_caught'
): Promise<UserRankResult | null> {
  const allowedCategories: readonly LeaderboardCategory[] = [
    'total_caught',
    'legendary_count',
    'highest_level_reached',
    'total_evolved',
  ];
  const safeCategory = allowedCategories.includes(category) ? category : 'total_caught';

  const result = await sql.query<{ value: string; rank: string }>(
    `SELECT
       ${safeCategory} as value,
       (SELECT COUNT(*) + 1 FROM nflmon_stats WHERE ${safeCategory} > s.${safeCategory}) as rank
     FROM nflmon_stats s
     WHERE user_id = $1`,
    [userId]
  );

  if (!result.rows[0]) return null;
  return {
    rank: parseInt(result.rows[0].rank, 10),
    value: parseInt(result.rows[0].value, 10),
  };
}

// =============================================================================
// STARTER OPERATIONS
// =============================================================================

/**
 * Check if user has already claimed their starter NFLmon
 * @param userId - User ID
 * @returns True if already claimed
 */
export async function hasClaimedStarter(userId: string): Promise<boolean> {
  const stats = await getOrCreateStats(userId);
  return stats.starter_claimed === true;
}

/**
 * Mark user as having claimed their starter NFLmon
 * @param userId - User ID
 * @returns Updated stats or null
 */
export async function markStarterClaimed(userId: string): Promise<NflmonStats | null> {
  const result = await sql<NflmonStats>`
    UPDATE nflmon_stats
    SET starter_claimed = TRUE
    WHERE user_id = ${userId}
    RETURNING *
  `;
  return result.rows[0] ?? null;
}

// =============================================================================
// EVOLUTION OPERATIONS
// =============================================================================

/**
 * Evolve an NFLmon to a new stage
 * @param userId - User ID for ownership check
 * @param nflmonId - NFLmon ID
 * @param newStageId - New evolution stage ID
 * @returns Updated NFLmon or null
 */
export async function evolveNflmon(
  userId: string,
  nflmonId: number,
  newStageId: string
): Promise<Nflmon | null> {
  const result = await sql<Nflmon>`
    UPDATE nflmon_bench
    SET evolution_stage = ${newStageId}
    WHERE id = ${nflmonId} AND user_id = ${userId}
    RETURNING *
  `;

  if (result.rows[0]) {
    await incrementStat(userId, 'total_evolved', 1);
  }

  return result.rows[0] ?? null;
}
