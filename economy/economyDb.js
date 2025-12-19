import { sql } from "@vercel/postgres";

// ============ User Management ============

/**
 * Get or create a user's economy account
 * @param {string} userId - Discord user ID
 * @param {string} username - Discord username
 * @returns {Promise<object>} - User economy data
 */
export async function getOrCreateUser(userId, username) {
  const result = await sql`
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
 * @param {string} userId - Discord user ID
 * @returns {Promise<object|null>} - User data or null
 */
export async function getUser(userId) {
  const result = await sql`
    SELECT * FROM economy_users
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  return result.rows[0] || null;
}

// ============ Atomic Wallet Operations ============

/**
 * Add coins to a user's wallet (for earnings only)
 * @param {string} userId - Discord user ID
 * @param {number} amount - Amount to add (must be positive)
 * @returns {Promise<object|null>} - Updated user data
 */
export async function addToWallet(userId, amount) {
  if (amount <= 0) return null;

  const result = await sql`
    UPDATE economy_users
    SET
      wallet = wallet + ${amount},
      total_earned = total_earned + ${amount}
    WHERE user_id = ${userId}
    RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * Deduct coins from a user's wallet (atomic - fails if insufficient funds)
 * @param {string} userId - Discord user ID
 * @param {number} amount - Amount to deduct (must be positive)
 * @returns {Promise<object|null>} - Updated user data or null if insufficient funds
 */
export async function deductFromWallet(userId, amount) {
  if (amount <= 0) return null;

  const result = await sql`
    UPDATE economy_users
    SET
      wallet = wallet - ${amount},
      total_lost = total_lost + ${amount}
    WHERE user_id = ${userId}
      AND wallet >= ${amount}
    RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * Transfer coins between two users atomically (for rob)
 * Deducts from victim's wallet and adds to attacker's wallet
 * @param {string} fromUserId - Victim's Discord user ID
 * @param {string} toUserId - Attacker's Discord user ID
 * @param {number} amount - Amount to transfer
 * @returns {Promise<{from: object|null, to: object|null}>} - Both updated users or nulls if failed
 */
export async function transferBetweenUsers(fromUserId, toUserId, amount) {
  if (amount <= 0) return { from: null, to: null };

  // Deduct from victim (atomic - will fail if insufficient)
  const fromResult = await sql`
    UPDATE economy_users
    SET
      wallet = wallet - ${amount},
      total_lost = total_lost + ${amount}
    WHERE user_id = ${fromUserId}
      AND wallet >= ${amount}
    RETURNING *
  `;

  if (!fromResult.rows[0]) {
    return { from: null, to: null };
  }

  // Add to attacker
  const toResult = await sql`
    UPDATE economy_users
    SET
      wallet = wallet + ${amount},
      total_earned = total_earned + ${amount}
    WHERE user_id = ${toUserId}
    RETURNING *
  `;

  return { from: fromResult.rows[0], to: toResult.rows[0] };
}

/**
 * Transfer money from wallet to bank (atomic)
 * @param {string} userId - Discord user ID
 * @param {number} amount - Amount to transfer
 * @returns {Promise<object|null>} - Updated user data or null if insufficient funds/capacity
 */
export async function transferToBank(userId, amount) {
  if (amount <= 0) return null;

  const result = await sql`
    UPDATE economy_users
    SET
      wallet = wallet - ${amount},
      bank = bank + ${amount}
    WHERE user_id = ${userId}
      AND wallet >= ${amount}
      AND bank + ${amount} <= bank_capacity
    RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * Transfer money from bank to wallet (atomic)
 * @param {string} userId - Discord user ID
 * @param {number} amount - Amount to transfer
 * @returns {Promise<object|null>} - Updated user data or null if insufficient funds
 */
export async function transferToWallet(userId, amount) {
  if (amount <= 0) return null;

  const result = await sql`
    UPDATE economy_users
    SET
      wallet = wallet + ${amount},
      bank = bank - ${amount}
    WHERE user_id = ${userId}
      AND bank >= ${amount}
    RETURNING *
  `;
  return result.rows[0] || null;
}

// ============ Daily/Work Cooldowns ============

/**
 * Update last daily timestamp, streak, and add reward atomically
 * @param {string} userId - Discord user ID
 * @param {number} streak - New streak value
 * @param {number} reward - Coins to add to wallet
 * @returns {Promise<object|null>} - Updated user data
 */
export async function claimDaily(userId, streak, reward) {
  const result = await sql`
    UPDATE economy_users
    SET
      last_daily = NOW(),
      daily_streak = ${streak},
      wallet = wallet + ${reward},
      total_earned = total_earned + ${reward}
    WHERE user_id = ${userId}
    RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * Update last work timestamp and add reward atomically
 * @param {string} userId - Discord user ID
 * @param {number} reward - Coins to add to wallet (0 for failed work)
 * @returns {Promise<object|null>} - Updated user data
 */
export async function claimWork(userId, reward) {
  const result = await sql`
    UPDATE economy_users
    SET
      last_work = NOW(),
      wallet = wallet + ${reward},
      total_earned = CASE WHEN ${reward} > 0 THEN total_earned + ${reward} ELSE total_earned END
    WHERE user_id = ${userId}
    RETURNING *
  `;
  return result.rows[0] || null;
}

// ============ Rob System ============

/**
 * Update rob timestamps for attacker
 * @param {string} userId - Discord user ID (attacker)
 * @returns {Promise<object|null>} - Updated user data
 */
export async function setLastRob(userId) {
  const result = await sql`
    UPDATE economy_users
    SET last_rob = NOW()
    WHERE user_id = ${userId}
    RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * Update robbed timestamps for victim
 * @param {string} victimId - Discord user ID (victim)
 * @param {string} attackerId - Discord user ID (attacker)
 * @returns {Promise<object|null>} - Updated user data
 */
export async function setLastRobbed(victimId, attackerId) {
  const result = await sql`
    UPDATE economy_users
    SET
      last_robbed_at = NOW(),
      last_robbed_by = ${attackerId}
    WHERE user_id = ${victimId}
    RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * Pay fine for failed robbery (atomic)
 * @param {string} userId - Discord user ID
 * @param {number} fine - Fine amount
 * @returns {Promise<object|null>} - Updated user data or null if can't pay
 */
export async function payRobFine(userId, fine) {
  const result = await sql`
    UPDATE economy_users
    SET
      wallet = wallet - ${fine},
      total_lost = total_lost + ${fine}
    WHERE user_id = ${userId}
      AND wallet >= ${fine}
    RETURNING *
  `;
  return result.rows[0] || null;
}

// ============ Shop Items ============

/**
 * Set padlock status for a user
 * @param {string} userId - Discord user ID
 * @param {boolean} hasPadlock - Whether user has a padlock
 * @returns {Promise<object|null>} - Updated user data
 */
export async function setPadlock(userId, hasPadlock) {
  const result = await sql`
    UPDATE economy_users
    SET has_padlock = ${hasPadlock}
    WHERE user_id = ${userId}
    RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * Purchase padlock (atomic - deducts cost and sets padlock)
 * @param {string} userId - Discord user ID
 * @param {number} cost - Cost of padlock
 * @returns {Promise<object|null>} - Updated user data or null if can't afford or already has one
 */
export async function buyPadlock(userId, cost) {
  const result = await sql`
    UPDATE economy_users
    SET
      wallet = wallet - ${cost},
      has_padlock = TRUE,
      total_lost = total_lost + ${cost}
    WHERE user_id = ${userId}
      AND wallet >= ${cost}
      AND has_padlock = FALSE
    RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * Purchase bank expansion (atomic)
 * @param {string} userId - Discord user ID
 * @param {number} cost - Cost of expansion
 * @param {number} expansionAmount - How much to expand capacity
 * @returns {Promise<object|null>} - Updated user data or null if can't afford
 */
export async function buyBankExpansion(userId, cost, expansionAmount) {
  const result = await sql`
    UPDATE economy_users
    SET
      wallet = wallet - ${cost},
      bank_capacity = bank_capacity + ${expansionAmount},
      total_lost = total_lost + ${cost}
    WHERE user_id = ${userId}
      AND wallet >= ${cost}
    RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * Expand a user's bank capacity (legacy - use buyBankExpansion instead)
 * @param {string} userId - Discord user ID
 * @param {number} amount - Amount to expand by
 * @returns {Promise<object|null>} - Updated user data
 */
export async function expandBank(userId, amount) {
  const result = await sql`
    UPDATE economy_users
    SET bank_capacity = bank_capacity + ${amount}
    WHERE user_id = ${userId}
    RETURNING *
  `;
  return result.rows[0] || null;
}

// ============ Gamble ============

/**
 * Process a gamble win (atomic - adds winnings)
 * @param {string} userId - Discord user ID
 * @param {number} winnings - Amount won
 * @returns {Promise<object|null>} - Updated user data
 */
export async function gambleWin(userId, winnings) {
  const result = await sql`
    UPDATE economy_users
    SET
      wallet = wallet + ${winnings},
      total_earned = total_earned + ${winnings}
    WHERE user_id = ${userId}
    RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * Process a gamble loss (atomic - deducts bet)
 * @param {string} userId - Discord user ID
 * @param {number} bet - Amount lost
 * @returns {Promise<object|null>} - Updated user data or null if insufficient funds
 */
export async function gambleLose(userId, bet) {
  const result = await sql`
    UPDATE economy_users
    SET
      wallet = wallet - ${bet},
      total_lost = total_lost + ${bet}
    WHERE user_id = ${userId}
      AND wallet >= ${bet}
    RETURNING *
  `;
  return result.rows[0] || null;
}

// ============ Leaderboard ============

/**
 * Get the economy leaderboard
 * @param {number} limit - Number of users to return
 * @returns {Promise<array>} - Top users sorted by total wealth
 */
export async function getLeaderboard(limit = 10) {
  const result = await sql`
    SELECT user_id, username, wallet, bank, (wallet + bank) as total_wealth, total_earned, total_lost
    FROM economy_users
    ORDER BY (wallet + bank) DESC
    LIMIT ${limit}
  `;
  return result.rows;
}

/**
 * Get a user's rank on the leaderboard
 * @param {string} userId - Discord user ID
 * @returns {Promise<number|null>} - User's rank (1-based) or null if not found
 */
export async function getUserRank(userId) {
  const user = await getUser(userId);
  if (!user) return null;

  const userWealth = user.wallet + user.bank;
  const result = await sql`
    SELECT COUNT(*) + 1 as rank
    FROM economy_users
    WHERE (wallet + bank) > ${userWealth}
  `;
  return parseInt(result.rows[0]?.rank) || 1;
}

/**
 * Get total number of users in the economy
 * @returns {Promise<number>} - Total user count
 */
export async function getTotalUsers() {
  const result = await sql`
    SELECT COUNT(*) as count FROM economy_users
  `;
  return parseInt(result.rows[0]?.count) || 0;
}
