// Craps Database Operations
// Session history, bet logging, and player statistics

import { sql } from '@vercel/postgres';
import type { BetType, SessionOutcome, Roll } from '../discordCommands/craps/crapsConfig.js';

// ============ TYPE DEFINITIONS ============

/**
 * Craps session record from craps_sessions table
 */
export interface CrapsSessionRecord {
  readonly id: number;
  readonly channel_id: string;
  readonly shooter_user_id: string | null;
  readonly shooter_username: string | null;
  readonly point: number | null;
  readonly roll_count: number;
  readonly outcome: SessionOutcome;
  readonly total_wagered: number;
  readonly total_paid: number;
  readonly roll_history: Roll[];
  readonly started_at: Date;
  readonly ended_at: Date;
}

/**
 * Craps bet record from craps_bets table
 */
export interface CrapsBetRecord {
  readonly id: number;
  readonly session_id: number;
  readonly user_id: string;
  readonly username: string;
  readonly bet_type: BetType;
  readonly amount: number;
  readonly outcome: 'won' | 'lost' | 'push';
  readonly payout: number;
  readonly placed_at: Date;
}

/**
 * Player statistics from craps_stats table
 */
export interface CrapsStats {
  readonly user_id: string;
  readonly username: string;
  readonly sessions_played: number;
  readonly sessions_as_shooter: number;
  readonly pass_line_bets: number;
  readonly pass_line_wins: number;
  readonly dont_pass_bets: number;
  readonly dont_pass_wins: number;
  readonly field_bets: number;
  readonly field_wins: number;
  readonly place_bets: number;
  readonly place_wins: number;
  readonly total_wagered: number;
  readonly total_won: number;
  readonly biggest_session_win: number;
  readonly biggest_session_loss: number;
  readonly biggest_single_bet_win: number;
  readonly seven_outs_witnessed: number;
  readonly points_hit_witnessed: number;
  readonly naturals_witnessed: number;
  readonly longest_roll_witnessed: number;
  readonly longest_roll_as_shooter: number;
  readonly points_hit_as_shooter: number;
  readonly seven_outs_as_shooter: number;
  readonly last_played_at: Date | null;
  readonly created_at: Date;
}

/**
 * Data for logging a completed session
 */
export interface LogSessionData {
  readonly channelId: string;
  readonly shooterUserId: string | null;
  readonly shooterUsername: string | null;
  readonly point: number | null;
  readonly rollCount: number;
  readonly outcome: SessionOutcome;
  readonly totalWagered: number;
  readonly totalPaid: number;
  readonly rollHistory: Roll[];
  readonly startedAt: Date;
}

/**
 * Data for logging a bet
 */
export interface LogBetData {
  readonly userId: string;
  readonly username: string;
  readonly betType: BetType;
  readonly amount: number;
  readonly outcome: 'won' | 'lost' | 'push';
  readonly payout: number;
}

/**
 * Data for updating player stats after a session
 */
export interface UpdateStatsData {
  readonly userId: string;
  readonly username: string;
  readonly wasShooter: boolean;
  readonly sessionOutcome: SessionOutcome;
  readonly rollCount: number;
  readonly bets: Array<{
    betType: BetType;
    amount: number;
    outcome: 'won' | 'lost' | 'push';
    payout: number;
  }>;
}

/**
 * Leaderboard category types
 */
export type LeaderboardCategory =
  | 'sessions'
  | 'profit'
  | 'biggest_win'
  | 'longest_roll'
  | 'pass_line_wins'
  | 'place_wins';

/**
 * Leaderboard entry
 */
export interface LeaderboardEntry {
  readonly user_id: string;
  readonly username: string;
  readonly sessions_played?: number;
  readonly net_profit?: number;
  readonly total_wagered?: number;
  readonly total_won?: number;
  readonly biggest_session_win?: number;
  readonly longest_roll_as_shooter?: number;
  readonly pass_line_wins?: number;
  readonly place_wins?: number;
}

// ============ SESSION LOGGING ============

/**
 * Log a completed session to the database
 * @returns The session ID for linking bets
 */
