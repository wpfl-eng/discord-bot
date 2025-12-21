// Video Poker Database Operations
// Stats tracking and leaderboards for Video Poker

import { sql } from '@vercel/postgres';
import { HandRank } from '../discordCommands/videopoker/videoPokerConfig.js';

// ============ Type Definitions ============

/**
 * Game outcome types
 */
export type GameOutcome = 'win' | 'loss';

/**
 * Leaderboard category types
 */
export type LeaderboardCategory =
  | 'games'
  | 'wins'
  | 'winrate'
  | 'profit'
  | 'streak'
  | 'biggest_win'
  | 'royal_flushes';

/**
 * Video poker stats record
 */
export interface VideoPokerStats {
  readonly id: number;
  readonly user_id: string;
  readonly username: string;
  readonly variant_id: string;
  readonly games_played: number;
  readonly games_won: number;
  readonly games_lost: number;
  readonly current_streak: number;
  readonly best_win_streak: number;
  readonly worst_loss_streak: number;
  readonly total_wagered: number;
  readonly total_won: number;
  readonly biggest_win: number;
  readonly royal_flushes: number;
  readonly straight_flushes: number;
  readonly four_of_a_kinds: number;
  readonly full_houses: number;
  readonly flushes: number;
  readonly straights: number;
  readonly three_of_a_kinds: number;
  readonly two_pairs: number;
  readonly jacks_or_betters: number;
  readonly last_played_at: Date | null;
  readonly created_at: Date;
}

/**
 * Data required to record a game result
 */
export interface RecordGameResultData {
  readonly userId: string;
  readonly username: string;
  readonly variantId: string;
  readonly outcome: GameOutcome;
  readonly handRank: HandRank;
  readonly bet: number;
  readonly payout: number;
}

/**
 * Leaderboard entry with computed fields
 */
export interface LeaderboardEntry {
  readonly user_id: string;
  readonly username: string;
  readonly variant_id?: string;
  readonly games_played?: number;
  readonly games_won?: number;
  readonly games_lost?: number;
  readonly win_rate?: number;
  readonly net_profit?: number;
  readonly total_wagered?: number;
  readonly total_won?: number;
  readonly best_win_streak?: number;
  readonly current_streak?: number;
  readonly biggest_win?: number;
  readonly royal_flushes?: number;
}

// ============ Helper Functions ============

/**
 * Get hand type increment values based on the hand rank
 */
function getHandIncrements(handRank: HandRank): Record<string, number> {
  return {
    royalFlushes: handRank === HandRank.ROYAL_FLUSH ? 1 : 0,
    straightFlushes: handRank === HandRank.STRAIGHT_FLUSH ? 1 : 0,
    fourOfAKinds: handRank === HandRank.FOUR_OF_A_KIND ? 1 : 0,
    fullHouses: handRank === HandRank.FULL_HOUSE ? 1 : 0,
    flushes: handRank === HandRank.FLUSH ? 1 : 0,
    straights: handRank === HandRank.STRAIGHT ? 1 : 0,
    threeOfAKinds: handRank === HandRank.THREE_OF_A_KIND ? 1 : 0,
    twoPairs: handRank === HandRank.TWO_PAIR ? 1 : 0,
    jacksOrBetters: handRank === HandRank.JACKS_OR_BETTER ? 1 : 0,
  };
}

// ============ Stats Management ============

/**
 * Get or create a user's video poker stats for a variant
 * @param userId - Discord user ID
 * @param username - Discord username
 * @param variantId - Variant ID (e.g., 'jacks_or_better')
 * @returns User video poker stats
 */
export async function getOrCreateStats(
  userId: string,
  username: string,
  variantId: string = 'jacks_or_better'
): Promise<VideoPokerStats> {
  const result = await sql<VideoPokerStats>`
    INSERT INTO video_poker_stats (user_id, username, variant_id, created_at)
    VALUES (${userId}, ${username}, ${variantId}, NOW())
    ON CONFLICT (user_id, variant_id) DO UPDATE SET
      username = ${username}
    RETURNING *
  `;
  return result.rows[0];
}

/**
 * Get a user's video poker stats
 * @param userId - Discord user ID
 * @param variantId - Variant ID
 * @returns User stats or null
 */
