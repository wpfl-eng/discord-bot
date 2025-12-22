// Predictions Command
// Browse Polymarket prediction markets and place bets with bot coins

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ComponentType,
  ChatInputCommandInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  MessageComponentInteraction,
} from 'discord.js';
import * as polymarketClient from '../../polymarket/polymarketClient.js';
import * as polymarketDb from '../../polymarket/polymarketDb.js';
import {
  CONFIG,
  API_CONFIG,
  FEATURED_CATEGORIES,
  formatOdds,
  formatMultiplier,
  formatCoins,
  formatDate,
  truncate,
  calculatePayout,
} from '../../polymarket/polymarketConfig.js';
import type { MarketDisplay, OutcomeDisplay } from '../../polymarket/polymarketTypes.js';
import * as economyDb from '../../economy/economyDb.js';

// ============ Command Definition ============

export const data = new SlashCommandBuilder()
  .setName('predictions')
  .setDescription('Browse prediction markets and place bets with bot coins');

// ============ UI Components ============

/**
 * Create category selection buttons
 */
function createCategoryButtons(): ActionRowBuilder<ButtonBuilder> {
  const buttons = FEATURED_CATEGORIES.map((cat) =>
    new ButtonBuilder()
      .setCustomId(`pred_cat_${cat.slug}`)
      .setLabel(cat.label)
      .setEmoji(cat.emoji)
      .setStyle(ButtonStyle.Primary)
  );

  return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
}

/**
 * Create market list embed
 */
function createMarketsEmbed(
  categoryLabel: string,
  markets: MarketDisplay[]
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`📊 ${categoryLabel} Markets`)
    .setColor(0x5865f2)
    .setFooter({ text: 'Powered by Polymarket' });

  if (markets.length === 0) {
    embed.setDescription('No markets in this category right now.');
    return embed;
  }

  embed.setDescription('Use the dropdown below to select a market and place bets.');
  return embed;
}

/**
 * Create market selection dropdown
 */
function createMarketSelect(
  markets: MarketDisplay[]
): ActionRowBuilder<StringSelectMenuBuilder> | null {
  if (markets.length === 0) return null;

  const select = new StringSelectMenuBuilder()
    .setCustomId('pred_market_select')
    .setPlaceholder('Select a market to view...');

  for (const market of markets) {
    const leadOutcome = market.outcomes[0];
    const secondOutcome = market.outcomes[1];

    const description = secondOutcome
      ? `${leadOutcome.name}: ${formatOdds(leadOutcome.price)} | ${secondOutcome.name}: ${formatOdds(secondOutcome.price)}`
      : `${leadOutcome.name}: ${formatOdds(leadOutcome.price)}`;

    select.addOptions(
      new StringSelectMenuOptionBuilder()
        .setLabel(truncate(market.question, 100))
        .setDescription(truncate(description, 100))
        .setValue(market.slug)
    );
  }

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

/**
 * Create market selection dropdown and navigation buttons
 */
function createMarketComponents(
  markets: MarketDisplay[]
): (ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>)[] {
  const components: (ActionRowBuilder<StringSelectMenuBuilder> | ActionRowBuilder<ButtonBuilder>)[] = [];

  const selectRow = createMarketSelect(markets);
  if (selectRow) {
    components.push(selectRow);
  }

  components.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('pred_back_categories')
        .setLabel('Back')
        .setStyle(ButtonStyle.Danger)
    )
  );

  return components;
}

/**
 * Create market detail embed
 */
function createMarketDetailEmbed(market: MarketDisplay): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(truncate(market.question, 200))
    .setColor(0x00d166)
    .setFooter({ text: `Closes: ${formatDate(market.endDate)} • Volume: $${Math.round(market.volume).toLocaleString()}` });

  const outcomesText = market.outcomes
    .map((o) => `• **${o.name}**: ${formatOdds(o.price)} (${formatMultiplier(o.price)} payout)`)
    .join('\n');

  embed.setDescription(
    `**Outcomes:**\n${outcomesText}\n\n` +
    `*Click an outcome below to place a bet*\n` +
    `Min: ${formatCoins(CONFIG.MIN_BET)} | Max: ${formatCoins(CONFIG.MAX_BET)}`
  );

  return embed;
}

/**
 * Create outcome betting buttons
 */
