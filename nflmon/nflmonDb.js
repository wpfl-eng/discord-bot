// NFLmon Database Operations
// CRUD operations for the NFLmon collection system

import { sql, db } from "@vercel/postgres";
import * as economyDb from "../economy/economyDb.js";
import {
  getLevelFromXp,
  getEvolutionStage,
  getSellValue,
  TRAINING_CONFIG,
  LEVEL_CONFIG,
} from "./nflmonConfig.js";

// =============================================================================
// BENCH OPERATIONS (NFLmon Collection)
// =============================================================================

/**
 * Get a single NFLmon by ID
 * @param {number} nflmonId - NFLmon ID
 * @returns {Promise<object|null>} NFLmon or null
 */
export async function getNflmon(nflmonId) {
  const result = await sql`
    SELECT * FROM nflmon_bench WHERE id = ${nflmonId} LIMIT 1
  `;
  return result.rows[0] || null;
}

/**
 * Get NFLmon with ownership verification
 * @param {string} userId - User ID
 * @param {number} nflmonId - NFLmon ID
 * @returns {Promise<object|null>} NFLmon or null
 */
export async function getNflmonByUser(userId, nflmonId) {
  const result = await sql`
    SELECT * FROM nflmon_bench
    WHERE id = ${nflmonId} AND user_id = ${userId}
    LIMIT 1
  `;
  return result.rows[0] || null;
}

/**
 * Get user's NFLmon collection with optional filters
 * @param {string} userId - User ID
 * @param {object} options - Query options
 * @param {string} [options.rarity] - Filter by rarity
 * @param {number} [options.page=1] - Page number
 * @param {number} [options.limit=10] - Items per page
 * @returns {Promise<object[]>} Array of NFLmon
 */
export async function getBench(userId, options = {}) {
  const { rarity, page = 1, limit = 10 } = options;
  const offset = (page - 1) * limit;

  if (rarity) {
    const result = await sql`
      SELECT * FROM nflmon_bench
      WHERE user_id = ${userId} AND rarity = ${rarity}
      ORDER BY level DESC, acquired_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    return result.rows;
  }

  const result = await sql`
    SELECT * FROM nflmon_bench
    WHERE user_id = ${userId}
    ORDER BY level DESC, acquired_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `;
  return result.rows;
}

/**
 * Get count of user's NFLmon collection
 * @param {string} userId - User ID
 * @param {string} [rarity] - Optional rarity filter
 * @returns {Promise<number>} Count
 */
export async function getBenchCount(userId, rarity = null) {
  if (rarity) {
    const result = await sql`
      SELECT COUNT(*) as count FROM nflmon_bench
      WHERE user_id = ${userId} AND rarity = ${rarity}
    `;
    return parseInt(result.rows[0]?.count || 0);
  }

  const result = await sql`
    SELECT COUNT(*) as count FROM nflmon_bench
    WHERE user_id = ${userId}
  `;
  return parseInt(result.rows[0]?.count || 0);
}

/**
 * Add a new NFLmon to user's bench
 * @param {object} data - NFLmon data
 * @param {string} data.userId - User ID
 * @param {string} data.playerId - Player ID from nflmonPlayers.json
 * @param {string} data.rarity - Rarity level
 * @param {object} data.ivs - Individual Values
 * @param {string} data.acquiredSource - How it was acquired
 * @param {string} [data.acquiredFromUser] - User ID if from trade
 * @param {string} [data.variant='standard'] - Variant type
 * @param {object} [data.metadata={}] - Additional metadata
 * @returns {Promise<object|null>} Created NFLmon
 */
export async function addNflmon(data) {
  const {
    userId,
    playerId,
    rarity,
    ivs,
    acquiredSource,
    acquiredFromUser = null,
    variant = "standard",
    metadata = {},
  } = data;

  const result = await sql`
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
    await incrementStat(userId, "total_caught", 1);
    if (rarity === "legendary") {
      await incrementStat(userId, "legendary_count", 1);
    }
  }

  return nflmon || null;
}

// =============================================================================
// TRAINING OPERATIONS
// =============================================================================

/**
 * Get all NFLmon currently in training for a user
 * @param {string} userId - User ID
 * @returns {Promise<object[]>} Array of training NFLmon
 */