export async function getUserStats(
  userId: string,
  variantId: string = 'jacks_or_better'
): Promise<VideoPokerStats | null> {
  const result = await sql<VideoPokerStats>`
    SELECT * FROM video_poker_stats
    WHERE user_id = ${userId} AND variant_id = ${variantId}
    LIMIT 1
  `;
  return result.rows[0] ?? null;
}

/**
 * Get all stats for a user across all variants
 * @param userId - Discord user ID
 * @returns Array of stats for all variants
 */
export async function getAllUserStats(userId: string): Promise<VideoPokerStats[]> {
  const result = await sql<VideoPokerStats>`
    SELECT * FROM video_poker_stats
    WHERE user_id = ${userId}
    ORDER BY games_played DESC
  `;
  return result.rows;
}

/**
 * Record a game result and update all stats atomically
 * @param data - Game result data
 * @returns Updated user stats
 */
export async function recordGameResult(data: RecordGameResultData): Promise<VideoPokerStats> {
  const { userId, username, variantId, outcome, handRank, bet, payout } = data;

  // Determine increments
  const gamesWon = outcome === 'win' ? 1 : 0;
  const gamesLost = outcome === 'loss' ? 1 : 0;
  const handIncrements = getHandIncrements(handRank);
  const netProfit = payout - bet;

  const result = await sql<VideoPokerStats>`
    INSERT INTO video_poker_stats (
      user_id, username, variant_id, games_played, games_won, games_lost,
      current_streak, best_win_streak, worst_loss_streak,
      total_wagered, total_won, biggest_win,
      royal_flushes, straight_flushes, four_of_a_kinds, full_houses,
      flushes, straights, three_of_a_kinds, two_pairs, jacks_or_betters,
      last_played_at, created_at
    )
    VALUES (
      ${userId}, ${username}, ${variantId}, 1, ${gamesWon}, ${gamesLost},
      CASE WHEN ${outcome} = 'win' THEN 1 ELSE -1 END,
      CASE WHEN ${outcome} = 'win' THEN 1 ELSE 0 END,
      CASE WHEN ${outcome} = 'loss' THEN 1 ELSE 0 END,
      ${bet}, ${payout},
      CASE WHEN ${netProfit} > 0 THEN ${netProfit} ELSE 0 END,
      ${handIncrements.royalFlushes}, ${handIncrements.straightFlushes},
      ${handIncrements.fourOfAKinds}, ${handIncrements.fullHouses},
      ${handIncrements.flushes}, ${handIncrements.straights},
      ${handIncrements.threeOfAKinds}, ${handIncrements.twoPairs},
      ${handIncrements.jacksOrBetters},
      NOW(), NOW()
    )
    ON CONFLICT (user_id, variant_id) DO UPDATE SET
      username = ${username},
      games_played = video_poker_stats.games_played + 1,
      games_won = video_poker_stats.games_won + ${gamesWon},
      games_lost = video_poker_stats.games_lost + ${gamesLost},
      current_streak = CASE
        WHEN ${outcome} = 'win' AND video_poker_stats.current_streak >= 0 THEN video_poker_stats.current_streak + 1
        WHEN ${outcome} = 'win' THEN 1
        WHEN ${outcome} = 'loss' AND video_poker_stats.current_streak <= 0 THEN video_poker_stats.current_streak - 1
        ELSE -1
      END,
      best_win_streak = CASE
        WHEN ${outcome} = 'win' AND video_poker_stats.current_streak >= 0
          AND video_poker_stats.current_streak + 1 > video_poker_stats.best_win_streak
        THEN video_poker_stats.current_streak + 1
        WHEN ${outcome} = 'win' AND video_poker_stats.current_streak < 0
          AND 1 > video_poker_stats.best_win_streak
        THEN 1
        ELSE video_poker_stats.best_win_streak
      END,
      worst_loss_streak = CASE
        WHEN ${outcome} = 'loss' AND video_poker_stats.current_streak <= 0
          AND ABS(video_poker_stats.current_streak - 1) > video_poker_stats.worst_loss_streak
        THEN ABS(video_poker_stats.current_streak - 1)
        WHEN ${outcome} = 'loss' AND video_poker_stats.current_streak > 0
          AND 1 > video_poker_stats.worst_loss_streak
        THEN 1
        ELSE video_poker_stats.worst_loss_streak
      END,
      total_wagered = video_poker_stats.total_wagered + ${bet},
      total_won = video_poker_stats.total_won + ${payout},
      biggest_win = CASE
        WHEN ${netProfit} > video_poker_stats.biggest_win THEN ${netProfit}
        ELSE video_poker_stats.biggest_win
      END,
      royal_flushes = video_poker_stats.royal_flushes + ${handIncrements.royalFlushes},
      straight_flushes = video_poker_stats.straight_flushes + ${handIncrements.straightFlushes},
      four_of_a_kinds = video_poker_stats.four_of_a_kinds + ${handIncrements.fourOfAKinds},
      full_houses = video_poker_stats.full_houses + ${handIncrements.fullHouses},
      flushes = video_poker_stats.flushes + ${handIncrements.flushes},
      straights = video_poker_stats.straights + ${handIncrements.straights},
      three_of_a_kinds = video_poker_stats.three_of_a_kinds + ${handIncrements.threeOfAKinds},
      two_pairs = video_poker_stats.two_pairs + ${handIncrements.twoPairs},
      jacks_or_betters = video_poker_stats.jacks_or_betters + ${handIncrements.jacksOrBetters},
      last_played_at = NOW()
    RETURNING *
  `;
  return result.rows[0];
}