function createOutcomeButtons(
  market: MarketDisplay
): ActionRowBuilder<ButtonBuilder>[] {
  const rows: ActionRowBuilder<ButtonBuilder>[] = [];

  // Split outcomes into rows of 4
  for (let i = 0; i < market.outcomes.length; i += 4) {
    const chunk = market.outcomes.slice(i, i + 4);
    const buttons = chunk.map((outcome) =>
      new ButtonBuilder()
        .setCustomId(`pred_bet_${market.slug}_${outcome.index}`)
        .setLabel(truncate(outcome.name, 20))
        .setStyle(ButtonStyle.Success)
    );
    rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(buttons));
  }

  // Back button
  rows.push(
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('pred_back_categories')
        .setLabel('Back to Categories')
        .setStyle(ButtonStyle.Danger)
    )
  );

  return rows;
}

/**
 * Create bet amount modal
 */
function createBetModal(market: MarketDisplay, outcome: OutcomeDisplay): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`pred_modal_${market.slug}_${outcome.index}`)
    .setTitle(`Bet on: ${truncate(outcome.name, 30)}`);

  const amountInput = new TextInputBuilder()
    .setCustomId('pred_amount')
    .setLabel(`Amount (${CONFIG.MIN_BET}-${CONFIG.MAX_BET} coins)`)
    .setStyle(TextInputStyle.Short)
    .setPlaceholder(`e.g., 100`)
    .setMinLength(1)
    .setMaxLength(10)
    .setRequired(true);

  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(amountInput);
  modal.addComponents(row);

  return modal;
}

/**
 * Create bet confirmation embed
 */
function createBetConfirmEmbed(
  market: MarketDisplay,
  outcome: OutcomeDisplay,
  coinsWagered: number,
  potentialPayout: number
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('✅ Bet Placed!')
    .setColor(0x00d166)
    .addFields(
      { name: 'Market', value: truncate(market.question, 100), inline: false },
      { name: 'Outcome', value: outcome.name, inline: true },
      { name: 'Wagered', value: formatCoins(coinsWagered), inline: true },
      { name: 'Odds', value: `${formatOdds(outcome.price)} (locked)`, inline: true },
      { name: 'Potential Payout', value: formatCoins(potentialPayout), inline: true },
      { name: 'Closes', value: formatDate(market.endDate), inline: true }
    )
    .setFooter({ text: 'Use /my-predictions to view your bets • /check-predictions to settle' });
}