export async function getTrainingNflmon(userId) {
  const result = await sql`
    SELECT * FROM nflmon_bench
    WHERE user_id = ${userId} AND training_slot IS NOT NULL
    ORDER BY training_slot ASC
  `;
  return result.rows;
}

/**
 * Assign NFLmon to a training slot
 * @param {string} userId - User ID
 * @param {number} nflmonId - NFLmon ID
 * @param {number} slot - Slot number (1-5)
 * @returns {Promise<{success: boolean, nflmon?: object, error?: string}>}
 */
export async function setTrainingSlot(userId, nflmonId, slot) {
  // Validate slot is within user's available slots
  const stats = await getOrCreateStats(userId);
  if (slot < 1 || slot > stats.max_training_slots) {
    return { success: false, error: "INVALID_SLOT" };
  }

  // Check if slot is already occupied
  const existing = await sql`
    SELECT id FROM nflmon_bench
    WHERE user_id = ${userId} AND training_slot = ${slot}
    LIMIT 1
  `;
  if (existing.rows.length > 0) {
    return { success: false, error: "SLOT_OCCUPIED" };
  }

  // Check if NFLmon is already in training
  const nflmon = await getNflmonByUser(userId, nflmonId);
  if (!nflmon) {
    return { success: false, error: "NOT_FOUND" };
  }
  if (nflmon.training_slot !== null) {
    return { success: false, error: "ALREADY_TRAINING" };
  }

  // Assign slot (atomic with ownership check)
  const result = await sql`
    UPDATE nflmon_bench
    SET training_slot = ${slot}
    WHERE id = ${nflmonId} AND user_id = ${userId}
    RETURNING *
  `;

  if (!result.rows[0]) {
    return { success: false, error: "UPDATE_FAILED" };
  }

  return { success: true, nflmon: result.rows[0] };
}

/**
 * Remove NFLmon from training
 * @param {string} userId - User ID
 * @param {number} nflmonId - NFLmon ID
 * @returns {Promise<object|null>} Updated NFLmon or null
 */
export async function removeFromTraining(userId, nflmonId) {
  const result = await sql`
    UPDATE nflmon_bench
    SET training_slot = NULL
    WHERE id = ${nflmonId} AND user_id = ${userId}
    RETURNING *
  `;
  return result.rows[0] || null;
}

// =============================================================================
// XP & LEVELING OPERATIONS
// =============================================================================

/**
 * Add XP to an NFLmon and handle level-ups/evolution
 * @param {number} nflmonId - NFLmon ID
 * @param {number} amount - XP amount to add
 * @returns {Promise<{nflmon: object, xpGained: number, levelsGained: number, evolved: boolean, newStage?: object}|null>}
 */
export async function addXp(nflmonId, amount) {
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
  const result = await sql`
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
    await incrementStat(nflmon.user_id, "total_evolved", 1);
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
 * @param {string} userId - User ID
 * @param {number} amount - XP amount to add to each
 * @returns {Promise<Array<{nflmon: object, xpGained: number, levelsGained: number, evolved: boolean, newStage?: object}>>}
 */
export async function addXpToAllTraining(userId, amount) {
  const trainingNflmon = await getTrainingNflmon(userId);
  const results = [];

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
 * @param {string} userId - User ID
 * @param {number} nflmonId - NFLmon ID
 * @returns {Promise<{success: boolean, value?: number, nflmon?: object, error?: string}>}
 */
export async function sellNflmon(userId, nflmonId) {
  // Step 1: Get NFLmon with ownership check
  const nflmon = await getNflmonByUser(userId, nflmonId);
  if (!nflmon) {
    return { success: false, error: "NOT_FOUND" };
  }

  // Step 2: Validate not in training
  if (nflmon.training_slot !== null) {
    return { success: false, error: "IN_TRAINING" };
  }

  // Step 3: Validate not a favorite (optional safety)
  if (nflmon.is_favorite) {
    return { success: false, error: "IS_FAVORITE" };
  }

  // Step 4: Calculate sell value
  const sellValue = getSellValue(nflmon.rarity);

  // Step 5: Delete NFLmon (atomic)
  const deleteResult = await sql`
    DELETE FROM nflmon_bench
    WHERE id = ${nflmonId} AND user_id = ${userId}
    RETURNING *
  `;

  if (!deleteResult.rows[0]) {
    return { success: false, error: "DELETE_FAILED" };
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
        ${JSON.stringify(nflmon.metadata)}, ${nflmon.acquired_at}
      )
    `;
    console.error(`Rolled back sell: wallet update failed for user ${userId}`);
    return { success: false, error: "WALLET_FAILED" };
  }

  return { success: true, value: sellValue, nflmon };
}

