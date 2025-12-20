// Red Zone Database Operations
// Stats tracking and leaderboards for the Red Zone game

import { sql } from '@vercel/postgres';

// ============ Type Definitions ============

/**
 * Game outcome types
 */
export type GameOutcome = 'touchdown' | 'fumble' | 'cashout';

/**
 * Leaderboard category types
 */
export type LeaderboardCategory =
  | 'touchdowns'
  | 'winrate'
  | 'drive'
  | 'profit'
  | 'streak'
  | 'biggest_win';

/**
 * Red Zone stats record from redzone_stats table
 */
export interface RedzoneStats {
  readonly user_id: string;
  readonly username: string;
  readonly games_played: number;
  readonly touchdowns: number;
  readonly fumbles: number;
  readonly cashouts: number;
  readonly current_td_streak: number;
  readonly best_td_streak: number;
  readonly worst_fumble_streak: number;
  readonly total_yards_gained: number;
  readonly longest_drive: number;
  readonly total_wagered: number;
  readonly total_won: number;
  readonly biggest_win: number;
  readonly last_played_at: Date | null;
  readonly created_at: Date;
}

/**
 * Data required to record a game result
 */
export interface RecordGameResultData {
  readonly userId: string;
  readonly username: string;
  readonly outcome: GameOutcome;
  readonly bet: number;
  readonly payout: number;
  readonly yardsGained?: number;
}

/**
 * Leaderboard entry with computed fields
 */
export interface LeaderboardEntry {
  readonly user_id: string;
  readonly username: string;
  readonly touchdowns?: number;
  readonly games_played?: number;
  readonly fumbles?: number;
  readonly td_rate?: number;
  readonly longest_drive?: number;
  readonly total_yards_gained?: number;
  readonly net_profit?: number;
  readonly total_wagered?: number;
  readonly total_won?: number;
  readonly best_td_streak?: number;
  readonly current_td_streak?: number;
  readonly biggest_win?: number;
}

// ============ Stats Management ============

/**
 * Get or create a user's Red Zone stats
 * @param userId - Discord user ID
 * @param username - Discord username
 * @returns User Red Zone stats
 */
export async function getOrCreateStats(
  userId: string,
  username: string
): Promise<RedzoneStats> {
  const result = await sql<RedzoneStats>`
    INSERT INTO redzone_stats (user_id, username, created_at)
    VALUES (${userId}, ${username}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      username = ${username}
    RETURNING *
  `;
  return result.rows[0];
}

/**
 * Get a user's Red Zone stats
 * @param userId - Discord user ID
 * @returns User stats or null
 */
