// Startup Refund Sweep
//
// Games hold coins in wager_escrow between taking a bet and resolving it. If the
// process dies in that window the player paid for an outcome they never received, so
// every row still 'open' at boot is returned.
//
// This runs once on ready, before players can interact, so there is no race with a
// live round: nothing can be opening escrow yet.

import type { Client } from 'discord.js';
import { sweepOpenEscrows, type RefundEntry, type SweepResult } from './escrowDb.js';
import { formatCurrency } from './economyConfig.js';

/**
 * Refund every wager left open by a previous run and tell the affected players.
 *
 * Never throws - a failure here must not prevent the bot from starting. A wager that
 * fails to sweep stays 'open' and will be caught by the next boot.
 */
export async function runStartupRefundSweep(client: Client): Promise<SweepResult | null> {
  try {
    const result: SweepResult = await sweepOpenEscrows();

    if (result.rowsRefunded === 0) {
      console.log('[SWEEP] No interrupted wagers to refund');
      return result;
    }

    console.log(
      `[SWEEP] Refunded ${result.totalRefunded} coins across ${result.rowsRefunded} wager(s) ` +
        `to ${result.byUser.length} player(s)`
    );

    await notifyRefundedPlayers(client, result.byUser);

    return result;
  } catch (error: unknown) {
    console.error('[SWEEP] Startup refund sweep failed; wagers remain open:', error);
    return null;
  }
}

/**
 * DM each player whose wager was returned.
 *
 * Best effort by design: a closed DM channel is common and must not fail the sweep.
 * The money has already moved by the time this runs - the DM is only a courtesy.
 */
async function notifyRefundedPlayers(
  client: Client,
  entries: readonly RefundEntry[]
): Promise<void> {
  for (const entry of entries) {
    try {
      const user = await client.users.fetch(entry.userId);
      await user.send(
        `A restart interrupted your ${entry.game} game before it finished. ` +
          `${formatCurrency(entry.amount)} has been returned to your wallet.`
      );
    } catch {
      // DMs closed, user left the server, or fetch failed - the refund still stands.
      console.log(`[SWEEP] Could not DM ${entry.username} about their ${entry.amount} refund`);
    }
  }
}
