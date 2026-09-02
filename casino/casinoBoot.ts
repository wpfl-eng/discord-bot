// Casino Boot
//
// Brings the tables back after a restart.
//
// ORDERING MATTERS. This must run AFTER `runStartupRefundSweep`. A restored table opens
// a fresh round, and the sweep is what returns the stakes the interrupted round was
// holding - restoring first would leave those wagers open against a table that has moved
// on, and the next boot's sweep would be the first thing to notice.
//
// Games are imported lazily so this module stays free of the command-loading order: it
// runs from the ready handler, by which point every command module has been imported and
// registered itself.

import type { Client } from 'discord.js';

/** One game's restore entry point. */
interface Restorable {
  readonly label: string;
  restore(client: Client): Promise<boolean>;
}

/**
 * Restore every table that has durable state.
 *
 * Roulette is absent by design - it holds nothing between spins, and reopens on the next
 * bet with its history already seeded from the database.
 *
 * Never throws: a table that cannot be restored simply does not open, and the first
 * player to bet opens a fresh one.
 */
export async function restoreCasinoTables(client: Client): Promise<number> {
  const games: Restorable[] = [];

  try {
    const blackjack = await import('../discordCommands/blackjack/blackjackState.js');
    games.push({ label: 'blackjack', restore: blackjack.restoreState });
  } catch (error: unknown) {
    console.error('[BOOT] Could not load blackjack for restore:', error);
  }

  try {
    const craps = await import('../discordCommands/craps/crapsState.js');
    games.push({ label: 'craps', restore: craps.restoreState });
  } catch (error: unknown) {
    console.error('[BOOT] Could not load craps for restore:', error);
  }

  let restored = 0;

  for (const game of games) {
    try {
      const ok: boolean = await game.restore(client);
      if (ok) {
        restored += 1;
        console.log(`[BOOT] Restored the ${game.label} table`);
      }
    } catch (error: unknown) {
      console.error(`[BOOT] Failed to restore ${game.label}; it will open on demand:`, error);
    }
  }

  if (restored === 0) console.log('[BOOT] No casino tables to restore');
  return restored;
}
