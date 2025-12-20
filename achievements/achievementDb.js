import { sql } from '@vercel/postgres';

/**
 * Check if a user has already earned a specific achievement
 * @param {string} userId - Discord user ID
 * @param {string} achievementKey - The achievement key to check
 * @returns {Promise<boolean>} - True if already earned
 */
export async function hasAchievement(userId, achievementKey) {
  const result = await sql`
    SELECT 1 FROM achievements
    WHERE user_id = ${userId}
      AND achievement_key = ${achievementKey}
    LIMIT 1
  `;
  return result.rows.length > 0;
}

/**
 * Grant an achievement to a user
 * Uses ON CONFLICT to handle race conditions - will not duplicate
 * @param {string} userId - Discord user ID
 * @param {string} username - Discord username
 * @param {string} achievementKey - The achievement key to grant
 * @returns {Promise<object|null>} - The achievement record if newly created, null if already exists
 */
export async function grantAchievement(userId, username, achievementKey) {
  const result = await sql`
    INSERT INTO achievements (user_id, username, achievement_key, achieved_at)
    VALUES (${userId}, ${username}, ${achievementKey}, NOW())
    ON CONFLICT (user_id, achievement_key) DO NOTHING
    RETURNING *
  `;
  return result.rows[0] || null;
}

/**
 * Get all achievements for a user
 * @param {string} userId - Discord user ID
 * @returns {Promise<object[]>} - Array of achievement records
 */
export async function getUserAchievements(userId) {
  const result = await sql`
    SELECT * FROM achievements
    WHERE user_id = ${userId}
    ORDER BY achieved_at DESC
  `;
  return result.rows;
}

/**
 * Get count of users who have earned a specific achievement
 * @param {string} achievementKey - The achievement key
 * @returns {Promise<number>} - Count of users with this achievement
 */
export async function getAchievementCount(achievementKey) {
  const result = await sql`
    SELECT COUNT(*) as count FROM achievements
    WHERE achievement_key = ${achievementKey}
  `;
  return parseInt(result.rows[0]?.count) || 0;
}

/**
 * Get all users who have earned a specific achievement
 * @param {string} achievementKey - The achievement key
 * @param {number} limit - Maximum number of results
 * @returns {Promise<object[]>} - Array of achievement records
 */
export async function getAchievementHolders(achievementKey, limit = 10) {
  const result = await sql`
    SELECT * FROM achievements
    WHERE achievement_key = ${achievementKey}
    ORDER BY achieved_at ASC
    LIMIT ${limit}
  `;
  return result.rows;
}
