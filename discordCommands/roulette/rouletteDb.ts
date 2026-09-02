// Roulette Database Operations
// Logging completed rounds and bets for history/stats

import { sql } from '@vercel/postgres';
// Side-effect import: registers the int8 parser so SUM()/COUNT() aggregates decode as
// numbers rather than strings.
import '../../db/pgTypes.js';

// ============ TYPES ============

export interface RouletteRoundRecord {
  id: number;
  result_number: string;
  result_color: string;
  total_wagered: number;
  total_paid: number;
  bet_count: number;
  player_count: number;
  spun_at: Date;
}

export interface RouletteBetRecord {
  id: number;
  round_id: number;
  user_id: string;
  username: string;
  bet_type: string;
  amount: number;
  won: boolean;
  returned: number;
  placed_at: Date;
}

export interface LogRoundData {
  resultNumber: string;
  resultColor: string;
  totalWagered: number;
  totalPaid: number;
  betCount: number;
  playerCount: number;
}

export interface LogBetData {
  userId: string;
  username: string;
  betType: string;
  amount: number;
  won: boolean;
  returned: number;
}

// ============ LOGGING OPERATIONS ============

/**
 * Log a completed round to the database
 * @returns The round ID for linking bets
 */
export async function logRound(data: LogRoundData): Promise<number> {
  const result = await sql<{ id: number }>`
    INSERT INTO roulette_rounds (
      result_number,
      result_color,
      total_wagered,
      total_paid,
      bet_count,
      player_count
    ) VALUES (
      ${data.resultNumber},
      ${data.resultColor},
      ${data.totalWagered},
      ${data.totalPaid},
      ${data.betCount},
      ${data.playerCount}
    )
    RETURNING id
  `;
  if (!result.rows[0]) {
    throw new Error('Failed to insert roulette round - no ID returned');
  }
  return result.rows[0].id;
}

/**
 * Log bets for a completed round
 * Uses batch INSERT to reduce N round-trips to 1
 */
export async function logBets(roundId: number, bets: LogBetData[]): Promise<void> {
  if (bets.length === 0) return;

  // Build parameterized multi-row insert
  const values: unknown[] = [];
  const placeholders: string[] = [];

  bets.forEach((bet, i) => {
    const offset = i * 7;
    placeholders.push(
      `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7})`
    );
    values.push(roundId, bet.userId, bet.username, bet.betType, bet.amount, bet.won, bet.returned);
  });

  const client = await sql.connect();
  try {
    await client.query(
      `INSERT INTO roulette_bets (round_id, user_id, username, bet_type, amount, won, returned)
       VALUES ${placeholders.join(', ')}`,
      values
    );
  } finally {
    client.release();
  }
}

/**
 * Log a complete round with all bets
 */
export async function logCompleteRound(
  roundData: LogRoundData,
  betsData: LogBetData[]
): Promise<number> {
  try {
    const roundId = await logRound(roundData);
    await logBets(roundId, betsData);
    return roundId;
  } catch (error) {
    console.error('[ROULETTE] Failed to log round to database:', error);
    throw error;
  }
}

// ============ QUERY OPERATIONS ============

/**
 * Get recent roulette rounds for history display
 */
export async function getRecentRounds(limit: number): Promise<RouletteRoundRecord[]> {
  const result = await sql<RouletteRoundRecord>`
    SELECT
      id,
      result_number,
      result_color,
      total_wagered,
      total_paid,
      bet_count,
      player_count,
      spun_at
    FROM roulette_rounds
    ORDER BY spun_at DESC
    LIMIT ${limit}
  `;
  return result.rows;
}

// ============ STATS ============

export interface RouletteUserStats {
  readonly betCount: number;
  readonly spins: number;
  readonly wagered: number;
  readonly returned: number;
  readonly net: number;
  /** Returned as a share of wagered; null when nothing has been wagered */
  readonly rtp: number | null;
  readonly wins: number;
  readonly biggestHit: number;
  readonly biggestHitBet: string | null;
  readonly favouriteBet: string | null;
  readonly favouriteBetShare: number | null;
  readonly luckiestPocket: string | null;
  readonly luckiestPocketHits: number;
}

/**
 * Lifetime figures for one player.
 *
 * Reads roulette_bets directly rather than maintaining a rollup: a league-sized table
 * aggregates in milliseconds, and a rollup is one more thing that can drift from the
 * truth. Only settled bets ever reach this table - stakes still at risk live in
 * wager_escrow - so every row here has a known outcome.
 */