export async function logSession(data: LogSessionData): Promise<number> {
  const result = await sql<{ id: number }>`
    INSERT INTO craps_sessions (
      channel_id,
      shooter_user_id,
      shooter_username,
      point,
      roll_count,
      outcome,
      total_wagered,
      total_paid,
      roll_history,
      started_at
    ) VALUES (
      ${data.channelId},
      ${data.shooterUserId},
      ${data.shooterUsername},
      ${data.point},
      ${data.rollCount},
      ${data.outcome},
      ${data.totalWagered},
      ${data.totalPaid},
      ${JSON.stringify(data.rollHistory)},
      ${data.startedAt.toISOString()}
    )
    RETURNING id
  `;

  if (!result.rows[0]) {
    throw new Error('Failed to insert craps session - no ID returned');
  }

  return result.rows[0].id;
}

/**
 * Log bets for a completed session
 */
export async function logBets(sessionId: number, bets: LogBetData[]): Promise<void> {
  for (const bet of bets) {
    await sql`
      INSERT INTO craps_bets (
        session_id,
        user_id,
        username,
        bet_type,
        amount,
        outcome,
        payout
      ) VALUES (
        ${sessionId},
        ${bet.userId},
        ${bet.username},
        ${bet.betType},
        ${bet.amount},
        ${bet.outcome},
        ${bet.payout}
      )
    `;
  }
}

/**
 * Log a complete session with all bets
 */
export async function logCompleteSession(
  sessionData: LogSessionData,
  betsData: LogBetData[]
): Promise<number> {
  try {
    const sessionId = await logSession(sessionData);
    await logBets(sessionId, betsData);
    return sessionId;
  } catch (error) {
    console.error('[CRAPS] Failed to log session to database:', error);
    throw error;
  }
}

// ============ STATS MANAGEMENT ============

/**
 * Get or create a user's craps stats
 */
export async function getOrCreateStats(
  userId: string,
  username: string
): Promise<CrapsStats> {
  const result = await sql<CrapsStats>`
    INSERT INTO craps_stats (user_id, username, created_at)
    VALUES (${userId}, ${username}, NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      username = ${username}
    RETURNING *
  `;

  const stats = result.rows[0];
  if (!stats) {
    throw new Error(`Failed to get or create stats for user ${userId}`);
  }
  return stats;
}

/**
 * Get a user's craps stats
 */
export async function getUserStats(userId: string): Promise<CrapsStats | null> {
  const result = await sql<CrapsStats>`
    SELECT * FROM craps_stats
    WHERE user_id = ${userId}
    LIMIT 1
  `;
  return result.rows[0] ?? null;
}

/**
 * Update player stats after a session
 */
