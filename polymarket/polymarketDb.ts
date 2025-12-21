// Polymarket Database Operations
// Handles placing, querying, and resolving prediction bets

import { sql } from '@vercel/postgres';
import * as economyDb from '../economy/economyDb.js';
import { CONFIG, calculatePayout } from './polymarketConfig.js';
import type {
  PredictionBet,
  PlaceBetResult,
  MarketDisplay,
  OutcomeDisplay,
} from './polymarketTypes.js';

// ============ Place Bet ============

/**
 * Place a new prediction bet
 * Atomically deducts coins and creates bet record
 */
export async function placeBet(
  userId: string,
  username: string,
  market: MarketDisplay,
  outcome: OutcomeDisplay,
  coinsWagered: number
): Promise<PlaceBetResult> {
  // Validate amount
  if (coinsWagered < CONFIG.MIN_BET || coinsWagered > CONFIG.MAX_BET) {
    return { success: false, error: 'INVALID_AMOUNT' };
  }

  // Check market is still open
  if (market.closed) {
    return { success: false, error: 'MARKET_CLOSED' };
  }

  // Ensure user exists
  await economyDb.getOrCreateUser(userId, username);

  // Deduct coins atomically
  const updatedUser = await economyDb.deductFromWallet(userId, coinsWagered);
  if (!updatedUser) {
    return { success: false, error: 'INSUFFICIENT_FUNDS' };
  }

  // Calculate potential payout
  const potentialPayout = calculatePayout(coinsWagered, outcome.price);

  // Create bet record
  try {
    const result = await sql<PredictionBet>`
      INSERT INTO prediction_bets (
        user_id,
        market_id,
        market_slug,
        market_question,
        outcome_name,
        clob_token_id,
        coins_wagered,
        locked_odds,
        potential_payout,
        expires_at
      ) VALUES (
        ${userId},
        ${market.id},
        ${market.slug},
        ${market.question},
        ${outcome.name},
        ${outcome.clobTokenId},
        ${coinsWagered},
        ${outcome.price},
        ${potentialPayout},
        ${market.endDate.toISOString()}
      )
      RETURNING *
    `;

    if (result.rows.length === 0) {
      // Rollback: refund coins
      await economyDb.addToWallet(userId, coinsWagered);
      return { success: false, error: 'INSUFFICIENT_FUNDS' };
    }

    return { success: true, bet: result.rows[0] };
  } catch (error) {
    // Rollback: refund coins
    await economyDb.addToWallet(userId, coinsWagered);
    console.error('Error placing bet:', error);
    throw error;
  }
}

// ============ Query Operations ============

/**
 * Get all open bets for a user
 */
export async function getOpenBets(userId: string): Promise<PredictionBet[]> {
  const result = await sql<PredictionBet>`
    SELECT * FROM prediction_bets
    WHERE user_id = ${userId}
      AND status = 'open'
    ORDER BY placed_at DESC
  `;
  return result.rows;
}

/**
 * Get all bets for a user (any status)
 */
export async function getAllBets(
  userId: string,
  limit: number = 50
): Promise<PredictionBet[]> {
  const result = await sql<PredictionBet>`
    SELECT * FROM prediction_bets
    WHERE user_id = ${userId}
    ORDER BY placed_at DESC
    LIMIT ${limit}
  `;
  return result.rows;
}

/**
 * Get bet by ID
 */
export async function getBetById(betId: number): Promise<PredictionBet | null> {
  const result = await sql<PredictionBet>`
    SELECT * FROM prediction_bets
    WHERE id = ${betId}
  `;
  return result.rows[0] ?? null;
}

/**
 * Get unique market IDs from user's open bets
 */
export async function getOpenMarketIds(userId: string): Promise<string[]> {
  const result = await sql<{ market_id: string }>`
    SELECT DISTINCT market_id FROM prediction_bets
    WHERE user_id = ${userId}
      AND status = 'open'
  `;
  return result.rows.map((r) => r.market_id);
}

/**
 * Count user's won bets (for achievements)
 */
export async function countWonBets(userId: string): Promise<number> {
  const result = await sql<{ count: string }>`
    SELECT COUNT(*) as count FROM prediction_bets
    WHERE user_id = ${userId}
      AND status = 'won'
  `;
  return parseInt(result.rows[0]?.count ?? '0', 10);
}

