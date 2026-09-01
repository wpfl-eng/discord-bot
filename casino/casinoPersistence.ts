// Casino Table Persistence
//
// Tables run in memory. This module is what survives a restart.
//
// WHAT IS SAVED, AND WHAT IS NOT
//
// Only BETWEEN-ROUND state: who is seated and for how much, the shoe and where its cut
// card is, the craps shooter queue, session totals. Nothing mid-round is serialised.
//
// That boundary is deliberate. A half-played hand is the hardest thing to store and the
// easiest to store wrongly, and it does not need to be stored at all: every wager is
// escrow-backed, so `runStartupRefundSweep` returns anything that was at risk when the
// process died. Money is always correct; the round is simply redealt.
//
// What persisting buys is continuity - a player comes back still seated for the stake
// they chose, and the shoe carries on from where it was, which matters because counting
// it is meaningful now.

import { sql } from '@vercel/postgres';

/**
 * Games with durable between-round state.
 *
 * Roulette is absent on purpose: nobody holds a seat, a riding stake or a shoe between
 * spins, and its recent-spins strip is already durable in `roulette_rounds`. A snapshot
 * would be a second store for the same history.
 */
export type CasinoGame = 'craps' | 'blackjack';

export interface TableSnapshot<S> {
  readonly channelId: string;
  readonly state: S;
  readonly savedAt: Date;
}

/**
 * How stale a snapshot may be before it is ignored.
 *
 * A table nobody has touched for an hour is not a table anyone is waiting to rejoin,
 * and restoring it would reopen a room that had gone quiet on purpose.
 */
export const SNAPSHOT_MAX_AGE_MS = 60 * 60 * 1000;

interface StateRow {
  channel_id: string;
  state: unknown;
  saved_at: Date;
}

/**
 * Write a game's between-round state.
 *
 * Never throws: persistence is a convenience, and a database blip must not interrupt a
 * live table.
 */
export async function saveTableState<S>(
  game: CasinoGame,
  channelId: string,
  state: S
): Promise<boolean> {
  try {
    await sql`
      INSERT INTO casino_table_state (game, channel_id, state, saved_at)
      VALUES (${game}, ${channelId}, ${JSON.stringify(state)}::jsonb, NOW())
      ON CONFLICT (game) DO UPDATE
        SET channel_id = EXCLUDED.channel_id,
            state      = EXCLUDED.state,
            saved_at   = NOW()
    `;
    return true;
  } catch (error: unknown) {
    console.error(`[PERSIST] Failed to save ${game} state:`, error);
    return false;
  }
}

/**
 * Read a game's saved state.
 *
 * @returns null when there is nothing saved, it is too old, or the read failed
 */
export async function loadTableState<S>(game: CasinoGame): Promise<TableSnapshot<S> | null> {
  try {
    const result = await sql<StateRow>`
      SELECT channel_id, state, saved_at
        FROM casino_table_state
       WHERE game = ${game}
    `;

    const row = result.rows[0];
    if (!row) return null;

    const savedAt = new Date(row.saved_at);
    if (Date.now() - savedAt.getTime() > SNAPSHOT_MAX_AGE_MS) {
      console.log(`[PERSIST] ${game} snapshot is stale; ignoring`);
      return null;
    }

    return { channelId: row.channel_id, state: row.state as S, savedAt };
  } catch (error: unknown) {
    // A missing table is the common case on a database that has not run migration 013.
    console.error(`[PERSIST] Failed to load ${game} state:`, error);
    return null;
  }
}

/** Drop a game's saved state, so it does not reopen next boot. */
export async function clearTableState(game: CasinoGame): Promise<void> {
  try {
    await sql`DELETE FROM casino_table_state WHERE game = ${game}`;
  } catch (error: unknown) {
    console.error(`[PERSIST] Failed to clear ${game} state:`, error);
  }
}

// ============ SNAPSHOT SHAPES ============

/**
 * A blackjack seat between rounds.
 *
 * Hands are absent by design - anything mid-round is refunded rather than restored.
 */
export interface SeatSnapshot {
  readonly userId: string;
  readonly username: string;
  readonly stake: number;
  readonly sideBets: { readonly pairs: number; readonly p3: number };
}

export interface BlackjackSnapshot {
  readonly seats: readonly SeatSnapshot[];
  /**
   * The shoe as an ordered list of cards plus its shuffle flag.
   *
   * Worth persisting specifically because the table runs one shoe and counting it is
   * possible; a shoe that silently reset on every restart would invalidate any count.
   */
  readonly shoe: { readonly cards: readonly { suit: string; rank: string }[] };
  readonly roundCount: number;
}

export interface CrapsSnapshot {
  /** The shooter rotation, in arrival order */
  readonly queue: readonly { readonly userId: string; readonly username: string }[];
  readonly shooterUserId: string | null;
  /**
   * Roll totals only, for the strip. The point is deliberately NOT restored: it belongs
   * to a shooter's turn whose bets have just been refunded, so that turn is void.
   */
  readonly recentRolls: readonly number[];
}