export async function updatePlayerStats(data: UpdateStatsData): Promise<CrapsStats> {
  // Calculate totals from bets
  const totalWagered = data.bets.reduce((sum, b) => sum + b.amount, 0);
  const totalPayout = data.bets.reduce((sum, b) => sum + b.payout, 0);
  const netResult = totalPayout - totalWagered;

  // Count by bet type
  const passLineBets = data.bets.filter(b => b.betType === 'pass_line').length;
  const passLineWins = data.bets.filter(b => b.betType === 'pass_line' && b.outcome === 'won').length;
  const dontPassBets = data.bets.filter(b => b.betType === 'dont_pass').length;
  const dontPassWins = data.bets.filter(b => b.betType === 'dont_pass' && b.outcome === 'won').length;
  const fieldBets = data.bets.filter(b => b.betType === 'field').length;
  const fieldWins = data.bets.filter(b => b.betType === 'field' && b.outcome === 'won').length;
  const placeBets = data.bets.filter(b => b.betType === 'place_6' || b.betType === 'place_8').length;
  const placeWins = data.bets.filter(b =>
    (b.betType === 'place_6' || b.betType === 'place_8') && b.outcome === 'won'
  ).length;

  // Find biggest single bet win
  const biggestBetWin = Math.max(0, ...data.bets.map(b => b.payout - b.amount));

  // Event counters
  const sevenOut = data.sessionOutcome === 'seven_out' ? 1 : 0;
  const pointHit = data.sessionOutcome === 'point_hit' ? 1 : 0;
  const natural = data.sessionOutcome === 'natural' ? 1 : 0;

  const result = await sql<CrapsStats>`
    INSERT INTO craps_stats (
      user_id, username, sessions_played, sessions_as_shooter,
      pass_line_bets, pass_line_wins, dont_pass_bets, dont_pass_wins,
      field_bets, field_wins, place_bets, place_wins,
      total_wagered, total_won, biggest_session_win, biggest_session_loss,
      biggest_single_bet_win, seven_outs_witnessed, points_hit_witnessed,
      naturals_witnessed, longest_roll_witnessed, longest_roll_as_shooter,
      points_hit_as_shooter, seven_outs_as_shooter, last_played_at, created_at
    )
    VALUES (
      ${data.userId}, ${data.username}, 1, ${data.wasShooter ? 1 : 0},
      ${passLineBets}, ${passLineWins}, ${dontPassBets}, ${dontPassWins},
      ${fieldBets}, ${fieldWins}, ${placeBets}, ${placeWins},
      ${totalWagered}, ${totalPayout},
      ${netResult > 0 ? netResult : 0},
      ${netResult < 0 ? netResult : 0},
      ${biggestBetWin}, ${sevenOut}, ${pointHit}, ${natural},
      ${data.rollCount},
      ${data.wasShooter ? data.rollCount : 0},
      ${data.wasShooter && pointHit ? 1 : 0},
      ${data.wasShooter && sevenOut ? 1 : 0},
      NOW(), NOW()
    )
    ON CONFLICT (user_id) DO UPDATE SET
      username = ${data.username},
      sessions_played = craps_stats.sessions_played + 1,
      sessions_as_shooter = craps_stats.sessions_as_shooter + ${data.wasShooter ? 1 : 0},
      pass_line_bets = craps_stats.pass_line_bets + ${passLineBets},
      pass_line_wins = craps_stats.pass_line_wins + ${passLineWins},
      dont_pass_bets = craps_stats.dont_pass_bets + ${dontPassBets},
      dont_pass_wins = craps_stats.dont_pass_wins + ${dontPassWins},
      field_bets = craps_stats.field_bets + ${fieldBets},
      field_wins = craps_stats.field_wins + ${fieldWins},
      place_bets = craps_stats.place_bets + ${placeBets},
      place_wins = craps_stats.place_wins + ${placeWins},
      total_wagered = craps_stats.total_wagered + ${totalWagered},
      total_won = craps_stats.total_won + ${totalPayout},
      biggest_session_win = CASE
        WHEN ${netResult} > craps_stats.biggest_session_win THEN ${netResult}
        ELSE craps_stats.biggest_session_win
      END,
      biggest_session_loss = CASE
        WHEN ${netResult} < craps_stats.biggest_session_loss THEN ${netResult}
        ELSE craps_stats.biggest_session_loss
      END,
      biggest_single_bet_win = CASE
        WHEN ${biggestBetWin} > craps_stats.biggest_single_bet_win THEN ${biggestBetWin}
        ELSE craps_stats.biggest_single_bet_win
      END,
      seven_outs_witnessed = craps_stats.seven_outs_witnessed + ${sevenOut},
      points_hit_witnessed = craps_stats.points_hit_witnessed + ${pointHit},
      naturals_witnessed = craps_stats.naturals_witnessed + ${natural},
      longest_roll_witnessed = CASE
        WHEN ${data.rollCount} > craps_stats.longest_roll_witnessed THEN ${data.rollCount}
        ELSE craps_stats.longest_roll_witnessed
      END,
      longest_roll_as_shooter = CASE
        WHEN ${data.wasShooter} AND ${data.rollCount} > craps_stats.longest_roll_as_shooter
        THEN ${data.rollCount}
        ELSE craps_stats.longest_roll_as_shooter
      END,
      points_hit_as_shooter = craps_stats.points_hit_as_shooter + ${data.wasShooter && pointHit ? 1 : 0},
      seven_outs_as_shooter = craps_stats.seven_outs_as_shooter + ${data.wasShooter && sevenOut ? 1 : 0},
      last_played_at = NOW()
    RETURNING *
  `;

  return result.rows[0];
}

// ============ HISTORY QUERIES ============

/**
 * Get recent sessions for history display
 */