// ============ Main Execute Function ============

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  const userId = interaction.user.id;
  const username = interaction.user.username;

  // Ensure user has economy account
  await economyDb.getOrCreateUser(userId, username);

  // Initialize with category selection
  const embed = new EmbedBuilder()
    .setTitle('🎯 Prediction Markets')
    .setDescription(
      'Browse real prediction markets and bet with bot coins!\n\n' +
      'Your bets lock in current odds. When markets resolve, winners get paid.\n\n' +
      '**Select a category to browse:**'
    )
    .setColor(0x5865f2)
    .setFooter({ text: 'Powered by Polymarket • Paper trading with bot coins' });

  const response = await interaction.reply({
    embeds: [embed],
    components: [createCategoryButtons()],
    fetchReply: true,
    ephemeral: true,
  });

  // Create collector for button and select menu interactions
  const collector = response.createMessageComponentCollector({
    time: CONFIG.COLLECTOR_TIMEOUT_MS,
    filter: (i) => i.user.id === userId,
  });

  // Track current state for navigation
  let currentMarkets: MarketDisplay[] = [];

  collector.on('collect', async (interaction: MessageComponentInteraction) => {
    try {
      // ---- Market Selection (Dropdown) ----
      if (interaction.isStringSelectMenu() && interaction.customId === 'pred_market_select') {
        const marketSlug = interaction.values[0];
        const market = currentMarkets.find((m) => m.slug === marketSlug);

        if (!market) {
          await interaction.reply({
            content: 'Market not found. Please try again.',
            ephemeral: true,
          });
          return;
        }

        await interaction.deferUpdate();
        await interaction.editReply({
          embeds: [createMarketDetailEmbed(market)],
          components: createOutcomeButtons(market),
        });
        return;
      }

      // ---- All Button Interactions ----
      if (interaction.isButton()) {
        const customId = interaction.customId;

        // ---- Category Selection ----
        if (customId.startsWith('pred_cat_')) {
          const categorySlug = customId.replace('pred_cat_', '');
          const category = FEATURED_CATEGORIES.find((c) => c.slug === categorySlug);
          if (!category) return;

          await interaction.deferUpdate();

          // Fetch markets for this category
          currentMarkets = await polymarketClient.getMarketsByCategory(
            categorySlug,
            API_CONFIG.DEFAULT_MARKET_LIMIT
          );

          await interaction.editReply({
            embeds: [createMarketsEmbed(category.label, currentMarkets)],
            components: createMarketComponents(currentMarkets),
          });
          return;
        }

        // ---- Place Bet (show modal) ----
        if (customId.startsWith('pred_bet_')) {
          const parts = customId.replace('pred_bet_', '').split('_');
          const marketSlug = parts.slice(0, -1).join('_');
          const outcomeIndex = parseInt(parts[parts.length - 1], 10);

          // Find market and outcome
          let market = currentMarkets.find((m) => m.slug === marketSlug);
          if (!market) {
            // Try to fetch fresh
            market = await polymarketClient.getMarketBySlug(marketSlug) ?? undefined;
          }

          if (!market) {
            await interaction.reply({
              content: 'Market not found. Please try again.',
              ephemeral: true,
            });
            return;
          }

          const outcome = market.outcomes[outcomeIndex];
          if (!outcome) {
            await interaction.reply({
              content: 'Outcome not found. Please try again.',
              ephemeral: true,
            });
            return;
          }

          // Check if market is still open
          if (market.closed) {
            await interaction.reply({
              content: 'This market has closed. You can no longer place bets.',
              ephemeral: true,
            });
            return;
          }

          // Show modal for bet amount
          const modal = createBetModal(market, outcome);
          await interaction.showModal(modal);

          // Wait for modal submission
          let modalInteraction: ModalSubmitInteraction;
          try {
            modalInteraction = await interaction.awaitModalSubmit({
              time: 60000,
              filter: (mi: ModalSubmitInteraction) =>
                mi.customId.startsWith('pred_modal_') && mi.user.id === userId,
            });
          } catch {
            // Modal dismissed or timed out
            return;
          }

          // Parse amount
          const amountStr = modalInteraction.fields.getTextInputValue('pred_amount');
          const amount = parseInt(amountStr, 10);

          if (isNaN(amount) || amount < CONFIG.MIN_BET || amount > CONFIG.MAX_BET) {
            await modalInteraction.reply({
              content: `Invalid amount. Please enter a number between ${CONFIG.MIN_BET} and ${CONFIG.MAX_BET}.`,
              ephemeral: true,
            });
            return;
          }

          // Place the bet
          const result = await polymarketDb.placeBet(userId, username, market, outcome, amount);

          if (!result.success) {
            const errorMessages: Record<string, string> = {
              INSUFFICIENT_FUNDS: 'You don\'t have enough coins in your wallet.',
              MARKET_CLOSED: 'This market has closed.',
              INVALID_AMOUNT: `Amount must be between ${CONFIG.MIN_BET} and ${CONFIG.MAX_BET}.`,
            };
            await modalInteraction.reply({
              content: `❌ ${errorMessages[result.error] || 'Failed to place bet.'}`,
              ephemeral: true,
            });
            return;
          }

          const potentialPayout = calculatePayout(amount, outcome.price);

          await modalInteraction.reply({
            embeds: [createBetConfirmEmbed(market, outcome, amount, potentialPayout)],
            ephemeral: true,
          });
          return;
        }

        // ---- Back to Categories ----
        if (customId === 'pred_back_categories') {
          currentMarkets = [];

          await interaction.deferUpdate();

          const embed = new EmbedBuilder()
            .setTitle('🎯 Prediction Markets')
            .setDescription(
              'Browse real prediction markets and bet with bot coins!\n\n' +
              'Your bets lock in current odds. When markets resolve, winners get paid.\n\n' +
              '**Select a category to browse:**'
            )
            .setColor(0x5865f2)
            .setFooter({ text: 'Powered by Polymarket • Paper trading with bot coins' });

          await interaction.editReply({
            embeds: [embed],
            components: [createCategoryButtons()],
          });
          return;
        }
      }
    } catch (error) {
      console.error('[Predictions] Interaction error:', error);
      try {
        if (!interaction.replied && !interaction.deferred) {
          await interaction.reply({
            content: 'An error occurred. Please try again.',
            ephemeral: true,
          });
        }
      } catch {
        // Ignore follow-up errors
      }
    }
  });

  collector.on('end', async () => {
    try {
      // Disable all buttons when collector expires
      const disabledRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...FEATURED_CATEGORIES.map((cat) =>
          new ButtonBuilder()
            .setCustomId(`pred_cat_${cat.slug}`)
            .setLabel(cat.label)
            .setEmoji(cat.emoji)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(true)
        )
      );

      await interaction.editReply({
        components: [disabledRow],
      });
    } catch {
      // Message may have been deleted
    }
  });
}
