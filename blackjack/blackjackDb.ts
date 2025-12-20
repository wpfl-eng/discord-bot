// Blackjack Database Operations
// Stats tracking and leaderboards for the Blackjack game

import { sql } from '@vercel/postgres';

// ============ Type Definitions ============

/**
 * Game outcome types
 */
export type GameOutcome = 'win' | 'loss' | 'push';

/**
 * Leaderboard category types
 */
export type LeaderboardCategory =
  | 'games'
  | 'wins'
  | 'winrate'
  | 'blackjacks'
  | 'profit'
  | 'streak'
  | 'biggest_win';

/**
 * Blackjack stats record from blackjack_stats table
 */
export interface BlackjackStats {
  readonly user_id: string;
  readonly username: string;
  readonly games_played: number;
  readonly games_won: number;
  readonly games_lost: number;
  readonly pushes: number;
  readonly blackjacks_hit: number;
  readonly busts: number;
  readonly current_streak: number;
  readonly best_win_streak: number;
  readonly worst_loss_streak: number;
  readonly total_wagered: number;
  readonly total_won: number;
  readonly biggest_win: number;
  readonly doubles_attempted: number;
  readonly doubles_won: number;
  readonly splits_attempted: number;
  readonly insurances_taken: number;
  readonly surrenders: number;
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
  readonly wasBlackjack?: boolean;
  readonly wasBust?: boolean;
  readonly wasDouble?: boolean;
  readonly wasSplit?: boolean;
  readonly wasInsurance?: boolean;
  readonly wasSurrender?: boolean;
}

/**
 * Leaderboard entry with computed fields
 */
export interface LeaderboardEntry {
  readonly user_id: string;
  readonly username: string;
  readonly games_played?: number;
  readonly games_won?: number;
  readonly games_lost?: number;
  readonly win_rate?: number;
  readonly blackjacks_hit?: number;
  readonly net_profit?: number;
  readonly total_wagered?: number;
  readonly total_won?: number;
  readonly best_win_streak?: number;
  readonly current_streak?: number;
  readonly biggest_win?: number;
}

// ============ Stats Management ============

/**
 * Get or create a user's blackjack stats
 * @param userId - Discord user ID
 * @param username - Discord username
 * @returns User blackjack stats
 */
export async function getOrCreateStats(
  userId: string,
  username: string
): Promise<BlackjackStats> {
  const result = await sql<BlackjackStats>`
    INSERT INTO blackjack_stats (user_id, username, created_at)
    VALUES (${userId}, ${username}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      username = ${username}
    RETURNING *
  `;
  return result.rows[0];
}

/**
 * Get a user's blackjack stats
 * @param userId - Discord user ID
 * @returns User stats or null
 */