export async function getRecentSessions(limit: number = 10): Promise<CrapsSessionRecord[]> {
  const result = await sql<CrapsSessionRecord>`
    SELECT
      id, channel_id, shooter_user_id, shooter_username,
      point, roll_count, outcome, total_wagered, total_paid,
      roll_history, started_at, ended_at
    FROM craps_sessions
    ORDER BY ended_at DESC
    LIMIT ${limit}
  `;
  return result.rows;
}

/**
 * Get a user's recent bets
 */
export async function getUserRecentBets(
  userId: string,
  limit: number = 20
): Promise<CrapsBetRecord[]> {
  const result = await sql<CrapsBetRecord>`
    SELECT
      id, session_id, user_id, username, bet_type,
      amount, outcome, payout, placed_at
    FROM craps_bets
    WHERE user_id = ${userId}
    ORDER BY placed_at DESC
    LIMIT ${limit}
  `;
  return result.rows;
}

// ============ LEADERBOARDS ============

/**
 * Get craps leaderboard by category
 */
export async function getLeaderboard(
  category: LeaderboardCategory,
  limit: number = 10
): Promise<LeaderboardEntry[]> {
  let result;

  switch (category) {
    case 'sessions':
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username, sessions_played,
          (total_won - total_wagered) as net_profit
        FROM craps_stats
        ORDER BY sessions_played DESC
        LIMIT ${limit}
      `;
      break;

    case 'profit':
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username,
          (total_won - total_wagered) as net_profit,
          total_wagered, total_won, sessions_played
        FROM craps_stats
        ORDER BY (total_won - total_wagered) DESC
        LIMIT ${limit}
      `;
      break;

    case 'biggest_win':
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username, biggest_session_win, sessions_played
        FROM craps_stats
        ORDER BY biggest_session_win DESC
        LIMIT ${limit}
      `;
      break;

    case 'longest_roll':
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username, longest_roll_as_shooter, sessions_played
        FROM craps_stats
        WHERE longest_roll_as_shooter > 0
        ORDER BY longest_roll_as_shooter DESC
        LIMIT ${limit}
      `;
      break;

    case 'pass_line_wins':
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username, pass_line_wins, pass_line_bets, sessions_played
        FROM craps_stats
        ORDER BY pass_line_wins DESC
        LIMIT ${limit}
      `;
      break;

    case 'place_wins':
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username, place_wins, place_bets, sessions_played
        FROM craps_stats
        ORDER BY place_wins DESC
        LIMIT ${limit}
      `;
      break;

    default:
      result = await sql<LeaderboardEntry>`
        SELECT user_id, username, sessions_played
        FROM craps_stats
        ORDER BY sessions_played DESC
        LIMIT ${limit}
      `;
  }

  return result.rows;
}

/**
 * Get a user's rank on a leaderboard
 */
export async function getUserRank(
  userId: string,
  category: LeaderboardCategory = 'sessions'
): Promise<number | null> {
  const stats = await getUserStats(userId);
  if (!stats) return null;

  let result;

  switch (category) {
    case 'sessions':
      result = await sql<{ rank: string }>`
        SELECT COUNT(*) + 1 as rank
        FROM craps_stats
        WHERE sessions_played > ${stats.sessions_played}
      `;
      break;

    case 'profit': {
      const netProfit = stats.total_won - stats.total_wagered;
      result = await sql<{ rank: string }>`
        SELECT COUNT(*) + 1 as rank
        FROM craps_stats
        WHERE (total_won - total_wagered) > ${netProfit}
      `;
      break;
    }

    case 'longest_roll':
      result = await sql<{ rank: string }>`
        SELECT COUNT(*) + 1 as rank
        FROM craps_stats
        WHERE longest_roll_as_shooter > ${stats.longest_roll_as_shooter}
      `;
      break;

    default:
      result = await sql<{ rank: string }>`
        SELECT COUNT(*) + 1 as rank
        FROM craps_stats
        WHERE sessions_played > ${stats.sessions_played}
      `;
  }

  return parseInt(result.rows[0]?.rank ?? '1', 10);
}

/**
 * Get total number of craps players
 */
export async function getTotalPlayers(): Promise<number> {
  const result = await sql<{ count: string }>`
    SELECT COUNT(*) as count FROM craps_stats
  `;
  return parseInt(result.rows[0]?.count ?? '0', 10);
}
