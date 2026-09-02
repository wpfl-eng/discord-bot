// Wager Escrow Operations
//
// Every coin a game takes off a player before the outcome is known goes through here.
// The wallet debit and the escrow row are written in one transaction, so there is no
// window in which money has left a wallet without a record of why.
//
// Previously roulette deducted first and only wrote to the database after the wheel
// stopped, so a crash between those two points destroyed the wager silently. Rows
// left 'open' at boot are exactly that failure case, and sweepOpenEscrows refunds them.

import { sql } from '@vercel/postgres';
// Side-effect import: registers the int8 parser so the BIGINT money columns
// decode as numbers rather than strings. Must load before any query runs.
import '../db/pgTypes.js';

import type { EconomyUser } from '../types/database.js';

// ============ TYPES ============

export type EscrowGame = 'roulette' | 'blackjack' | 'craps';
export type EscrowPurpose = 'bet' | 'double' | 'split' | 'insurance' | 'odds' | 'sidebet';
export type EscrowStatus = 'open' | 'settled' | 'voided' | 'refunded';

export interface OpenEscrowData {
  readonly userId: string;
  readonly username: string;
  readonly game: EscrowGame;
  /** Groups every row for one round or hand so it can be resolved as a unit */
  readonly sessionKey: string;
  readonly amount: number;
  readonly purpose?: EscrowPurpose;
  /** Game-specific context kept for stats and debugging */
  readonly detail?: Record<string, unknown>;
}

export interface OpenEscrowResult {
  /** false when the wallet could not cover the amount - nothing was written */
  readonly ok: boolean;
  readonly escrowId: number | null;
  readonly user: EconomyUser | null;
}

export interface RefundEntry {
  readonly userId: string;
  readonly username: string;
  readonly game: string;
  readonly amount: number;
}

export interface SweepResult {
  readonly rowsRefunded: number;
  readonly totalRefunded: number;
  /** One entry per user, amounts already summed across their open rows */
  readonly byUser: readonly RefundEntry[];
}

// ============ OPENING ============

/**
 * Take coins from a wallet and record them as at-risk, atomically.
 *
 * Mirrors gambleLose's accounting (wallet down, total_lost up) so a wager that is
 * later refunded can reverse cleanly.
 *
 * @returns ok:false with nothing written if the wallet cannot cover the amount
 */