// ============ Resolution Operations ============

/**
 * Resolve a bet as won
 */
export async function resolveBetWon(
  betId: number,
  payout: number
): Promise<PredictionBet | null> {
  const result = await sql<PredictionBet>`
    UPDATE prediction_bets
    SET status = 'won',
        payout = ${payout},
        resolved_at = NOW()
    WHERE id = ${betId}
      AND status = 'open'
    RETURNING *
  `;
  return result.rows[0] ?? null;
}

/**
 * Resolve a bet as lost
 */
export async function resolveBetLost(betId: number): Promise<PredictionBet | null> {
  const result = await sql<PredictionBet>`
    UPDATE prediction_bets
    SET status = 'lost',
        payout = 0,
        resolved_at = NOW()
    WHERE id = ${betId}
      AND status = 'open'
    RETURNING *
  `;
  return result.rows[0] ?? null;
}

/**
 * Resolve a bet as voided (refund)
 */
export async function resolveBetVoided(
  betId: number,
  refundAmount: number
): Promise<PredictionBet | null> {
  const result = await sql<PredictionBet>`
    UPDATE prediction_bets
    SET status = 'voided',
        payout = ${refundAmount},
        resolved_at = NOW()
    WHERE id = ${betId}
      AND status = 'open'
    RETURNING *
  `;
  return result.rows[0] ?? null;
}

/**
 * Settle a bet and update wallet
 * Returns the updated bet and payout amount
 */
export async function settleBet(
  bet: PredictionBet,
  won: boolean,
  voided: boolean = false
): Promise<{ bet: PredictionBet; payout: number } | null> {
  let updatedBet: PredictionBet | null = null;
  let payout = 0;

  if (voided) {
    // Refund original wager
    payout = bet.coins_wagered;
    updatedBet = await resolveBetVoided(bet.id, payout);
    if (updatedBet) {
      await economyDb.addToWallet(bet.user_id, payout);
    }
  } else if (won) {
    // Pay out winnings
    payout = bet.potential_payout;
    updatedBet = await resolveBetWon(bet.id, payout);
    if (updatedBet) {
      await economyDb.addToWallet(bet.user_id, payout);
    }
  } else {
    // Lost - no payout, just update status
    payout = 0;
    updatedBet = await resolveBetLost(bet.id);
  }

  if (!updatedBet) return null;
  return { bet: updatedBet, payout };
}

// ============ Statistics ============

/**
 * Get user's prediction stats
 */
export async function getUserStats(userId: string): Promise<{
  totalBets: number;
  openBets: number;
  wonBets: number;
  lostBets: number;
  voidedBets: number;
  totalWagered: number;
  totalPayout: number;
  netProfit: number;
}> {
  const result = await sql<{
    total_bets: string;
    open_bets: string;
    won_bets: string;
    lost_bets: string;
    voided_bets: string;
    total_wagered: string;
    total_payout: string;
  }>`
    SELECT
      COUNT(*) as total_bets,
      COUNT(*) FILTER (WHERE status = 'open') as open_bets,
      COUNT(*) FILTER (WHERE status = 'won') as won_bets,
      COUNT(*) FILTER (WHERE status = 'lost') as lost_bets,
      COUNT(*) FILTER (WHERE status = 'voided') as voided_bets,
      COALESCE(SUM(coins_wagered), 0) as total_wagered,
      COALESCE(SUM(payout), 0) as total_payout
    FROM prediction_bets
    WHERE user_id = ${userId}
  `;

  const row = result.rows[0];
  const totalWagered = parseInt(row?.total_wagered ?? '0', 10);
  const totalPayout = parseInt(row?.total_payout ?? '0', 10);

  return {
    totalBets: parseInt(row?.total_bets ?? '0', 10),
    openBets: parseInt(row?.open_bets ?? '0', 10),
    wonBets: parseInt(row?.won_bets ?? '0', 10),
    lostBets: parseInt(row?.lost_bets ?? '0', 10),
    voidedBets: parseInt(row?.voided_bets ?? '0', 10),
    totalWagered,
    totalPayout,
    netProfit: totalPayout - totalWagered,
  };
}
