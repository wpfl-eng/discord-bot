// My Predictions Command
// View your open prediction bets

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ChatInputCommandInteraction,
} from 'discord.js';
import * as polymarketDb from '../../polymarket/polymarketDb.js';
import {
  formatOdds,
  formatCoins,
  formatDate,
  truncate,
} from '../../polymarket/polymarketConfig.js';
import type { PredictionBet } from '../../polymarket/polymarketTypes.js';

// ============ Command Definition ============

export const data = new SlashCommandBuilder()
  .setName('my-predictions')
  .setDescription('View your open prediction bets');

// ============ Helpers ============

/**
 * Format a single bet for display
 */
function formatBet(bet: PredictionBet, index: number): string {
  const odds = parseFloat(bet.locked_odds);
  const expiresText = bet.expires_at
    ? formatDate(bet.expires_at)
    : 'Unknown';

  return (
    `**${index + 1}.** ${truncate(bet.market_question, 50)}\n` +
    `└ **${bet.outcome_name}** @ ${formatOdds(odds)}\n` +
    `└ Wagered: ${formatCoins(bet.coins_wagered)} → Potential: ${formatCoins(bet.potential_payout)}\n` +
    `└ Closes: ${expiresText}`
  );
}

// ============ Main Execute Function ============

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;

  await interaction.deferReply();

  try {
    // Get user's open bets
    const openBets = await polymarketDb.getOpenBets(userId);

    if (openBets.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle('📋 Your Predictions')
        .setDescription(
          'You have no open predictions.\n\n' +
          'Use `/predictions` to browse markets and place bets!'
        )
        .setColor(0x5865f2);

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Calculate totals
    const totalWagered = openBets.reduce((sum, bet) => sum + bet.coins_wagered, 0);
    const totalPotential = openBets.reduce((sum, bet) => sum + bet.potential_payout, 0);

    // Format bets for display (limit to 10 for embed size)
    const displayBets = openBets.slice(0, 10);
    const betsText = displayBets.map((bet, idx) => formatBet(bet, idx)).join('\n\n');

    const embed = new EmbedBuilder()
      .setTitle('📋 Your Open Predictions')
      .setDescription(betsText)
      .setColor(0x00d166)
      .addFields(
        { name: 'Total at Risk', value: formatCoins(totalWagered), inline: true },
        { name: 'Total Potential', value: formatCoins(totalPotential), inline: true },
        { name: 'Open Bets', value: `${openBets.length}`, inline: true }
      )
      .setFooter({ text: 'Use /check-predictions to settle resolved bets' });

    if (openBets.length > 10) {
      embed.addFields({
        name: '\u200b',
        value: `*...and ${openBets.length - 10} more bets*`,
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[MyPredictions] Error:', error);
    await interaction.editReply({
      content: 'An error occurred while fetching your predictions. Please try again.',
    });
  }
}