export async function getUserStats(userId: string): Promise<BlackjackStats | null> {
  const result = await sql<BlackjackStats>`
    SELECT * FROM blackjack_stats
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  return result.rows[0] ?? null;
}

/**
 * Record a game result and update all stats atomically
 * Handles streak calculation: positive = wins, negative = losses, 0 = push
 * @param data - Game result data
 * @returns Updated user stats
 */
export async function recordGameResult(data: RecordGameResultData): Promise<BlackjackStats> {
  const {
    userId,
    username,
    outcome,
    bet,
    payout,
    wasBlackjack = false,
    wasBust = false,
    wasDouble = false,
    wasSplit = false,
    wasInsurance = false,
    wasSurrender = false,
  } = data;

  // Determine increments based on outcome
  const gamesWon = outcome === 'win' ? 1 : 0;
  const gamesLost = outcome === 'loss' ? 1 : 0;
  const pushes = outcome === 'push' ? 1 : 0;
  const blackjacksHit = wasBlackjack ? 1 : 0;
  const busts = wasBust ? 1 : 0;
  const doublesAttempted = wasDouble ? 1 : 0;
  const doublesWon = wasDouble && outcome === 'win' ? 1 : 0;
  const splitsAttempted = wasSplit ? 1 : 0;
  const insurancesTaken = wasInsurance ? 1 : 0;
  const surrenders = wasSurrender ? 1 : 0;

  // Calculate net profit for this game (payout - bet, or for loss just -bet since payout is 0)
  const netProfit = payout - bet;

  const result = await sql<BlackjackStats>`
    INSERT INTO blackjack_stats (
      user_id, username, games_played, games_won, games_lost, pushes,
      blackjacks_hit, busts, current_streak, best_win_streak, worst_loss_streak,
      total_wagered, total_won, biggest_win, doubles_attempted, doubles_won,
      splits_attempted, insurances_taken, surrenders, last_played_at, created_at
    )
    VALUES (
      ${userId}, ${username}, 1, ${gamesWon}, ${gamesLost}, ${pushes},
      ${blackjacksHit}, ${busts},
      CASE
        WHEN ${outcome} = 'win' THEN 1
        WHEN ${outcome} = 'loss' THEN -1
        ELSE 0
      END,
      CASE WHEN ${outcome} = 'win' THEN 1 ELSE 0 END,
      CASE WHEN ${outcome} = 'loss' THEN 1 ELSE 0 END,
      ${bet}, ${payout},
      CASE WHEN ${netProfit} > 0 THEN ${netProfit} ELSE 0 END,
      ${doublesAttempted}, ${doublesWon}, ${splitsAttempted}, ${insurancesTaken},
      ${surrenders}, NOW(), NOW()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      username = ${username},
      games_played = blackjack_stats.games_played + 1,
      games_won = blackjack_stats.games_won + ${gamesWon},
      games_lost = blackjack_stats.games_lost + ${gamesLost},
      pushes = blackjack_stats.pushes + ${pushes},
      blackjacks_hit = blackjack_stats.blackjacks_hit + ${blackjacksHit},
      busts = blackjack_stats.busts + ${busts},
      current_streak = CASE
        WHEN ${outcome} = 'win' AND blackjack_stats.current_streak >= 0 THEN blackjack_stats.current_streak + 1
        WHEN ${outcome} = 'win' THEN 1
        WHEN ${outcome} = 'loss' AND blackjack_stats.current_streak <= 0 THEN blackjack_stats.current_streak - 1
        WHEN ${outcome} = 'loss' THEN -1
        ELSE 0
      END,
      best_win_streak = CASE
        WHEN ${outcome} = 'win' AND blackjack_stats.current_streak >= 0
          AND blackjack_stats.current_streak + 1 > blackjack_stats.best_win_streak
        THEN blackjack_stats.current_streak + 1
        WHEN ${outcome} = 'win' AND blackjack_stats.current_streak < 0
          AND 1 > blackjack_stats.best_win_streak
        THEN 1
        ELSE blackjack_stats.best_win_streak
      END,
      worst_loss_streak = CASE
        WHEN ${outcome} = 'loss' AND blackjack_stats.current_streak <= 0
          AND ABS(blackjack_stats.current_streak - 1) > blackjack_stats.worst_loss_streak
        THEN ABS(blackjack_stats.current_streak - 1)
        WHEN ${outcome} = 'loss' AND blackjack_stats.current_streak > 0
          AND 1 > blackjack_stats.worst_loss_streak
        THEN 1
        ELSE blackjack_stats.worst_loss_streak
      END,
      total_wagered = blackjack_stats.total_wagered + ${bet},
      total_won = blackjack_stats.total_won + ${payout},
      biggest_win = CASE
        WHEN ${netProfit} > blackjack_stats.biggest_win THEN ${netProfit}
        ELSE blackjack_stats.biggest_win
      END,
      doubles_attempted = blackjack_stats.doubles_attempted + ${doublesAttempted},
      doubles_won = blackjack_stats.doubles_won + ${doublesWon},
      splits_attempted = blackjack_stats.splits_attempted + ${splitsAttempted},
      insurances_taken = blackjack_stats.insurances_taken + ${insurancesTaken},
      surrenders = blackjack_stats.surrenders + ${surrenders},
      last_played_at = NOW()
    RETURNING *
  `;
  return result.rows[0];
}

// ============ Leaderboards ============

/**
 * Get blackjack leaderboard by category
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
    case 'games':
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username, games_played, games_won, games_lost,
          CASE WHEN games_played > 0
            THEN ROUND(100.0 * games_won / games_played, 1)
            ELSE 0
          END as win_rate
        FROM blackjack_stats
        ORDER BY games_played DESC
        LIMIT ${limit}
      `;
      break;

    case 'wins':
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username, games_won, games_played,
          CASE WHEN games_played > 0
            THEN ROUND(100.0 * games_won / games_played, 1)
            ELSE 0
          END as win_rate
        FROM blackjack_stats
        ORDER BY games_won DESC
        LIMIT ${limit}
      `;
      break;

    case 'winrate':
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username, games_won, games_played,
          ROUND(100.0 * games_won / games_played, 1) as win_rate
        FROM blackjack_stats
        WHERE games_played >= 20
        ORDER BY (games_won::float / games_played) DESC
        LIMIT ${limit}
      `;
      break;

    case 'blackjacks':
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username, blackjacks_hit, games_played
        FROM blackjack_stats
        ORDER BY blackjacks_hit DESC
        LIMIT ${limit}
      `;
      break;

    case 'profit':
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username,
          (total_won - total_wagered) as net_profit,
          total_wagered, total_won, games_played
        FROM blackjack_stats
        ORDER BY (total_won - total_wagered) DESC
        LIMIT ${limit}
      `;
      break;

    case 'streak':
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username, best_win_streak, current_streak, games_played
        FROM blackjack_stats
        ORDER BY best_win_streak DESC
        LIMIT ${limit}
      `;
      break;

    case 'biggest_win':
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username, biggest_win, games_played
        FROM blackjack_stats
        ORDER BY biggest_win DESC
        LIMIT ${limit}
      `;
      break;

    default:
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username, games_played, games_won
        FROM blackjack_stats
        ORDER BY games_played DESC
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
  category: 'games' | 'wins' | 'winrate' | 'profit' = 'games'
): Promise<number | null> {
  const stats = await getUserStats(userId);
  if (!stats) return null;

  let result;

  switch (category) {
    case 'games':
      result = await sql<{ rank: string }>`
        SELECT COUNT(*) + 1 as rank
        FROM blackjack_stats
        WHERE games_played > ${stats.games_played}
      `;
      break;

    case 'wins':
      result = await sql<{ rank: string }>`
        SELECT COUNT(*) + 1 as rank
        FROM blackjack_stats
        WHERE games_won > ${stats.games_won}
      `;
      break;

    case 'profit': {
      const netProfit = stats.total_won - stats.total_wagered;
      result = await sql<{ rank: string }>`
        SELECT COUNT(*) + 1 as rank
        FROM blackjack_stats
        WHERE (total_won - total_wagered) > ${netProfit}
      `;
      break;
    }

    default:
      result = await sql<{ rank: string }>`
        SELECT COUNT(*) + 1 as rank
        FROM blackjack_stats
        WHERE games_played > ${stats.games_played}
      `;
  }

  return parseInt(result.rows[0]?.rank ?? '1', 10);
}

/**
 * Get total number of blackjack players
 * @returns Total player count
 */
export async function getTotalPlayers(): Promise<number> {
  const result = await sql<{ count: string }>`
    SELECT COUNT(*) as count FROM blackjack_stats
  `;
  return parseInt(result.rows[0]?.count ?? '0', 10);
}
