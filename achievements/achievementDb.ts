// Achievement Database Operations
// CRUD operations for user achievements

import { sql } from '@vercel/postgres';

// ============ Type Definitions ============

/**
 * Achievement record from achievements table
 */
export interface AchievementRecord {
  readonly user_id: string;
  readonly username: string;
  readonly achievement_key: string;
  readonly achieved_at: Date;
}

// ============ Query Functions ============

/**
 * Check if a user has already earned a specific achievement
 * @param userId - Discord user ID
 * @param achievementKey - The achievement key to check
 * @returns True if already earned
 */
export async function hasAchievement(userId: string, achievementKey: string): Promise<boolean> {
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
 * @param userId - Discord user ID
 * @param username - Discord username
 * @param achievementKey - The achievement key to grant
 * @returns The achievement record if newly created, null if already exists
 */
export async function grantAchievement(
  userId: string,
  username: string,
  achievementKey: string
): Promise<AchievementRecord | null> {
  const result = await sql<AchievementRecord>`
    INSERT INTO achievements (user_id, username, achievement_key, achieved_at)
    VALUES (${userId}, ${username}, ${achievementKey}, NOW())
    ON CONFLICT (user_id, achievement_key) DO NOTHING
    RETURNING *
  `;
  return result.rows[0] ?? null;
}

/**
 * Get all achievements for a user
 * @param userId - Discord user ID
 * @returns Array of achievement records
 */
export async function getUserAchievements(userId: string): Promise<AchievementRecord[]> {
  const result = await sql<AchievementRecord>`
    SELECT * FROM achievements
    WHERE user_id = ${userId}
    ORDER BY achieved_at DESC
  `;
  return result.rows;
}

/**
 * Get count of users who have earned a specific achievement
 * @param achievementKey - The achievement key
 * @returns Count of users with this achievement
 */
export async function getAchievementCount(achievementKey: string): Promise<number> {
  const result = await sql<{ count: string }>`
    SELECT COUNT(*) as count FROM achievements
    WHERE achievement_key = ${achievementKey}
  `;
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

/**
 * Get all users who have earned a specific achievement
 * @param achievementKey - The achievement key
 * @param limit - Maximum number of results
 * @returns Array of achievement records
 */
export async function getAchievementHolders(
  achievementKey: string,
  limit: number = 10
): Promise<AchievementRecord[]> {
  const result = await sql<AchievementRecord>`
    SELECT * FROM achievements
    WHERE achievement_key = ${achievementKey}
    ORDER BY achieved_at ASC
    LIMIT ${limit}
  `;
  return result.rows;
}
