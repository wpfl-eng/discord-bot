// Blackjack Command
//
// Entry point only: option parsing, wallet validation, and registering the button
// router. Rules live in blackjackEngine, live hands and handlers in blackjackState,
// and every view in blackjackRender - the same layout roulette and craps already use.

import { SlashCommandBuilder, type ChatInputCommandInteraction } from 'discord.js';
import * as economyDb from '../../economy/economyDb.js';
import type { EconomyUser } from '../../types/database.js';
import { CONFIG, formatCurrency } from '../../economy/economyConfig.js';
import { registerComponentHandler } from '../../interactions/componentRouter.js';
import { TABLES, DEFAULT_TABLE, type TableConfig } from './blackjackUtils.js';
import { ID_PREFIX } from './blackjackRender.js';
import { cooldownRemaining, handleComponent, hasActiveGame, startGame } from './blackjackState.js';

// ============ COMMAND DEFINITION ============

export const data = new SlashCommandBuilder()
  .setName('blackjack')
  .setDescription('Play a game of blackjack!')
  .addStringOption((option) =>
    option.setName('amount').setDescription("Amount to bet (number or 'all')").setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName('table')
      .setDescription('Table rules (default: classic)')
      .setRequired(false)
      .addChoices(
        { name: 'Classic (1 deck, S17) - best odds, fresh shuffle each hand', value: 'classic' },
        { name: 'Vegas Strip (6 deck, H17) - persistent shoe', value: 'vegas' }
      )
  );

// ============ EXECUTE ============

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId: string = interaction.user.id;
    const username: string = interaction.user.username;

    const remaining: number = cooldownRemaining(userId);
    if (remaining > 0) {
      await interaction.editReply({
        content: `Slow down — you can deal again in ${remaining}s.`,
      });
      return;
    }

    if (hasActiveGame(userId)) {
      await interaction.editReply({
        content: 'You already have a hand in progress. Finish it first.',
      });
      return;
    }

    const tableChoice: string = interaction.options.getString('table') ?? 'classic';
    const table: TableConfig = TABLES[tableChoice] ?? DEFAULT_TABLE;

    const userData: EconomyUser = await economyDb.getOrCreateUser(userId, username);

    const amount: number | null = parseAmount(
      interaction.options.getString('amount') ?? '',
      userData.wallet
    );

    if (amount === null) {
      await interaction.editReply({
        content: "Enter a valid amount — a positive number, or 'all'.",
      });
      return;
    }

    if (amount < CONFIG.BLACKJACK_MIN) {
      await interaction.editReply({
        content: `Minimum bet is ${formatCurrency(CONFIG.BLACKJACK_MIN)}.`,
      });
      return;
    }

    if (amount > CONFIG.BLACKJACK_MAX) {
      await interaction.editReply({
        content: `Maximum bet is ${formatCurrency(CONFIG.BLACKJACK_MAX)}.`,
      });
      return;
    }

    // Advisory: the escrow debit re-checks atomically, which is what actually prevents
    // an overdraw.
    if (userData.wallet < amount) {
      await interaction.editReply({
        content:
          `You do not have ${formatCurrency(amount)} in your wallet ` +
          `(you have ${formatCurrency(userData.wallet)}).\n` +
          '_Tip: `/withdraw` moves coins out of your bank._',
      });
      return;
    }

    await startGame({ interaction, amount, table });
  } catch (error: unknown) {
    console.error('[BLACKJACK] Command error:', error);
    const message: string = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({ content: `An error occurred: ${message}` });
  }
}

/**
 * Parse the amount option.
 *
 * @returns the stake, or null when the input is not a usable amount
 */
function parseAmount(raw: string, wallet: number): number | null {
  const normalised: string = raw.trim().toLowerCase().replace(/[, ]/g, '');

  if (normalised === 'all' || normalised === 'max') {
    return wallet > 0 ? wallet : null;
  }

  const parsed: number = Number.parseInt(normalised, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;

  return parsed;
}

// ============ REGISTRATION ============

registerComponentHandler(ID_PREFIX, async (interaction) => {
  if (interaction.isModalSubmit()) return;
  await handleComponent(interaction);
});