// =============================================================================
// STATS OPERATIONS
// =============================================================================

/**
 * Get or create user stats record
 * @param {string} userId - User ID
 * @param {string} [username] - Username to update
 * @returns {Promise<object>} User stats
 */
export async function getOrCreateStats(userId, username = null) {
  const result = await sql`
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
 * @param {string} userId - User ID
 * @param {string} stat - Stat name (total_caught, total_evolved, legendary_count)
 * @param {number} [amount=1] - Amount to increment
 * @returns {Promise<object|null>} Updated stats
 */
export async function incrementStat(userId, stat, amount = 1) {
  // Ensure user exists
  await getOrCreateStats(userId);

  // Whitelist allowed stats to prevent SQL injection
  const allowedStats = ["total_caught", "total_evolved", "legendary_count"];
  if (!allowedStats.includes(stat)) {
    throw new Error(`Invalid stat: ${stat}`);
  }

  const result = await sql.query(
    `UPDATE nflmon_stats SET ${stat} = ${stat} + $1 WHERE user_id = $2 RETURNING *`,
    [amount, userId]
  );
  return result.rows[0] || null;
}

/**
 * Update highest level reached for a user
 * @param {string} userId - User ID
 * @param {number} level - New level to compare
 * @returns {Promise<object|null>} Updated stats
 */
export async function updateHighestLevel(userId, level) {
  // Ensure user exists
  await getOrCreateStats(userId);

  const result = await sql`
    UPDATE nflmon_stats
    SET highest_level_reached = GREATEST(highest_level_reached, ${level})
    WHERE user_id = ${userId}
    RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * Purchase an additional training slot
 * @param {string} userId - User ID
 * @param {number} cost - Cost in coins
 * @returns {Promise<{success: boolean, newMax?: number, stats?: object, error?: string}>}
 */
export async function purchaseTrainingSlot(userId, cost) {
  const stats = await getOrCreateStats(userId);

  // Check max slots
  if (stats.max_training_slots >= TRAINING_CONFIG.MAX_SLOTS) {
    return { success: false, error: "MAX_SLOTS_REACHED" };
  }

  // Deduct cost from wallet (atomic - fails if insufficient funds)
  const walletResult = await economyDb.deductFromWallet(userId, cost);
  if (!walletResult) {
    return { success: false, error: "INSUFFICIENT_FUNDS" };
  }

  // Increment max_training_slots
  const result = await sql`
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
 * @param {string} userId - User ID
 * @param {number} nflmonId - NFLmon ID
 * @param {string|null} nickname - Nickname (null to clear)
 * @returns {Promise<object|null>} Updated NFLmon or null
 */
export async function setNickname(userId, nflmonId, nickname) {
  const result = await sql`
    UPDATE nflmon_bench
    SET nickname = ${nickname || null}
    WHERE id = ${nflmonId} AND user_id = ${userId}
    RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * Toggle favorite status for an NFLmon
 * @param {string} userId - User ID
 * @param {number} nflmonId - NFLmon ID
 * @returns {Promise<object|null>} Updated NFLmon or null
 */
export async function toggleFavorite(userId, nflmonId) {
  const result = await sql`
    UPDATE nflmon_bench
    SET is_favorite = NOT is_favorite
    WHERE id = ${nflmonId} AND user_id = ${userId}
    RETURNING *
  `;
  return result.rows[0] || null;
}

// =============================================================================
// TRADE OPERATIONS (Phase 6 prep)
// =============================================================================

/**
 * Create a new trade offer
 * @param {object} data - Trade data
 * @param {string} data.fromUserId - Sender user ID
 * @param {string} data.toUserId - Recipient user ID
 * @param {number} data.fromNflmonId - NFLmon being offered
 * @param {number} [data.toNflmonId] - NFLmon requested in return
 * @param {number} [data.coinsOffered=0] - Coins offered with trade
 * @returns {Promise<object>} Created trade
 */
export async function createTrade(data) {
  const {
    fromUserId,
    toUserId,
    fromNflmonId,
    toNflmonId = null,
    coinsOffered = 0,
  } = data;

  const result = await sql`
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
 * @param {string} userId - User ID
 * @returns {Promise<object[]>} Array of pending trades
 */
export async function getPendingTrades(userId) {
  const result = await sql`
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
 * @param {number} tradeId - Trade ID
 * @returns {Promise<object|null>} Trade or null
 */
export async function getTrade(tradeId) {
  const result = await sql`
    SELECT * FROM nflmon_trades WHERE id = ${tradeId} LIMIT 1
  `;
  return result.rows[0] || null;
}

/**
 * Cancel a trade (only by sender)
 * @param {string} userId - User ID (must be sender)
 * @param {number} tradeId - Trade ID
 * @returns {Promise<object|null>} Cancelled trade or null
 */
export async function cancelTrade(userId, tradeId) {
  const result = await sql`
    UPDATE nflmon_trades
    SET status = 'cancelled'
    WHERE id = ${tradeId} AND from_user_id = ${userId} AND status = 'pending'
    RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * Reject a trade (only by recipient)
 * @param {string} userId - User ID (must be recipient)
 * @param {number} tradeId - Trade ID
 * @returns {Promise<object|null>} Rejected trade or null
 */
export async function rejectTrade(userId, tradeId) {
  const result = await sql`
    UPDATE nflmon_trades
    SET status = 'rejected'
    WHERE id = ${tradeId} AND to_user_id = ${userId} AND status = 'pending'
    RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * Accept a trade (recipient only) - atomic ownership transfer with transaction safety
 * @param {string} userId - Recipient user ID
 * @param {number} tradeId - Trade ID
 * @returns {Promise<{success: boolean, trade?: object, fromNflmon?: object, toNflmon?: object, error?: string}>}
 */
export async function acceptTrade(userId, tradeId) {
  // Get a dedicated client for transaction
  const client = await db.connect();

  try {
    // Start transaction
    await client.sql`BEGIN`;

    // 1. Fetch and validate trade with row-level lock
    const tradeResult = await client.sql`
      SELECT * FROM nflmon_trades
      WHERE id = ${tradeId}
      FOR UPDATE
    `;
    const trade = tradeResult.rows[0];
    if (!trade) {
      await client.sql`ROLLBACK`;
      return { success: false, error: "NOT_FOUND" };
    }
    if (trade.to_user_id !== userId) {
      await client.sql`ROLLBACK`;
      return { success: false, error: "NOT_RECIPIENT" };
    }
    if (trade.status !== "pending") {
      await client.sql`ROLLBACK`;
      return { success: false, error: "NOT_PENDING" };
    }
    if (new Date() > new Date(trade.expires_at)) {
      await client.sql`ROLLBACK`;
      return { success: false, error: "EXPIRED" };
    }

    // 2. Validate from_nflmon with lock
    const fromResult = await client.sql`
      SELECT * FROM nflmon_bench
      WHERE id = ${trade.from_nflmon_id} AND user_id = ${trade.from_user_id}
      FOR UPDATE
    `;
    const fromNflmon = fromResult.rows[0];
    if (!fromNflmon) {
      await client.sql`ROLLBACK`;
      return { success: false, error: "FROM_NFLMON_UNAVAILABLE" };
    }
    if (fromNflmon.training_slot !== null) {
      await client.sql`ROLLBACK`;
      return { success: false, error: "FROM_NFLMON_TRAINING" };
    }

    // 3. Validate to_nflmon if 1:1 trade (with lock)
    let toNflmon = null;
    if (trade.to_nflmon_id) {
      const toResult = await client.sql`
        SELECT * FROM nflmon_bench
        WHERE id = ${trade.to_nflmon_id} AND user_id = ${trade.to_user_id}
        FOR UPDATE
      `;
      toNflmon = toResult.rows[0];
      if (!toNflmon) {
        await client.sql`ROLLBACK`;
        return { success: false, error: "TO_NFLMON_UNAVAILABLE" };
      }
      if (toNflmon.training_slot !== null) {
        await client.sql`ROLLBACK`;
        return { success: false, error: "TO_NFLMON_TRAINING" };
      }
    }

    // 4. Validate coins if offered (with lock on sender's economy record)
    if (trade.coins_offered > 0) {
      const senderResult = await client.sql`
        SELECT * FROM economy_users
        WHERE user_id = ${trade.from_user_id}
        FOR UPDATE
      `;
      const sender = senderResult.rows[0];
      if (!sender || sender.wallet < trade.coins_offered) {
        await client.sql`ROLLBACK`;
        return { success: false, error: "INSUFFICIENT_COINS" };
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
    const completedResult = await client.sql`
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
    console.error("[NFLMON] acceptTrade transaction failed:", error);
    return { success: false, error: "TRANSACTION_FAILED" };
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
 * @param {string} [category='total_caught'] - Category to rank by
 * @param {number} [limit=10] - Number of entries to return
 * @returns {Promise<Array<{user_id: string, username: string, value: number}>>}
 */
export async function getLeaderboard(category = "total_caught", limit = 10) {
  // Whitelist allowed categories
  const allowedCategories = [
    "total_caught",
    "legendary_count",
    "highest_level_reached",
    "total_evolved",
  ];
  if (!allowedCategories.includes(category)) {
    category = "total_caught";
  }

  const result = await sql.query(
    `SELECT user_id, username, ${category} as value
     FROM nflmon_stats
     WHERE ${category} > 0
     ORDER BY ${category} DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

/**
 * Get a user's rank in a specific category
 * @param {string} userId - User ID
 * @param {string} [category='total_caught'] - Category to rank by
 * @returns {Promise<{rank: number, value: number}|null>}
 */
export async function getUserRank(userId, category = "total_caught") {
  const allowedCategories = [
    "total_caught",
    "legendary_count",
    "highest_level_reached",
    "total_evolved",
  ];
  if (!allowedCategories.includes(category)) {
    category = "total_caught";
  }

  const result = await sql.query(
    `SELECT
       ${category} as value,
       (SELECT COUNT(*) + 1 FROM nflmon_stats WHERE ${category} > s.${category}) as rank
     FROM nflmon_stats s
     WHERE user_id = $1`,
    [userId]
  );

  if (!result.rows[0]) return null;
  return {
    rank: parseInt(result.rows[0].rank),
    value: parseInt(result.rows[0].value),
  };
}

// =============================================================================
// STARTER OPERATIONS
// =============================================================================

/**
 * Check if user has already claimed their starter NFLmon
 * @param {string} userId - User ID
 * @returns {Promise<boolean>} True if already claimed
 */
export async function hasClaimedStarter(userId) {
  const stats = await getOrCreateStats(userId);
  return stats.starter_claimed === true;
}

/**
 * Mark user as having claimed their starter NFLmon
 * @param {string} userId - User ID
 * @returns {Promise<object|null>} Updated stats or null
 */
export async function markStarterClaimed(userId) {
  const result = await sql`
    UPDATE nflmon_stats
    SET starter_claimed = TRUE
    WHERE user_id = ${userId}
    RETURNING *
  `;
  return result.rows[0] || null;
}

// =============================================================================
// EVOLUTION OPERATIONS
// =============================================================================

/**
 * Evolve an NFLmon to a new stage
 * @param {string} userId - User ID for ownership check
 * @param {number} nflmonId - NFLmon ID
 * @param {string} newStageId - New evolution stage ID
 * @returns {Promise<object|null>} Updated NFLmon or null
 */
export async function evolveNflmon(userId, nflmonId, newStageId) {
  const result = await sql`
    UPDATE nflmon_bench
    SET evolution_stage = ${newStageId}
    WHERE id = ${nflmonId} AND user_id = ${userId}
    RETURNING *
  `;

  if (result.rows[0]) {
    await incrementStat(userId, "total_evolved", 1);
  }

  return result.rows[0] || null;
}
