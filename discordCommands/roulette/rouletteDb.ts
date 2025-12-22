// Roulette Database Operations
// Logging completed rounds and bets for history/stats

import { sql } from '@vercel/postgres';

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
    values.push(
      roundId,
      bet.userId,
      bet.username,
      bet.betType,
      bet.amount,
      bet.won,
      bet.returned
    );
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