// ============ Leaderboards ============

/**
 * Get video poker leaderboard by category
 * @param category - Leaderboard category
 * @param variantId - Optional variant filter (not currently used, reserved for future)
 * @param limit - Number of results
 * @returns Leaderboard entries
 */
export async function getLeaderboard(
  category: LeaderboardCategory,
  _variantId?: string,
  limit: number = 10
): Promise<LeaderboardEntry[]> {
  let result;

  switch (category) {
    case 'games':
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username, variant_id, games_played, games_won, games_lost,
          CASE WHEN games_played > 0
            THEN ROUND(100.0 * games_won / games_played, 1)
            ELSE 0
          END as win_rate
        FROM video_poker_stats
        ORDER BY games_played DESC
        LIMIT ${limit}
      `;
      break;

    case 'wins':
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username, variant_id, games_won, games_played,
          CASE WHEN games_played > 0
            THEN ROUND(100.0 * games_won / games_played, 1)
            ELSE 0
          END as win_rate
        FROM video_poker_stats
        ORDER BY games_won DESC
        LIMIT ${limit}
      `;
      break;

    case 'winrate':
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username, variant_id, games_won, games_played,
          ROUND(100.0 * games_won / games_played, 1) as win_rate
        FROM video_poker_stats
        WHERE games_played >= 20
        ORDER BY (games_won::float / games_played) DESC
        LIMIT ${limit}
      `;
      break;

    case 'profit':
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username, variant_id,
          (total_won - total_wagered) as net_profit,
          total_wagered, total_won, games_played
        FROM video_poker_stats
        ORDER BY (total_won - total_wagered) DESC
        LIMIT ${limit}
      `;
      break;

    case 'streak':
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username, variant_id, best_win_streak, current_streak, games_played
        FROM video_poker_stats
        ORDER BY best_win_streak DESC
        LIMIT ${limit}
      `;
      break;

    case 'biggest_win':
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username, variant_id, biggest_win, games_played
        FROM video_poker_stats
        ORDER BY biggest_win DESC
        LIMIT ${limit}
      `;
      break;

    case 'royal_flushes':
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username, variant_id, royal_flushes, games_played
        FROM video_poker_stats
        ORDER BY royal_flushes DESC
        LIMIT ${limit}
      `;
      break;

    default:
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username, variant_id, games_played, games_won
        FROM video_poker_stats
        ORDER BY games_played DESC
        LIMIT ${limit}
      `;
  }

  return result.rows;
}

/**
 * Get total number of video poker players
 * @param variantId - Optional variant filter
 * @returns Total player count
 */
export async function getTotalPlayers(variantId?: string): Promise<number> {
  if (variantId) {
    const result = await sql<{ count: string }>`
      SELECT COUNT(DISTINCT user_id) as count FROM video_poker_stats
      WHERE variant_id = ${variantId}
    `;
    return parseInt(result.rows[0]?.count ?? '0', 10);
  }

  const result = await sql<{ count: string }>`
    SELECT COUNT(DISTINCT user_id) as count FROM video_poker_stats
  `;
  return parseInt(result.rows[0]?.count ?? '0', 10);
}