export async function getUserStats(userId: string): Promise<RouletteUserStats> {
  // Four independent read-only queries; one round-trip of latency instead of four.
  const [totals, biggest, favourite, luckiest] = await Promise.all([
    sql<{
      bet_count: number;
      spins: number;
      wagered: number;
      returned: number;
      wins: number;
    }>`
    SELECT
      COUNT(*)::int                                        AS bet_count,
      COUNT(DISTINCT round_id)::int                        AS spins,
      COALESCE(SUM(amount), 0)::bigint                     AS wagered,
      COALESCE(SUM(returned), 0)::bigint                   AS returned,
      COUNT(*) FILTER (WHERE won)::int                     AS wins
    FROM roulette_bets
    WHERE user_id = ${userId}
  `,
    sql<{ profit: number; bet_type: string }>`
    SELECT (returned - amount)::bigint AS profit, bet_type
      FROM roulette_bets
     WHERE user_id = ${userId} AND won
     ORDER BY (returned - amount) DESC
     LIMIT 1
  `,
    sql<{ bet_type: string; uses: number }>`
    SELECT bet_type, COUNT(*)::int AS uses
      FROM roulette_bets
     WHERE user_id = ${userId}
     GROUP BY bet_type
     ORDER BY uses DESC, bet_type ASC
     LIMIT 1
  `,
    // The pocket this player has won on most often.
    sql<{ result_number: string; hits: number }>`
    SELECT r.result_number, COUNT(*)::int AS hits
      FROM roulette_bets b
      JOIN roulette_rounds r ON r.id = b.round_id
     WHERE b.user_id = ${userId} AND b.won
     GROUP BY r.result_number
     ORDER BY hits DESC, r.result_number ASC
     LIMIT 1
  `,
  ]);

  const row = totals.rows[0];
  const favouriteRow = favourite.rows[0];
  const wagered: number = Number(row?.wagered ?? 0);
  const returned: number = Number(row?.returned ?? 0);
  const betCount: number = Number(row?.bet_count ?? 0);

  return {
    betCount,
    spins: Number(row?.spins ?? 0),
    wagered,
    returned,
    net: returned - wagered,
    rtp: wagered > 0 ? returned / wagered : null,
    wins: Number(row?.wins ?? 0),
    biggestHit: Number(biggest.rows[0]?.profit ?? 0),
    biggestHitBet: biggest.rows[0]?.bet_type ?? null,
    favouriteBet: favouriteRow?.bet_type ?? null,
    favouriteBetShare: favouriteRow && betCount > 0 ? Number(favouriteRow.uses) / betCount : null,
    luckiestPocket: luckiest.rows[0]?.result_number ?? null,
    luckiestPocketHits: Number(luckiest.rows[0]?.hits ?? 0),
  };
}

// ============ LEADERBOARD ============

export type RouletteLeaderboardCategory = 'net' | 'wagered' | 'biggest' | 'rtp';

export interface RouletteLeaderboardEntry {
  readonly userId: string;
  readonly username: string;
  readonly value: number;
  readonly betCount: number;
}

/**
 * A single lucky spin can produce a 3600% return, so the RTP board requires a minimum
 * sample before a player is ranked - otherwise it just surfaces whoever bet once and won.
 */
const MIN_BETS_FOR_RTP = 25;

export async function getLeaderboard(
  category: RouletteLeaderboardCategory,
  limit: number = 10
): Promise<RouletteLeaderboardEntry[]> {
  // Each branch is a separate tagged template so the ordering expression is never
  // built from interpolated text.
  switch (category) {
    case 'net': {
      const result = await sql<RouletteLeaderboardEntry & { value: number; bet_count: number }>`
        SELECT user_id AS "userId",
               MAX(username) AS username,
               (COALESCE(SUM(returned), 0) - COALESCE(SUM(amount), 0))::bigint AS value,
               COUNT(*)::int AS "betCount"
          FROM roulette_bets
         GROUP BY user_id
         ORDER BY value DESC
         LIMIT ${limit}
      `;
      return result.rows;
    }
    case 'wagered': {
      const result = await sql<RouletteLeaderboardEntry & { bet_count: number }>`
        SELECT user_id AS "userId",
               MAX(username) AS username,
               COALESCE(SUM(amount), 0)::bigint AS value,
               COUNT(*)::int AS "betCount"
          FROM roulette_bets
         GROUP BY user_id
         ORDER BY value DESC
         LIMIT ${limit}
      `;
      return result.rows;
    }
    case 'biggest': {
      const result = await sql<RouletteLeaderboardEntry & { bet_count: number }>`
        SELECT user_id AS "userId",
               MAX(username) AS username,
               COALESCE(MAX(returned - amount), 0)::bigint AS value,
               COUNT(*)::int AS "betCount"
          FROM roulette_bets
         WHERE won
         GROUP BY user_id
         ORDER BY value DESC
         LIMIT ${limit}
      `;
      return result.rows;
    }
    case 'rtp': {
      const result = await sql<RouletteLeaderboardEntry & { bet_count: number }>`
        SELECT user_id AS "userId",
               MAX(username) AS username,
               (COALESCE(SUM(returned), 0)::numeric / NULLIF(SUM(amount), 0)) AS value,
               COUNT(*)::int AS "betCount"
          FROM roulette_bets
         GROUP BY user_id
        HAVING COUNT(*) >= ${MIN_BETS_FOR_RTP}
         ORDER BY value DESC
         LIMIT ${limit}
      `;
      return result.rows.map((r) => ({ ...r, value: Number(r.value) }));
    }
  }
}

/** Minimum bets required to appear on the RTP board, for display in the footer. */
export const RTP_MIN_BETS = MIN_BETS_FOR_RTP;