export async function getUserStats(userId: string): Promise<RedzoneStats | null> {
  const result = await sql<RedzoneStats>`
    SELECT * FROM redzone_stats
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  return result.rows[0] ?? null;
}

/**
 * Record a game result and update all stats atomically
 * Handles streak calculation: positive = TD streak, negative = fumble streak
 * @param data - Game result data
 * @returns Updated user stats
 */
export async function recordGameResult(data: RecordGameResultData): Promise<RedzoneStats> {
  const { userId, username, outcome, bet, payout, yardsGained = 0 } = data;

  // Determine increments based on outcome
  const touchdowns = outcome === 'touchdown' ? 1 : 0;
  const fumbles = outcome === 'fumble' ? 1 : 0;
  const cashouts = outcome === 'cashout' ? 1 : 0;

  // Calculate net profit for this game
  const netProfit = payout - bet;

  const result = await sql<RedzoneStats>`
    INSERT INTO redzone_stats (
      user_id, username, games_played, touchdowns, fumbles, cashouts,
      current_td_streak, best_td_streak, worst_fumble_streak,
      total_yards_gained, longest_drive,
      total_wagered, total_won, biggest_win, last_played_at, created_at
    )
    VALUES (
      ${userId}, ${username}, 1, ${touchdowns}, ${fumbles}, ${cashouts},
      CASE
        WHEN ${outcome} = 'touchdown' THEN 1
        WHEN ${outcome} = 'fumble' THEN -1
        ELSE 0
      END,
      CASE WHEN ${outcome} = 'touchdown' THEN 1 ELSE 0 END,
      CASE WHEN ${outcome} = 'fumble' THEN 1 ELSE 0 END,
      ${yardsGained}, ${yardsGained},
      ${bet}, ${payout},
      CASE WHEN ${netProfit} > 0 THEN ${netProfit} ELSE 0 END,
      NOW(), NOW()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      username = ${username},
      games_played = redzone_stats.games_played + 1,
      touchdowns = redzone_stats.touchdowns + ${touchdowns},
      fumbles = redzone_stats.fumbles + ${fumbles},
      cashouts = redzone_stats.cashouts + ${cashouts},
      current_td_streak = CASE
        WHEN ${outcome} = 'touchdown' AND redzone_stats.current_td_streak >= 0 THEN redzone_stats.current_td_streak + 1
        WHEN ${outcome} = 'touchdown' THEN 1
        WHEN ${outcome} = 'fumble' AND redzone_stats.current_td_streak <= 0 THEN redzone_stats.current_td_streak - 1
        WHEN ${outcome} = 'fumble' THEN -1
        ELSE 0
      END,
      best_td_streak = CASE
        WHEN ${outcome} = 'touchdown' AND redzone_stats.current_td_streak >= 0
          AND redzone_stats.current_td_streak + 1 > redzone_stats.best_td_streak
        THEN redzone_stats.current_td_streak + 1
        WHEN ${outcome} = 'touchdown' AND redzone_stats.current_td_streak < 0
          AND 1 > redzone_stats.best_td_streak
        THEN 1
        ELSE redzone_stats.best_td_streak
      END,
      worst_fumble_streak = CASE
        WHEN ${outcome} = 'fumble' AND redzone_stats.current_td_streak <= 0
          AND ABS(redzone_stats.current_td_streak - 1) > redzone_stats.worst_fumble_streak
        THEN ABS(redzone_stats.current_td_streak - 1)
        WHEN ${outcome} = 'fumble' AND redzone_stats.current_td_streak > 0
          AND 1 > redzone_stats.worst_fumble_streak
        THEN 1
        ELSE redzone_stats.worst_fumble_streak
      END,
      total_yards_gained = redzone_stats.total_yards_gained + ${yardsGained},
      longest_drive = CASE
        WHEN ${yardsGained} > redzone_stats.longest_drive THEN ${yardsGained}
        ELSE redzone_stats.longest_drive
      END,
      total_wagered = redzone_stats.total_wagered + ${bet},
      total_won = redzone_stats.total_won + ${payout},
      biggest_win = CASE
        WHEN ${netProfit} > redzone_stats.biggest_win THEN ${netProfit}
        ELSE redzone_stats.biggest_win
      END,
      last_played_at = NOW()
    RETURNING *
  `;
  return result.rows[0];
}

// ============ Leaderboards ============

/**
 * Get Red Zone leaderboard by category
 * @param category - Leaderboard category
 * @param limit - Number of results
 * @returns Leaderboard entries
 */
export async function getLeaderboard(
  category: LeaderboardCategory,
  limit: number = 10
): Promise<LeaderboardEntry[]> {
  let result;

  switch (category) {
    case 'touchdowns':
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username, touchdowns, games_played, fumbles,
          CASE WHEN games_played > 0
            THEN ROUND(100.0 * touchdowns / games_played, 1)
            ELSE 0
          END as td_rate
        FROM redzone_stats
        ORDER BY touchdowns DESC
        LIMIT ${limit}
      `;
      break;

    case 'winrate':
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username, touchdowns, games_played,
          ROUND(100.0 * touchdowns / games_played, 1) as td_rate
        FROM redzone_stats
        WHERE games_played >= 10
        ORDER BY (touchdowns::float / games_played) DESC
        LIMIT ${limit}
      `;
      break;

    case 'drive':
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username, longest_drive, total_yards_gained, games_played
        FROM redzone_stats
        ORDER BY longest_drive DESC
        LIMIT ${limit}
      `;
      break;

    case 'profit':
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username,
          (total_won - total_wagered) as net_profit,
          total_wagered, total_won, games_played
        FROM redzone_stats
        ORDER BY (total_won - total_wagered) DESC
        LIMIT ${limit}
      `;
      break;

    case 'streak':
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username, best_td_streak, current_td_streak, games_played
        FROM redzone_stats
        ORDER BY best_td_streak DESC
        LIMIT ${limit}
      `;
      break;

    case 'biggest_win':
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username, biggest_win, games_played
        FROM redzone_stats
        ORDER BY biggest_win DESC
        LIMIT ${limit}
      `;
      break;

    default:
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username, touchdowns, games_played
        FROM redzone_stats
        ORDER BY touchdowns DESC
        LIMIT ${limit}
      `;
  }

  return result.rows;
}

/**
 * Get a user's rank on a specific leaderboard
 * @param userId - Discord user ID
 * @param category - Category to rank
 * @returns User's rank (1-based) or null
 */
export async function getUserRank(
  userId: string,
  category: 'touchdowns' | 'profit' = 'touchdowns'
): Promise<number | null> {
  const stats = await getUserStats(userId);
  if (!stats) return null;

  let result;

  switch (category) {
    case 'touchdowns':
      result = await sql<{ rank: string }>`
        SELECT COUNT(*) + 1 as rank
        FROM redzone_stats
        WHERE touchdowns > ${stats.touchdowns}
      `;
      break;

    case 'profit': {
      const netProfit = stats.total_won - stats.total_wagered;
      result = await sql<{ rank: string }>`
        SELECT COUNT(*) + 1 as rank
        FROM redzone_stats
        WHERE (total_won - total_wagered) > ${netProfit}
      `;
      break;
    }

    default:
      result = await sql<{ rank: string }>`
        SELECT COUNT(*) + 1 as rank
        FROM redzone_stats
        WHERE touchdowns > ${stats.touchdowns}
      `;
  }

  return parseInt(result.rows[0]?.rank ?? '1', 10);
}

/**
 * Get total number of Red Zone players
 * @returns Total player count
 */
export async function getTotalPlayers(): Promise<number> {
  const result = await sql<{ count: string }>`
    SELECT COUNT(*) as count FROM redzone_stats
  `;
  return parseInt(result.rows[0]?.count ?? '0', 10);
}
