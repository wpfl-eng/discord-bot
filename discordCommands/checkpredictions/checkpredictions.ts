// Check Predictions Command
// Settle resolved prediction bets and award payouts

import { SlashCommandBuilder, EmbedBuilder, ChatInputCommandInteraction, Client } from 'discord.js';
import * as polymarketClient from '../../polymarket/polymarketClient.js';
import * as polymarketDb from '../../polymarket/polymarketDb.js';
import { formatCoins, truncate } from '../../polymarket/polymarketConfig.js';
import type { PredictionBet, MarketResolution } from '../../polymarket/polymarketTypes.js';
import { checkForAchievements } from '../../achievements/achievementService.js';
import { ACTION_TYPES } from '../../achievements/achievementConfig.js';

// ============ Command Definition ============

export const data = new SlashCommandBuilder()
  .setName('check-predictions')
  .setDescription('Check and settle your resolved prediction bets');

// ============ Types ============

interface SettlementResult {
  bet: PredictionBet;
  status: 'won' | 'lost' | 'voided' | 'still_open';
  payout: number;
}

// ============ Settlement Logic ============

/**
 * Settle a single bet based on market resolution
 */
async function settleSingleBet(
  bet: PredictionBet,
  resolution: MarketResolution,
  client: Client,
  username: string
): Promise<SettlementResult> {
  // If market isn't resolved yet, skip
  if (!resolution.resolved) {
    return { bet, status: 'still_open', payout: 0 };
  }

  // If market was voided, refund the wager
  if (resolution.voided) {
    const result = await polymarketDb.settleBet(bet, false, true);
    if (result) {
      return { bet: result.bet, status: 'voided', payout: result.payout };
    }
    return { bet, status: 'still_open', payout: 0 };
  }

  // Check if user's outcome won
  const won = bet.clob_token_id === resolution.winningTokenId;

  const result = await polymarketDb.settleBet(bet, won, false);
  if (!result) {
    return { bet, status: 'still_open', payout: 0 };
  }

  // If won, trigger achievements and XP
  if (won) {
    // Check achievements (non-blocking)
    checkForAchievements({
      actionType: ACTION_TYPES.PREDICTION_WIN,
      userId: bet.user_id,
      username,
      client,
      amount: result.payout,
    }).catch((err) => console.error('[CheckPredictions] Achievement check failed:', err));
  } else {
    // Lost - check for loss-related achievements
    checkForAchievements({
      actionType: ACTION_TYPES.PREDICTION_LOSE,
      userId: bet.user_id,
      username,
      client,
      amount: bet.coins_wagered,
    }).catch((err) => console.error('[CheckPredictions] Achievement check failed:', err));
  }

  return {
    bet: result.bet,
    status: won ? 'won' : 'lost',
    payout: result.payout,
  };
}

// ============ Main Execute Function ============

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const username = interaction.user.username;
  const client = interaction.client;

  await interaction.deferReply();

  try {
    // Get user's open bets
    const openBets = await polymarketDb.getOpenBets(userId);

    if (openBets.length === 0) {
      const embed = new EmbedBuilder()
        .setTitle('🔍 Check Predictions')
        .setDescription(
          'You have no open predictions to check.\n\n' +
            'Use `/predictions` to browse markets and place bets!'
        )
        .setColor(0x5865f2);

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Get unique market IDs
    const marketIds = [...new Set(openBets.map((bet) => bet.market_id))];

    // Fetch market resolutions
    const resolutions = await polymarketClient.getResolutionsForMarkets(marketIds);

    // Settle each bet
    const results: SettlementResult[] = [];
    for (const bet of openBets) {
      const resolution = resolutions.get(bet.market_id);
      if (resolution) {
        const result = await settleSingleBet(bet, resolution, client, username);
        results.push(result);
      } else {
        // Couldn't fetch market - treat as still open
        results.push({ bet, status: 'still_open', payout: 0 });
      }
    }

    // Categorize results
    const won = results.filter((r) => r.status === 'won');
    const lost = results.filter((r) => r.status === 'lost');
    const voided = results.filter((r) => r.status === 'voided');
    const stillOpen = results.filter((r) => r.status === 'still_open');

    // Calculate totals
    const totalWon = won.reduce((sum, r) => sum + r.payout, 0);
    const totalLost = lost.reduce((sum, r) => sum + r.bet.coins_wagered, 0);
    const totalRefunded = voided.reduce((sum, r) => sum + r.payout, 0);
    const netChange = totalWon + totalRefunded - totalLost;

    // Build results embed
    const embed = new EmbedBuilder()
      .setTitle('🎯 Prediction Results')
      .setColor(netChange >= 0 ? 0x00d166 : 0xe74c3c);

    // Build description
    const parts: string[] = [];

    if (won.length > 0) {
      const wonText = won
        .slice(0, 5)
        .map(
          (r) =>
            `✅ **${truncate(r.bet.market_question, 40)}**\n   └ ${r.bet.outcome_name}: +${formatCoins(r.payout)}`
        )
        .join('\n');
      parts.push(`**Won (${won.length}):**\n${wonText}`);
      if (won.length > 5) parts.push(`*...and ${won.length - 5} more wins*`);
    }

    if (lost.length > 0) {
      const lostText = lost
        .slice(0, 5)
        .map(
          (r) =>
            `❌ **${truncate(r.bet.market_question, 40)}**\n   └ ${r.bet.outcome_name}: -${formatCoins(r.bet.coins_wagered)}`
        )
        .join('\n');
      parts.push(`**Lost (${lost.length}):**\n${lostText}`);
      if (lost.length > 5) parts.push(`*...and ${lost.length - 5} more losses*`);
    }

    if (voided.length > 0) {
      const voidedText = voided
        .slice(0, 3)
        .map(
          (r) =>
            `🔄 **${truncate(r.bet.market_question, 40)}**\n   └ Refunded: ${formatCoins(r.payout)}`
        )
        .join('\n');
      parts.push(`**Voided (${voided.length}):**\n${voidedText}`);
    }

    if (won.length === 0 && lost.length === 0 && voided.length === 0) {
      parts.push('No bets were resolved. Your markets are still open.');
    }

    embed.setDescription(parts.join('\n\n'));

    // Add summary fields
    if (won.length > 0 || lost.length > 0 || voided.length > 0) {
      embed.addFields(
        { name: 'Won', value: formatCoins(totalWon), inline: true },
        { name: 'Lost', value: formatCoins(totalLost), inline: true },
        {
          name: 'Net',
          value: `${netChange >= 0 ? '+' : ''}${formatCoins(netChange)}`,
          inline: true,
        }
      );

      if (totalRefunded > 0) {
        embed.addFields({ name: 'Refunded', value: formatCoins(totalRefunded), inline: true });
      }
    }

    // Footer with remaining bets
    if (stillOpen.length > 0) {
      embed.setFooter({ text: `📋 ${stillOpen.length} prediction(s) still open` });
    }

    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('[CheckPredictions] Error:', error);
    await interaction.editReply({
      content: 'An error occurred while checking your predictions. Please try again.',
    });
  }
}