export async function openEscrow(data: OpenEscrowData): Promise<OpenEscrowResult> {
  if (!Number.isInteger(data.amount) || data.amount <= 0) {
    return { ok: false, escrowId: null, user: null };
  }

  const client = await sql.connect();
  try {
    await client.query('BEGIN');

    // Atomic guard: the WHERE clause is what prevents overdrawing under concurrency.
    const walletResult = await client.query<EconomyUser>(
      `UPDATE economy_users
          SET wallet = wallet - $1,
              total_lost = total_lost + $1
        WHERE user_id = $2
          AND wallet >= $1
        RETURNING *`,
      [data.amount, data.userId]
    );

    if (!walletResult.rows[0]) {
      await client.query('ROLLBACK');
      return { ok: false, escrowId: null, user: null };
    }

    const escrowResult = await client.query<{ id: number }>(
      `INSERT INTO wager_escrow
         (user_id, username, game, session_key, purpose, amount, detail)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        data.userId,
        data.username,
        data.game,
        data.sessionKey,
        data.purpose ?? 'bet',
        data.amount,
        data.detail ? JSON.stringify(data.detail) : null,
      ]
    );

    await client.query('COMMIT');

    return {
      ok: true,
      escrowId: escrowResult.rows[0]?.id ?? null,
      user: walletResult.rows[0],
    };
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// ============ SETTLING ============

/**
 * Mark rows resolved. Call after the game has paid out (or confirmed a loss) -
 * settling moves no money, it only records that the outcome is known.
 *
 * @returns number of rows that were still open and are now settled
 */
export async function settleSession(game: EscrowGame, sessionKey: string): Promise<number> {
  const result = await sql`
    UPDATE wager_escrow
       SET status = 'settled', closed_at = NOW()
     WHERE game = ${game}
       AND session_key = ${sessionKey}
       AND status = 'open'
  `;
  return result.rowCount ?? 0;
}

/**
 * Mark specific rows resolved by id.
 *
 * Used where some rows in a session must stay open - a payout that failed to credit
 * must NOT be settled, so the startup sweep can still return the stake.
 *
 * @returns number of rows that were still open and are now settled
 */
export async function settleEscrowIds(escrowIds: readonly number[]): Promise<number> {
  if (escrowIds.length === 0) return 0;

  // The tagged-template helper only binds scalars, so an array parameter needs the
  // raw client.
  const client = await sql.connect();
  try {
    const result = await client.query(
      `UPDATE wager_escrow
          SET status = 'settled', closed_at = NOW()
        WHERE id = ANY($1::int[])
          AND status = 'open'`,
      [[...escrowIds]]
    );
    return result.rowCount ?? 0;
  } finally {
    client.release();
  }
}

// ============ VOIDING ============

/**
 * Return a single wager to its owner and mark it voided - the Undo path.
 *
 * The `status = 'open'` guard makes this idempotent: a double-click, or a race with
 * the round resolving, refunds at most once.
 *
 * @returns the updated user, or null if the row was already resolved
 */
export async function voidEscrow(escrowId: number, userId: string): Promise<EconomyUser | null> {
  const client = await sql.connect();
  try {
    await client.query('BEGIN');

    const claimed = await client.query<{ amount: number }>(
      `UPDATE wager_escrow
          SET status = 'voided', closed_at = NOW()
        WHERE id = $1
          AND user_id = $2
          AND status = 'open'
        RETURNING amount`,
      [escrowId, userId]
    );

    const row = claimed.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return null;
    }

    const walletResult = await client.query<EconomyUser>(
      `UPDATE economy_users
          SET wallet = wallet + $1,
              total_lost = GREATEST(total_lost - $1, 0)
        WHERE user_id = $2
        RETURNING *`,
      [row.amount, userId]
    );

    await client.query('COMMIT');
    return walletResult.rows[0] ?? null;
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Return every open wager in a session to its owners - used when a table closes or a
 * hand is abandoned without ever resolving.
 */
export async function voidSession(game: EscrowGame, sessionKey: string): Promise<SweepResult> {
  return refundWhere(
    `game = $1 AND session_key = $2 AND status = 'open'`,
    [game, sessionKey],
    'voided'
  );
}

/**
 * Return a specific set of open wagers to one player, in a single transaction.
 *
 * Clearing a roulette slip voids every chip at once; doing that one row at a time cost
 * a transaction and a wallet write per chip. The same `status = 'open'` guard makes it
 * idempotent, so a double click still refunds once.
 */
export async function voidEscrowIds(
  escrowIds: readonly number[],
  userId: string
): Promise<SweepResult> {
  if (escrowIds.length === 0) {
    return { rowsRefunded: 0, totalRefunded: 0, byUser: [] };
  }

  return refundWhere(
    `id = ANY($1::int[]) AND user_id = $2 AND status = 'open'`,
    [[...escrowIds], userId],
    'voided'
  );
}

// ============ STARTUP SWEEP ============

/**
 * Refund every wager still open at boot.
 *
 * Anything open here belongs to a round or hand that a restart ended early, so the
 * player never got the outcome they paid for.
 */
export async function sweepOpenEscrows(): Promise<SweepResult> {
  return refundWhere(`status = 'open'`, [], 'refunded');
}

// ============ INTERNAL ============

/**
 * Claim matching open rows and return their coins, in a single transaction.
 *
 * The CTE claims and credits together so a concurrent sweep or void cannot refund the
 * same row twice: whichever transaction claims the row first is the only one that
 * sees it, because the others no longer match `status = 'open'`.
 */
async function refundWhere(
  whereClause: string,
  params: unknown[],
  newStatus: 'voided' | 'refunded'
): Promise<SweepResult> {
  const client = await sql.connect();
  try {
    await client.query('BEGIN');

    const result = await client.query<RefundRow>(
      `WITH claimed AS (
         UPDATE wager_escrow
            SET status = $${params.length + 1}, closed_at = NOW()
          WHERE ${whereClause}
         RETURNING user_id, username, game, amount
       ), totals AS (
         SELECT user_id, SUM(amount)::bigint AS total
           FROM claimed
          GROUP BY user_id
       ), applied AS (
         UPDATE economy_users u
            SET wallet = u.wallet + t.total,
                total_lost = GREATEST(u.total_lost - t.total, 0)
           FROM totals t
          WHERE u.user_id = t.user_id
         RETURNING u.user_id
       )
       SELECT user_id, username, game, amount FROM claimed`,
      [...params, newStatus]
    );

    await client.query('COMMIT');

    return summarise(result.rows);
  } catch (error: unknown) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

interface RefundRow {
  user_id: string;
  username: string;
  game: string;
  amount: number;
}

/**
 * Collapse claimed rows into one entry per user.
 */
function summarise(rows: readonly RefundRow[]): SweepResult {
  const byUser = new Map<string, RefundEntry>();
  let totalRefunded = 0;

  for (const row of rows) {
    totalRefunded += row.amount;
    const existing: RefundEntry | undefined = byUser.get(row.user_id);
    byUser.set(row.user_id, {
      userId: row.user_id,
      username: row.username,
      game: existing ? existing.game : row.game,
      amount: (existing?.amount ?? 0) + row.amount,
    });
  }

  return {
    rowsRefunded: rows.length,
    totalRefunded,
    byUser: [...byUser.values()],
  };
}
