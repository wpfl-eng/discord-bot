// Roulette Command
// American roulette with automatic 2-minute spins

import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  AutocompleteInteraction,
  EmbedBuilder,
  TextChannel,
} from 'discord.js';
import * as economyDb from '../../economy/economyDb.js';
import { CONFIG, formatCurrency } from '../../economy/economyConfig.js';
import {
  ALL_BET_TYPES,
  BET_TYPES,
  getBetDisplay,
  formatAmount,
} from './rouletteConfig.js';
import * as rouletteState from './rouletteState.js';

// ============ COMMAND DEFINITION ============

export const data = new SlashCommandBuilder()
  .setName('roulette')
  .setDescription('Play roulette in the casino')
  .addSubcommand((sub) =>
    sub
      .setName('bet')
      .setDescription('Place a bet on the roulette table')
      .addIntegerOption((opt) =>
        opt
          .setName('amount')
          .setDescription(`Coins to wager (${CONFIG.GAMBLE_MIN}-${CONFIG.GAMBLE_MAX})`)
          .setRequired(true)
          .setMinValue(CONFIG.GAMBLE_MIN)
          .setMaxValue(CONFIG.GAMBLE_MAX)
      )
      .addStringOption((opt) =>
        opt
          .setName('type')
          .setDescription('What to bet on (red, black, 17, first-dozen, etc.)')
          .setRequired(true)
          .setAutocomplete(true)
      )
  );

// ============ AUTOCOMPLETE ============

export async function autocomplete(interaction: AutocompleteInteraction): Promise<void> {
  const focused: string = interaction.options.getFocused().toLowerCase();

  const filtered: string[] = ALL_BET_TYPES.filter((t) => t.toLowerCase().startsWith(focused)).slice(0, 25);

  await interaction.respond(
    filtered.map((t) => ({
      name: getBetDisplay(t),
      value: t,
    }))
  );
}

// ============ EXECUTE ============

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const subcommand: string = interaction.options.getSubcommand();

  if (subcommand === 'bet') {
    await handleBet(interaction);
  }
}

async function handleBet(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  const userId: string = interaction.user.id;
  const username: string = interaction.user.username;
  const amount: number = interaction.options.getInteger('amount', true);
  const betType: string = interaction.options.getString('type', true).toLowerCase();

  // Check if in roulette channel
  const rouletteChannelId: string | undefined = rouletteState.getRouletteChannelId();
  if (!rouletteChannelId) {
    await interaction.editReply({
      content: 'Roulette is not configured. Contact an admin.',
    });
    return;
  }

  if (interaction.channelId !== rouletteChannelId) {
    await interaction.editReply({
      content: `Head to <#${rouletteChannelId}> to play roulette!`,
    });
    return;
  }

  // Validate bet type
  if (!BET_TYPES[betType]) {
    await interaction.editReply({
      content: `Invalid bet type: "${betType}". Try: red, black, odd, even, 0-36, etc.`,
    });
    return;
  }

  // Get user data
  const userData = await economyDb.getOrCreateUser(userId, username);

  // Check balance
  if (userData.wallet < amount) {
    const embed = new EmbedBuilder()
      .setColor(0xe74c3c)
      .setTitle('🎰 Insufficient Funds')
      .setDescription(
        `You need ${formatCurrency(amount)} but only have ${formatCurrency(userData.wallet)} in your wallet.`
      )
      .setFooter({ text: 'Tip: Use /withdraw to get coins from your bank' });

    await interaction.editReply({ embeds: [embed] });
    return;
  }

  // Deduct coins immediately
  const deductResult = await economyDb.deductFromWallet(userId, amount);
  if (!deductResult) {
    await interaction.editReply({
      content: 'Failed to place bet. Please try again.',
    });
    return;
  }

  // Start round if needed
  if (!rouletteState.hasActiveRound()) {
    if (!interaction.channel) {
      await interaction.editReply({
        content: 'This command must be used in a text channel.',
      });
      return;
    }
    const channel: TextChannel = interaction.channel as TextChannel;
    await rouletteState.startRound(interaction.client, channel);
  }

  // Add bet to round
  await rouletteState.addBet({
    userId,
    username,
    betType,
    amount,
    placedAt: new Date(),
  });

  // Build confirmation with user's full bet slate
  const userBets: rouletteState.RouletteBet[] = rouletteState.getUserBets(userId);
  const totalBet: number = userBets.reduce((sum, b) => sum + b.amount, 0);

  const betLines: string[] = userBets.map((b) => `• ${formatAmount(b.amount)} on ${getBetDisplay(b.betType)}`);

  const embed = new EmbedBuilder()
    .setColor(0x2ecc71)
    .setTitle('✓ Bet Placed')
    .setDescription(
      `${formatAmount(amount)} on ${getBetDisplay(betType)}\n\n` +
        '**Your bets this round:**\n' +
        betLines.join('\n') +
        `\n\nTotal: ${formatCurrency(totalBet)}`
    );

  await interaction.editReply({ embeds: [embed] });
}
