import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ChatInputCommandInteraction,
  ButtonInteraction,
  TextChannel,
} from 'discord.js';
import * as economyDb from '../../economy/economyDb.js';
import type { EconomyUser } from '../../types/database.js';
import { CONFIG, formatCurrency, CHANNELS } from '../../economy/economyConfig.js';
import {
  createDeck,
  calculateHandValue,
  isBlackjack,
  isSoft,
  formatHand,
  drawCard,
  getVisibleDealerValue,
  shouldDealerHit,
  shouldDealerPeek,
  dealerShowsAce,
  calculateInsuranceBet,
  canSplitExactMatch,
  isPairOfAces,
  TABLES,
  DEFAULT_TABLE,
} from './blackjackUtils.js';
import type { Hand, Deck, Card, TableConfig } from './blackjackUtils.js';
import * as blackjackDb from '../../blackjack/blackjackDb.js';
import type { BlackjackStats } from '../../blackjack/blackjackDb.js';
import { checkForAchievements } from '../../achievements/achievementService.js';
import { ACTION_TYPES } from '../../achievements/achievementConfig.js';
import * as nflmonService from '../../nflmon/nflmonService.js';
import type { XpResult } from '../../nflmon/nflmonService.js';
import { getEvolutionEmoji } from '../../nflmon/nflmonConfig.js';

// ============================================================
// Type Definitions
// ============================================================

type HandResult = 'playing' | 'stood' | 'busted';

interface GameState {
  deck: Deck;
  playerHand: Hand;
  dealerHand: Hand;
  bet: number;
  originalBet: number;
  phase: 'playing' | 'dealer_turn' | 'finished';
  doubledDown: boolean;
  hasHit: boolean;
  canSurrender: boolean;
  surrendered?: boolean;
  table: TableConfig;
  // Insurance (Phase 3)
  insuranceBet: number;
  evenMoneyTaken: boolean;
  // Split (Phase 4)
  splitHand: Hand | null;
  splitHandBet: number;
  splitHandDoubled: boolean;
  playingSplitHand: boolean;
  mainHandResult: HandResult | null;
  splitHandResult: HandResult | null;
  wasSplitAces: boolean;
}

interface GameOutcomeResult {
  outcome: string;
  payout: number;
  color: number;
  isWin: boolean;
  isPush: boolean;
  isBust: boolean;
  isBlackjack: boolean;
  isBigWin?: boolean;
  insurancePayout?: number;
  isEvenMoney?: boolean;
}

// In-memory state tracking (resets on bot restart)
const activeGames: Map<string, GameState> = new Map();
const blackjackCooldowns: Map<string, number> = new Map();

function formatHandValue(hand: Hand): string {
  const value: number = calculateHandValue(hand);
  const soft: boolean = isSoft(hand);
  return soft && value <= 21 ? `Soft ${value}` : `${value}`;
}

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
        { name: 'Classic (1 deck, S17) - Best odds', value: 'classic' },
        { name: 'Vegas Strip (6 deck, H17)', value: 'vegas' }
      )
  );

function createGameEmbed(
  game: GameState,
  status: string,
  color: number,
  hideDealer: boolean = true
): EmbedBuilder {
  const dealerValue: number = hideDealer
    ? getVisibleDealerValue(game.dealerHand, true)
    : calculateHandValue(game.dealerHand);
  const dealerValueText = hideDealer ? `showing: ${dealerValue}` : `${dealerValue}`;

  let description: string;

  if (game.splitHand) {
    // Split game - show both hands
    const hand1Value: string = formatHandValue(game.playerHand);
    const hand2Value: string = formatHandValue(game.splitHand);
    const hand1Indicator: string = !game.playingSplitHand ? '▶ ' : '  ';
    const hand2Indicator: string = game.playingSplitHand ? '▶ ' : '  ';

    // Show result labels if hands are complete
    let hand1Label = 'Hand 1';
    let hand2Label = 'Hand 2';
    if (game.mainHandResult === 'busted') hand1Label += ' (BUST)';
    else if (game.mainHandResult === 'stood') hand1Label += ' (stood)';
    if (game.splitHandResult === 'busted') hand2Label += ' (BUST)';
    else if (game.splitHandResult === 'stood') hand2Label += ' (stood)';

    description =
      `**Dealer's Hand:**\n${formatHand(game.dealerHand, hideDealer)} *(${dealerValueText})*\n\n` +
      `**${hand1Indicator}${hand1Label}:**\n${formatHand(game.playerHand)} *(${hand1Value})*\n\n` +
      `**${hand2Indicator}${hand2Label}:**\n${formatHand(game.splitHand)} *(${hand2Value})*`;
  } else {
    // Normal game - show single hand
    const playerValueText: string = formatHandValue(game.playerHand);
    description =
      `**Dealer's Hand:**\n${formatHand(game.dealerHand, hideDealer)} *(${dealerValueText})*\n\n` +
      `**Your Hand:**\n${formatHand(game.playerHand)} *(${playerValueText})*`;
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🃏 Blackjack (${game.table.displayName})`)
    .setDescription(description)
    .setFooter({ text: status })
    .setTimestamp();

  // Add bet fields
  if (game.splitHand) {
    embed.addFields(
      { name: 'Hand 1 Bet', value: formatCurrency(game.bet), inline: true },
      { name: 'Hand 2 Bet', value: formatCurrency(game.splitHandBet), inline: true }
    );
  } else {
    embed.addFields({ name: 'Bet', value: formatCurrency(game.bet), inline: true });
  }

  return embed;
}

function createButtons(
  game: GameState,
  canDoubleDown: boolean = true,
  disabled: boolean = false,
  canSurrender: boolean = false,
  canSplit: boolean = false
): ActionRowBuilder<ButtonBuilder> {
  const hitButton = new ButtonBuilder()
    .setCustomId('blackjack_hit')
    .setLabel('Hit')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(disabled);

  const standButton = new ButtonBuilder()
    .setCustomId('blackjack_stand')
    .setLabel('Stand')
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(disabled);

  const doubleButton = new ButtonBuilder()
    .setCustomId('blackjack_double')
    .setLabel('Double Down')
    .setStyle(ButtonStyle.Success)
    .setDisabled(disabled || !canDoubleDown);

  const splitButton = new ButtonBuilder()
    .setCustomId('blackjack_split')
    .setLabel('Split')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(disabled || !canSplit);

  const surrenderButton = new ButtonBuilder()
    .setCustomId('blackjack_surrender')
    .setLabel('Surrender')
    .setStyle(ButtonStyle.Danger)
    .setDisabled(disabled || !canSurrender);

  const buttons: ButtonBuilder[] = [hitButton, standButton, doubleButton];
  if (canSplit) {
    buttons.push(splitButton);
  }
  if (canSurrender) {
    buttons.push(surrenderButton);
  }

  return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
}

function createPlayAgainRow(originalBet: number): ActionRowBuilder<ButtonBuilder> {
  const playAgainButton: ButtonBuilder = new ButtonBuilder()
    .setCustomId(`blackjack_replay_${originalBet}`)
    .setLabel(`Play Again (${formatCurrency(originalBet)})`)
    .setStyle(ButtonStyle.Success);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(playAgainButton);
}

// ============================================================
// Insurance/Even Money UI Functions
// ============================================================

function createInsuranceEmbed(game: GameState, insuranceAmount: number): EmbedBuilder {
  const playerValueText: string = formatHandValue(game.playerHand);
  const dealerValue: number = getVisibleDealerValue(game.dealerHand, true);

  return new EmbedBuilder()
    .setColor(0x9b59b6) // Purple for insurance prompt
    .setTitle(`🃏 Blackjack (${game.table.displayName}) - Insurance?`)
    .setDescription(
      `**Dealer's Hand:**\n${formatHand(game.dealerHand, true)} *(showing: ${dealerValue})*\n\n` +
        `**Your Hand:**\n${formatHand(game.playerHand)} *(${playerValueText})*`
    )
    .addFields(
      { name: 'Bet', value: formatCurrency(game.bet), inline: true },
      { name: 'Insurance Cost', value: formatCurrency(insuranceAmount), inline: true }
    )
    .setFooter({ text: 'Dealer shows Ace - Insurance pays 2:1 if dealer has blackjack' })
    .setTimestamp();
}

function createInsuranceButtons(): ActionRowBuilder<ButtonBuilder> {
  const yesButton = new ButtonBuilder()
    .setCustomId('blackjack_insurance_yes')
    .setLabel('Take Insurance')
    .setStyle(ButtonStyle.Primary);

  const noButton = new ButtonBuilder()
    .setCustomId('blackjack_insurance_no')
    .setLabel('No Insurance')
    .setStyle(ButtonStyle.Secondary);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(yesButton, noButton);
}

function createEvenMoneyEmbed(game: GameState): EmbedBuilder {
  const dealerValue: number = getVisibleDealerValue(game.dealerHand, true);

  return new EmbedBuilder()
    .setColor(0xf39c12) // Orange for even money prompt
    .setTitle(`🃏 Blackjack (${game.table.displayName}) - Even Money?`)
    .setDescription(
      `**Dealer's Hand:**\n${formatHand(game.dealerHand, true)} *(showing: ${dealerValue})*\n\n` +
        `**Your Hand:**\n${formatHand(game.playerHand)} *(BLACKJACK!)*`
    )
    .addFields(
      { name: 'Bet', value: formatCurrency(game.bet), inline: true },
      { name: 'Even Money', value: formatCurrency(game.bet), inline: true },
      { name: 'Risk for 3:2', value: formatCurrency(Math.floor(game.bet * 1.5)), inline: true }
    )
    .setFooter({ text: 'Take guaranteed 1:1 payout, or risk for 3:2 (push if dealer also has BJ)' })
    .setTimestamp();
}

function createEvenMoneyButtons(): ActionRowBuilder<ButtonBuilder> {
  const evenMoneyButton = new ButtonBuilder()
    .setCustomId('blackjack_even_money_yes')
    .setLabel('Even Money (1:1)')
    .setStyle(ButtonStyle.Success);

  const riskButton = new ButtonBuilder()
    .setCustomId('blackjack_even_money_no')
    .setLabel('Risk for 3:2')
    .setStyle(ButtonStyle.Danger);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(evenMoneyButton, riskButton);
}

/**
 * Handle insurance prompt when dealer shows Ace and player doesn't have BJ
 * @returns Promise that resolves when user makes a decision
 */
async function handleInsurancePrompt(
  interaction: ChatInputCommandInteraction,
  game: GameState,
  userId: string,
  insuranceAmount: number
): Promise<void> {
  const embed = createInsuranceEmbed(game, insuranceAmount);
  const row = createInsuranceButtons();

  const response = await interaction.editReply({
    embeds: [embed],
    components: [row],
  });

  return new Promise<void>((resolve) => {
    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 15000, // 15 seconds to decide on insurance
      filter: (i: ButtonInteraction) =>
        i.user.id === userId &&
        (i.customId === 'blackjack_insurance_yes' || i.customId === 'blackjack_insurance_no'),
      max: 1,
    });

    collector.on('collect', async (buttonInteraction: ButtonInteraction) => {
      if (buttonInteraction.customId === 'blackjack_insurance_yes') {
        game.insuranceBet = insuranceAmount;
      }
      await buttonInteraction.deferUpdate();
      collector.stop();
    });

    collector.on('end', () => {
      // Default: no insurance (timeout or explicit no)
      resolve();
    });
  });
}

/**
 * Handle even money prompt when player has BJ and dealer shows Ace
 * @returns Promise that resolves when user makes a decision
 */
async function handleEvenMoneyPrompt(
  interaction: ChatInputCommandInteraction,
  game: GameState,
  userId: string
): Promise<void> {
  const embed = createEvenMoneyEmbed(game);
  const row = createEvenMoneyButtons();

  const response = await interaction.editReply({
    embeds: [embed],
    components: [row],
  });

  return new Promise<void>((resolve) => {
    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 15000, // 15 seconds to decide on even money
      filter: (i: ButtonInteraction) =>
        i.user.id === userId &&
        (i.customId === 'blackjack_even_money_yes' || i.customId === 'blackjack_even_money_no'),
      max: 1,
    });

    collector.on('collect', async (buttonInteraction: ButtonInteraction) => {
      if (buttonInteraction.customId === 'blackjack_even_money_yes') {
        game.evenMoneyTaken = true;
      }
      await buttonInteraction.deferUpdate();
      collector.stop();
    });

    collector.on('end', () => {
      // Default: risk for 3:2 (timeout or explicit no)
      resolve();
    });
  });
}

function playDealerTurn(game: GameState): void {
  // Dealer hits based on table rules (S17 vs H17)
  while (shouldDealerHit(game.dealerHand, game.table)) {
    const card: Card | undefined = drawCard(game.deck);
    if (card) {
      game.dealerHand.push(card);
    }
  }
}

// ============================================================
// Split Hand Helpers
// ============================================================

/**
 * Get the current hand being played (main or split)
 */
function getCurrentHand(game: GameState): Hand {
  return game.playingSplitHand && game.splitHand ? game.splitHand : game.playerHand;
}

/**
 * Check if we should switch to the split hand after current hand action
 * Returns true if we switched to split hand, false if game should continue to dealer
 */
function shouldSwitchToSplitHand(game: GameState): boolean {
  if (!game.splitHand) return false;

  // If playing main hand and it's done, switch to split hand
  if (!game.playingSplitHand && game.mainHandResult !== 'playing') {
    if (game.splitHandResult === 'playing') {
      game.playingSplitHand = true;
      return true;
    }
  }
  return false;
}

/**
 * Check if all player hands busted (for skipping dealer turn)
 */
function didAllHandsBust(game: GameState): boolean {
  if (!game.splitHand) {
    return calculateHandValue(game.playerHand) > 21;
  }
  return game.mainHandResult === 'busted' && game.splitHandResult === 'busted';
}

/**
 * Determine outcome for a single hand in a split game (1:1 payouts, no 3:2 blackjack)
 */
interface SplitHandOutcome {
  readonly outcome: 'win' | 'loss' | 'push';
  readonly payout: number;
  readonly isBust: boolean;
}

function determineSplitHandOutcome(
  hand: Hand,
  dealerHand: Hand,
  bet: number,
  handResult: HandResult | null
): SplitHandOutcome {
  const handValue: number = calculateHandValue(hand);
  const dealerValue: number = calculateHandValue(dealerHand);
  const dealerBJ: boolean = isBlackjack(dealerHand);

  // Hand busted
  if (handResult === 'busted' || handValue > 21) {
    return { outcome: 'loss', payout: 0, isBust: true };
  }

  // Dealer has blackjack - player loses (split hands can't have natural BJ)
  if (dealerBJ) {
    return { outcome: 'loss', payout: 0, isBust: false };
  }

  // Dealer busted
  if (dealerValue > 21) {
    return { outcome: 'win', payout: bet * 2, isBust: false };
  }

  // Compare hands
  if (handValue > dealerValue) {
    return { outcome: 'win', payout: bet * 2, isBust: false };
  } else if (dealerValue > handValue) {
    return { outcome: 'loss', payout: 0, isBust: false };
  } else {
    return { outcome: 'push', payout: bet, isBust: false };
  }
}

/**
 * Resolve a split game - handles both hands, payouts, and stats
 */
async function resolveSplitGame(
  interaction: ChatInputCommandInteraction,
  game: GameState,
  userId: string
): Promise<void> {
  // Resolve each hand against dealer
  const hand1Result: SplitHandOutcome = determineSplitHandOutcome(
    game.playerHand,
    game.dealerHand,
    game.bet,
    game.mainHandResult
  );
  const hand2Result: SplitHandOutcome = determineSplitHandOutcome(
    game.splitHand!,
    game.dealerHand,
    game.splitHandBet,
    game.splitHandResult
  );

  // Calculate total payout
  const totalPayout: number = hand1Result.payout + hand2Result.payout;
  const totalBet: number = game.bet + game.splitHandBet;

  // Award payout if any
  let updatedUser: EconomyUser | null;
  if (totalPayout > 0) {
    updatedUser = await economyDb.gambleWin(userId, totalPayout);
  } else {
    updatedUser = await economyDb.getUser(userId);
  }

  // Record stats for each hand (with wasSplit=true)
  try {
    // Hand 1 stats
    await blackjackDb.recordGameResult({
      userId,
      username: interaction.user.username,
      outcome: hand1Result.outcome,
      bet: game.bet,
      payout: hand1Result.payout,
      wasBlackjack: false, // Split hands can't have natural blackjack
      wasBust: hand1Result.isBust,
      wasDouble: game.doubledDown || false,
      wasSplit: true,
      wasInsurance: game.insuranceBet > 0,
      wasSurrender: false,
    });

    // Hand 2 stats
    await blackjackDb.recordGameResult({
      userId,
      username: interaction.user.username,
      outcome: hand2Result.outcome,
      bet: game.splitHandBet,
      payout: hand2Result.payout,
      wasBlackjack: false,
      wasBust: hand2Result.isBust,
      wasDouble: game.splitHandDoubled || false,
      wasSplit: true,
      wasInsurance: false, // Insurance only applies to first hand
      wasSurrender: false,
    });
  } catch (statsError) {
    console.error('Failed to record split blackjack stats:', statsError);
  }

  // Determine net result for XP and achievements
  const netProfit: number = totalPayout - totalBet;
  const hasAnyWin: boolean = hand1Result.outcome === 'win' || hand2Result.outcome === 'win';

  // Award NFLmon XP for any win (once per game based on net outcome)
  let xpResult: XpResult | null = null;
  if (hasAnyWin) {
    try {
      xpResult = await nflmonService.addXpToTraining(userId, 'blackjack_win');
    } catch (err) {
      console.error('[BLACKJACK] XP award failed:', err);
    }
  }

  // Check for achievements (non-blocking)
  if (hasAnyWin) {
    checkForAchievements({
      actionType: ACTION_TYPES.BLACKJACK_WIN,
      userId,
      username: interaction.user.username,
      client: interaction.client,
      amount: totalPayout,
    }).catch((err) => console.error('Failed to check achievements:', err));
  }

  // Build the split result embed
  const dealerValue: number = calculateHandValue(game.dealerHand);
  const hand1Value: number = calculateHandValue(game.playerHand);
  const hand2Value: number = calculateHandValue(game.splitHand!);

  // Determine outcome label for each hand
  const hand1Label: string =
    hand1Result.outcome === 'win'
      ? 'WON'
      : hand1Result.outcome === 'push'
        ? 'PUSH'
        : hand1Result.isBust
          ? 'BUST'
          : 'LOST';
  const hand2Label: string =
    hand2Result.outcome === 'win'
      ? 'WON'
      : hand2Result.outcome === 'push'
        ? 'PUSH'
        : hand2Result.isBust
          ? 'BUST'
          : 'LOST';

  // Determine embed color based on net result
  let embedColor: number;
  if (netProfit > 0) {
    embedColor = 0x2ecc71; // Green - net win
  } else if (netProfit < 0) {
    embedColor = 0xe74c3c; // Red - net loss
  } else {
    embedColor = 0x3498db; // Blue - break even
  }

  // Determine overall outcome message
  let outcomeMessage: string;
  if (hand1Result.outcome === 'win' && hand2Result.outcome === 'win') {
    outcomeMessage = 'Both hands win!';
  } else if (hand1Result.outcome === 'loss' && hand2Result.outcome === 'loss') {
    outcomeMessage = 'Both hands lose!';
  } else if (hand1Result.outcome === 'push' && hand2Result.outcome === 'push') {
    outcomeMessage = 'Both hands push!';
  } else if (netProfit > 0) {
    outcomeMessage = 'Split result: Net win!';
  } else if (netProfit < 0) {
    outcomeMessage = 'Split result: Net loss';
  } else {
    outcomeMessage = 'Split result: Break even';
  }

  const embed = new EmbedBuilder()
    .setColor(embedColor)
    .setTitle(`🃏 Blackjack (${game.table.displayName}) - ${outcomeMessage}`)
    .setDescription(
      `**Dealer's Hand:**\n${formatHand(game.dealerHand)} *(${dealerValue > 21 ? 'BUST' : dealerValue})*\n\n` +
        `**Hand 1:** ${formatHand(game.playerHand)} *(${hand1Value > 21 ? 'BUST' : hand1Value})* - **${hand1Label}**\n` +
        `**Hand 2:** ${formatHand(game.splitHand!)} *(${hand2Value > 21 ? 'BUST' : hand2Value})* - **${hand2Label}**`
    )
    .setTimestamp();

  // Add bet/payout fields
  const fields: { name: string; value: string; inline: boolean }[] = [
    { name: 'Hand 1 Bet', value: formatCurrency(game.bet), inline: true },
    { name: 'Hand 2 Bet', value: formatCurrency(game.splitHandBet), inline: true },
    { name: '\u200B', value: '\u200B', inline: true }, // Spacer
  ];

  // Show hand results
  const hand1Net: number = hand1Result.payout - game.bet;
  const hand2Net: number = hand2Result.payout - game.splitHandBet;
  fields.push({
    name: 'Hand 1',
    value: hand1Net > 0 ? `+${formatCurrency(hand1Net)}` : hand1Net < 0 ? `-${formatCurrency(Math.abs(hand1Net))}` : 'Push',
    inline: true,
  });
  fields.push({
    name: 'Hand 2',
    value: hand2Net > 0 ? `+${formatCurrency(hand2Net)}` : hand2Net < 0 ? `-${formatCurrency(Math.abs(hand2Net))}` : 'Push',
    inline: true,
  });
  fields.push({
    name: 'Net',
    value: netProfit > 0 ? `+${formatCurrency(netProfit)}` : netProfit < 0 ? `-${formatCurrency(Math.abs(netProfit))}` : 'Even',
    inline: true,
  });

  fields.push({ name: 'Balance', value: formatCurrency(updatedUser?.wallet ?? 0), inline: true });
  embed.addFields(fields);

  // Add NFLmon Training field if XP was earned
  if (xpResult && xpResult.results.length > 0) {
    const xpLines: string[] = xpResult.results.map((result) => {
      const name: string = result.player?.name || 'Unknown';
      const emoji: string = getEvolutionEmoji(result.nflmon.evolution_stage);
      let line = `${emoji} ${name} Lv.${result.nflmon.level}`;
      if (result.levelsGained > 0) {
        line += ` (+${result.levelsGained} level${result.levelsGained > 1 ? 's' : ''}!)`;
      }
      if (result.evolved && result.newStage) {
        line += ` Evolved to ${result.newStage.name}!`;
      }
      return line;
    });
    embed.addFields({
      name: `NFLmon Training: +${xpResult.xpAmount} XP`,
      value: xpLines.join('\n'),
      inline: false,
    });
  }

  // Build footer
  let footerText: string = outcomeMessage;
  if (game.wasSplitAces) {
    footerText += ' (Split Aces)';
  }
  if (updatedUser?.wallet === 0) {
    footerText += " | You're broke!";
  }
  embed.setFooter({ text: footerText });

  // Show result with Play Again button (if player can afford the original bet)
  const canPlayAgain: boolean = (updatedUser?.wallet ?? 0) >= game.originalBet;
  const components: ActionRowBuilder<ButtonBuilder>[] = [createButtons(game, false, true, false)];
  if (canPlayAgain) {
    components.push(createPlayAgainRow(game.originalBet));
  }

  const response = await interaction.editReply({
    embeds: [embed],
    components,
  });

  // Clean up game state
  activeGames.delete(userId);
  blackjackCooldowns.set(userId, Date.now());

  // Create Play Again button collector (30 seconds)
  if (canPlayAgain) {
    const replayCollector = response.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 30000,
      filter: (i: ButtonInteraction) => i.user.id === userId && i.customId.startsWith('blackjack_replay_'),
    });

    replayCollector.on('collect', async (buttonInteraction: ButtonInteraction) => {
      // Check cooldown
      const lastGame: number | undefined = blackjackCooldowns.get(userId);
      if (lastGame) {
        const elapsed: number = Date.now() - lastGame;
        const cooldownMs: number = CONFIG.BLACKJACK_COOLDOWN_SECONDS * 1000;
        if (elapsed < cooldownMs) {
          const remaining: number = Math.ceil((cooldownMs - elapsed) / 1000);
          await buttonInteraction.reply({
            content: `Slow down! You can play again in ${remaining} seconds.`,
            ephemeral: true,
          });
          return;
        }
      }

      // Check for existing game
      if (activeGames.has(userId)) {
        await buttonInteraction.reply({
          content: 'You already have a blackjack game in progress!',
          ephemeral: true,
        });
        return;
      }

      // Re-fetch wallet to validate funds
      const currentUser: EconomyUser | null = await economyDb.getUser(userId);
      if (!currentUser || currentUser.wallet < game.originalBet) {
        await buttonInteraction.reply({
          content: `You don't have enough coins! Need ${formatCurrency(game.originalBet)}.`,
          ephemeral: true,
        });
        return;
      }

      // Remove Play Again button
      replayCollector.stop('replaying');

      // Disable the button visually
      await buttonInteraction.update({
        components: [createButtons(game, false, true, false)],
      });

      // Start a new game by calling executeNewGame with same table
      const fakeInteraction = {
        ...interaction,
        client: interaction.client,
        options: {
          getString: (name: string): string | null => (name === 'amount' ? game.originalBet.toString() : null),
        },
        deferReply: async (): Promise<void> => {},
        editReply: interaction.editReply.bind(interaction),
        user: buttonInteraction.user,
      };

      await executeNewGame(fakeInteraction as unknown as ChatInputCommandInteraction, game.originalBet, game.table);
    });

    replayCollector.on('end', async (_collected, reason: string) => {
      if (reason === 'time') {
        // Disable the Play Again button after timeout
        try {
          await interaction.editReply({
            components: [createButtons(game, false, true, false)],
          });
        } catch {
          // Message may have been deleted
        }
      }
    });
  }
}

function determineOutcome(game: GameState): GameOutcomeResult {
  const playerValue: number = calculateHandValue(game.playerHand);
  const dealerValue: number = calculateHandValue(game.dealerHand);
  const playerBJ: boolean = isBlackjack(game.playerHand);
  const dealerBJ: boolean = isBlackjack(game.dealerHand);

  // Even money taken - player gets 1:1 payout regardless of dealer's hand
  if (game.evenMoneyTaken && playerBJ) {
    return {
      outcome: 'Even Money! You win 1:1!',
      payout: game.bet * 2,
      color: 0x2ecc71,
      isWin: true,
      isPush: false,
      isBust: false,
      isBlackjack: true,
      isEvenMoney: true,
    };
  }

  // Both have blackjack - push (no even money taken)
  if (playerBJ && dealerBJ) {
    return {
      outcome: 'Push! Both have Blackjack',
      payout: game.bet,
      color: 0x3498db,
      isWin: false,
      isPush: true,
      isBust: false,
      isBlackjack: true,
    };
  }

  // Player has blackjack - 3:2 payout
  if (playerBJ) {
    return {
      outcome: 'Blackjack! You win 3:2!',
      payout: Math.floor(game.bet * 2.5),
      color: 0xf1c40f,
      isBigWin: true,
      isWin: true,
      isPush: false,
      isBust: false,
      isBlackjack: true,
    };
  }

  // Dealer has blackjack - player loses main bet, insurance pays 2:1 if taken
  if (dealerBJ) {
    const insurancePayout: number = game.insuranceBet > 0 ? game.insuranceBet * 3 : 0;
    const outcome: string =
      insurancePayout > 0
        ? 'Dealer has Blackjack! Insurance pays 2:1.'
        : 'Dealer has Blackjack! You lose.';
    return {
      outcome,
      payout: 0, // Main bet lost
      color: insurancePayout > 0 ? 0x3498db : 0xe74c3c, // Blue if insurance won, red otherwise
      isWin: false,
      isPush: false,
      isBust: false,
      isBlackjack: false,
      insurancePayout,
    };
  }

  // Player busted
  if (playerValue > 21) {
    return {
      outcome: 'Bust! You went over 21.',
      payout: 0,
      color: 0xe74c3c,
      isWin: false,
      isPush: false,
      isBust: true,
      isBlackjack: false,
    };
  }

  // Dealer busted
  if (dealerValue > 21) {
    return {
      outcome: 'Dealer busts! You win!',
      payout: game.bet * 2,
      color: 0x2ecc71,
      isWin: true,
      isPush: false,
      isBust: false,
      isBlackjack: false,
    };
  }

  // Compare hands
  if (playerValue > dealerValue) {
    return {
      outcome: 'You win!',
      payout: game.bet * 2,
      color: 0x2ecc71,
      isWin: true,
      isPush: false,
      isBust: false,
      isBlackjack: false,
    };
  } else if (dealerValue > playerValue) {
    return {
      outcome: 'Dealer wins!',
      payout: 0,
      color: 0xe74c3c,
      isWin: false,
      isPush: false,
      isBust: false,
      isBlackjack: false,
    };
  } else {
    return {
      outcome: "Push! It's a tie.",
      payout: game.bet,
      color: 0x3498db,
      isWin: false,
      isPush: true,
      isBust: false,
      isBlackjack: false,
    };
  }
}

async function resolveGame(
  interaction: ChatInputCommandInteraction,
  game: GameState,
  userId: string
): Promise<void> {
  // ============ SPLIT GAME RESOLUTION ============
  if (game.splitHand) {
    await resolveSplitGame(interaction, game, userId);
    return;
  }

  // ============ NON-SPLIT GAME RESOLUTION ============
  const {
    outcome,
    payout,
    color,
    isBigWin,
    isWin,
    isPush,
    isBust,
    isBlackjack,
    insurancePayout = 0,
  }: GameOutcomeResult = determineOutcome(game);

  // Calculate total payout (main bet payout + insurance payout)
  const totalPayout: number = payout + insurancePayout;

  // Award payout if any
  let updatedUser: EconomyUser | null;
  if (totalPayout > 0) {
    updatedUser = await economyDb.gambleWin(userId, totalPayout);
  } else {
    updatedUser = await economyDb.getUser(userId);
  }

  // Record stats (non-blocking - don't let stats failure break game)
  let stats: BlackjackStats | null = null;
  try {
    const statsOutcome: 'win' | 'push' | 'loss' = isWin ? 'win' : isPush ? 'push' : 'loss';
    stats = await blackjackDb.recordGameResult({
      userId,
      username: interaction.user.username,
      outcome: statsOutcome,
      bet: game.bet,
      payout: totalPayout,
      wasBlackjack: isBlackjack,
      wasBust: isBust,
      wasDouble: game.doubledDown || false,
      wasSplit: false,
      wasInsurance: game.insuranceBet > 0,
      wasSurrender: game.surrendered || false,
    });
  } catch (statsError) {
    console.error('Failed to record blackjack stats:', statsError);
  }

  // Check for achievements (non-blocking)
  const achievementActionType = isWin ? ACTION_TYPES.BLACKJACK_WIN : ACTION_TYPES.BLACKJACK_LOSE;
  if (!isPush) {
    checkForAchievements({
      actionType: achievementActionType,
      userId,
      username: interaction.user.username,
      client: interaction.client,
      amount: isWin ? payout : game.bet,
    }).catch((err) => console.error('Failed to check achievements:', err));
  }

  // Award NFLmon XP for wins (non-blocking)
  let xpResult: XpResult | null = null;
  if (isWin) {
    try {
      const xpSource: string = isBlackjack ? 'blackjack_natural' : 'blackjack_win';
      xpResult = await nflmonService.addXpToTraining(userId, xpSource);
    } catch (err) {
      console.error('[BLACKJACK] XP award failed:', err);
    }
  }

  const embed = createGameEmbed(game, outcome, color, false);

  // Update fields with payout info
  embed.spliceFields(0, 1); // Remove old bet field

  // Build fields based on what bets were placed
  const fields: { name: string; value: string; inline: boolean }[] = [
    { name: 'Bet', value: formatCurrency(game.bet), inline: true },
  ];

  // Show insurance bet if taken
  if (game.insuranceBet > 0) {
    fields.push({ name: 'Insurance', value: formatCurrency(game.insuranceBet), inline: true });
  }

  // Show payout/lost info
  if (insurancePayout > 0 && payout === 0) {
    // Lost main bet but won insurance
    fields.push({ name: 'Lost Bet', value: formatCurrency(game.bet), inline: true });
    fields.push({ name: 'Insurance Pays', value: formatCurrency(insurancePayout), inline: true });
  } else if (totalPayout > 0) {
    fields.push({ name: 'Payout', value: formatCurrency(totalPayout), inline: true });
  } else {
    const lostAmount: number = game.bet + game.insuranceBet;
    fields.push({ name: 'Lost', value: formatCurrency(lostAmount), inline: true });
  }

  fields.push({ name: 'Balance', value: formatCurrency(updatedUser?.wallet ?? 0), inline: true });
  embed.addFields(fields);

  // Add NFLmon Training field if XP was earned
  if (xpResult && xpResult.results.length > 0) {
    const xpLines: string[] = xpResult.results.map((result) => {
      const name: string = result.player?.name || 'Unknown';
      const emoji: string = getEvolutionEmoji(result.nflmon.evolution_stage);
      let line = `${emoji} ${name} Lv.${result.nflmon.level}`;
      if (result.levelsGained > 0) {
        line += ` (+${result.levelsGained} level${result.levelsGained > 1 ? 's' : ''}!)`;
      }
      if (result.evolved && result.newStage) {
        line += ` Evolved to ${result.newStage.name}!`;
      }
      return line;
    });
    embed.addFields({
      name: `NFLmon Training: +${xpResult.xpAmount} XP`,
      value: xpLines.join('\n'),
      inline: false,
    });
  }

  // Build footer with outcome and streak
  let footerText: string = outcome;
  if (stats && stats.current_streak > 1) {
    footerText += ` | ${stats.current_streak} win streak!`;
  } else if (stats && stats.current_streak < -1) {
    footerText += ` | ${Math.abs(stats.current_streak)} loss streak`;
  }
  if (updatedUser?.wallet === 0) {
    footerText += " | You're broke!";
  }
  embed.setFooter({ text: footerText });

  // Show result with Play Again button (if player can afford the original bet)
  const canPlayAgain: boolean = (updatedUser?.wallet ?? 0) >= game.originalBet;
  const components: ActionRowBuilder<ButtonBuilder>[] = [createButtons(game, false, true, false)];
  if (canPlayAgain) {
    components.push(createPlayAgainRow(game.originalBet));
  }

  const response = await interaction.editReply({
    embeds: [embed],
    components,
  });

  // Create Play Again button collector (30 seconds)
  if (canPlayAgain) {
    const replayCollector = response.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 30000, // 30 seconds
      filter: (i: ButtonInteraction) => i.user.id === userId && i.customId.startsWith('blackjack_replay_'),
    });

    replayCollector.on('collect', async (buttonInteraction: ButtonInteraction) => {
      // Check cooldown
      const lastGame: number | undefined = blackjackCooldowns.get(userId);
      if (lastGame) {
        const elapsed: number = Date.now() - lastGame;
        const cooldownMs: number = CONFIG.BLACKJACK_COOLDOWN_SECONDS * 1000;
        if (elapsed < cooldownMs) {
          const remaining: number = Math.ceil((cooldownMs - elapsed) / 1000);
          await buttonInteraction.reply({
            content: `Slow down! You can play again in ${remaining} seconds.`,
            ephemeral: true,
          });
          return;
        }
      }

      // Check for existing game
      if (activeGames.has(userId)) {
        await buttonInteraction.reply({
          content: 'You already have a blackjack game in progress!',
          ephemeral: true,
        });
        return;
      }

      // Re-fetch wallet to validate funds
      const currentUser: EconomyUser | null = await economyDb.getUser(userId);
      if (!currentUser || currentUser.wallet < game.originalBet) {
        await buttonInteraction.reply({
          content: `You don't have enough coins! Need ${formatCurrency(game.originalBet)}.`,
          ephemeral: true,
        });
        return;
      }

      // Remove Play Again button
      replayCollector.stop('replaying');

      // Disable the button visually
      await buttonInteraction.update({
        components: [createButtons(game, false, true, false)],
      });

      // Start a new game by calling the command again with the same bet and table
      // We'll create a fake options object
      const fakeInteraction = {
        ...interaction,
        client: interaction.client,
        options: {
          getString: (name: string): string | null => (name === 'amount' ? game.originalBet.toString() : null),
        },
        deferReply: async (): Promise<void> => {},
        editReply: interaction.editReply.bind(interaction),
        user: buttonInteraction.user,
      };

      // Execute a new game with the same table
      await executeNewGame(fakeInteraction as unknown as ChatInputCommandInteraction, game.originalBet, game.table);
    });

    replayCollector.on('end', async (_collected, reason: string) => {
      if (reason === 'time') {
        // Remove Play Again button after timeout
        try {
          await interaction.editReply({
            embeds: [embed],
            components: [createButtons(game, false, true, false)],
          });
        } catch {
          // Message may have been deleted or interaction expired
        }
      }
    });
  }

  // Announce natural blackjack wins in casino channel
  if (isBigWin && CHANNELS.CASINO) {
    try {
      const casinoChannel = await interaction.client.channels.fetch(CHANNELS.CASINO);
      if (casinoChannel && 'send' in casinoChannel) {
        const announcementEmbed = new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle('🃏 BLACKJACK! 🃏')
          .setDescription(
            `<@${userId}> just hit **Natural Blackjack**!\n\nWon ${formatCurrency(payout)} on a ${formatCurrency(game.originalBet)} bet!`
          )
          .setTimestamp();

        await (casinoChannel as TextChannel).send({ embeds: [announcementEmbed] });
      }
    } catch (error) {
      console.error('Failed to send casino announcement:', error);
    }
  }

  // Clean up game state
  activeGames.delete(userId);
}

async function executeNewGame(
  interaction: ChatInputCommandInteraction,
  amount: number,
  table: TableConfig = DEFAULT_TABLE
): Promise<void> {
  const userId: string = interaction.user.id;

  // Deduct bet
  const betResult: EconomyUser | null = await economyDb.gambleLose(userId, amount);
  if (!betResult) {
    await interaction.editReply({
      content: 'Something went wrong placing your bet. Please try again.',
    });
    return;
  }

  // Set cooldown
  blackjackCooldowns.set(userId, Date.now());

  // Initialize game state with table-specific deck
  const deck: Deck = createDeck(table.deckCount);
  const playerCard1: Card | undefined = drawCard(deck);
  const playerCard2: Card | undefined = drawCard(deck);
  const dealerCard1: Card | undefined = drawCard(deck);
  const dealerCard2: Card | undefined = drawCard(deck);

  // Safety check for cards
  if (!playerCard1 || !playerCard2 || !dealerCard1 || !dealerCard2) {
    await interaction.editReply({
      content: 'Something went wrong dealing cards. Please try again.',
    });
    return;
  }

  const game: GameState = {
    deck,
    playerHand: [playerCard1, playerCard2],
    dealerHand: [dealerCard1, dealerCard2],
    bet: amount,
    originalBet: amount,
    phase: 'playing',
    doubledDown: false,
    hasHit: false,
    canSurrender: true,
    table,
    insuranceBet: 0,
    evenMoneyTaken: false,
    // Split state
    splitHand: null,
    splitHandBet: 0,
    splitHandDoubled: false,
    playingSplitHand: false,
    mainHandResult: null,
    splitHandResult: null,
    wasSplitAces: false,
  };

  activeGames.set(userId, game);

  // Check if player has blackjack
  const playerBJ: boolean = isBlackjack(game.playerHand);

  // Dealer peek: When showing 10 or Ace, check hole card for blackjack
  // This prevents player from losing double/split bets to hidden dealer BJ
  if (shouldDealerPeek(game.dealerHand)) {
    if (dealerShowsAce(game.dealerHand)) {
      // Dealer shows Ace - offer insurance/even money BEFORE peeking
      if (playerBJ) {
        // Player has blackjack - offer Even Money
        await handleEvenMoneyPrompt(interaction, game, userId);

        if (game.evenMoneyTaken) {
          // Even money taken - resolve immediately with 1:1 payout
          await resolveGame(interaction, game, userId);
          return;
        }
        // Player declined even money - check for dealer BJ
        const dealerBJ: boolean = isBlackjack(game.dealerHand);
        if (dealerBJ) {
          // Both have blackjack - push
          await resolveGame(interaction, game, userId);
          return;
        }
        // Dealer doesn't have BJ - player wins 3:2
        await resolveGame(interaction, game, userId);
        return;
      } else {
        // Player doesn't have BJ - offer Insurance if affordable
        const insuranceAmount: number = calculateInsuranceBet(game.originalBet);
        const canAffordInsurance: boolean = betResult.wallet >= insuranceAmount;

        if (canAffordInsurance) {
          await handleInsurancePrompt(interaction, game, userId, insuranceAmount);

          // If insurance was taken, deduct from wallet
          if (game.insuranceBet > 0) {
            await economyDb.deductFromWallet(userId, game.insuranceBet);
          }
        }

        // Now peek for dealer blackjack
        const dealerBJ: boolean = isBlackjack(game.dealerHand);
        if (dealerBJ) {
          // Dealer has blackjack - resolve (insurance pays if taken)
          await resolveGame(interaction, game, userId);
          return;
        }
        // Dealer doesn't have BJ - insurance lost, continue normal play
      }
    } else {
      // Dealer shows 10-value - silent peek
      const dealerBJ: boolean = isBlackjack(game.dealerHand);
      if (dealerBJ) {
        // Dealer has blackjack - reveal and resolve
        await resolveGame(interaction, game, userId);
        return;
      }
      // Dealer peeked, no blackjack - if player has BJ, they win 3:2
      if (playerBJ) {
        await resolveGame(interaction, game, userId);
        return;
      }
    }
  } else {
    // Dealer shows 2-9 (can't have blackjack)
    // If player has blackjack, they win 3:2
    if (playerBJ) {
      await resolveGame(interaction, game, userId);
      return;
    }
  }

  // Check if player can afford to double down
  const canDoubleDown: boolean = betResult.wallet >= amount;

  // Check if player can split (exact rank match, can afford, no split yet)
  const canSplit: boolean =
    canSplitExactMatch(game.playerHand) && betResult.wallet >= amount && !game.splitHand;

  // Show game with buttons
  const embed = createGameEmbed(
    game,
    'Your turn - Hit, Stand, Double Down, or Surrender?',
    0xf1c40f,
    true
  );
  const row = createButtons(game, canDoubleDown, false, game.canSurrender, canSplit);

  const response = await interaction.editReply({
    embeds: [embed],
    components: [row],
  });

  // Create button collector
  const collector = response.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: CONFIG.BLACKJACK_TIMEOUT_SECONDS * 1000,
    filter: (i: ButtonInteraction) => i.user.id === userId && !i.customId.startsWith('blackjack_replay_'),
  });

  collector.on('collect', async (buttonInteraction: ButtonInteraction) => {
    const currentGame: GameState | undefined = activeGames.get(userId);
    if (!currentGame || currentGame.phase !== 'playing') {
      await buttonInteraction.reply({
        content: 'This game is no longer active.',
        ephemeral: true,
      });
      return;
    }

    const action: string = buttonInteraction.customId;

    if (action === 'blackjack_hit') {
      const currentHand: Hand = getCurrentHand(currentGame);
      const newCard: Card | undefined = drawCard(currentGame.deck);
      if (newCard) {
        currentHand.push(newCard);
      }
      currentGame.hasHit = true;
      currentGame.canSurrender = false;

      const handValue: number = calculateHandValue(currentHand);

      if (handValue > 21) {
        // Current hand busted
        if (currentGame.splitHand) {
          // Split game - mark current hand as busted
          if (currentGame.playingSplitHand) {
            currentGame.splitHandResult = 'busted';
          } else {
            currentGame.mainHandResult = 'busted';
          }

          // Try to switch to split hand
          if (shouldSwitchToSplitHand(currentGame)) {
            // Switched to split hand - reset hasHit for new hand
            currentGame.hasHit = false;
            const splitEmbed = createGameEmbed(
              currentGame,
              'Hand 1 busted! Playing Hand 2 - Hit, Stand, or Double?',
              0xe74c3c,
              true
            );
            const canDoubleOnSplit: boolean =
              ((await economyDb.getUser(userId))?.wallet ?? 0) >= currentGame.originalBet;
            const splitRow = createButtons(currentGame, canDoubleOnSplit, false, false, false);
            await buttonInteraction.update({ embeds: [splitEmbed], components: [splitRow] });
            return;
          }

          // Both hands done - check if dealer needs to play
          if (didAllHandsBust(currentGame)) {
            currentGame.phase = 'finished';
            collector.stop('all_bust');
            await buttonInteraction.deferUpdate();
            await resolveGame(interaction, currentGame, userId);
          } else {
            currentGame.phase = 'dealer_turn';
            playDealerTurn(currentGame);
            currentGame.phase = 'finished';
            collector.stop('split_done');
            await buttonInteraction.deferUpdate();
            await resolveGame(interaction, currentGame, userId);
          }
        } else {
          // Non-split game - simple bust
          currentGame.phase = 'finished';
          collector.stop('bust');
          await buttonInteraction.deferUpdate();
          await resolveGame(interaction, currentGame, userId);
        }
      } else if (handValue === 21) {
        // Current hand hit 21 - auto-stand
        if (currentGame.splitHand) {
          // Split game - mark current hand as stood
          if (currentGame.playingSplitHand) {
            currentGame.splitHandResult = 'stood';
          } else {
            currentGame.mainHandResult = 'stood';
          }

          // Try to switch to split hand
          if (shouldSwitchToSplitHand(currentGame)) {
            // Switched to split hand - reset hasHit for new hand
            currentGame.hasHit = false;
            const splitEmbed = createGameEmbed(
              currentGame,
              'Hand 1 got 21! Playing Hand 2 - Hit, Stand, or Double?',
              0x2ecc71,
              true
            );
            const canDoubleOnSplit: boolean =
              ((await economyDb.getUser(userId))?.wallet ?? 0) >= currentGame.originalBet;
            const splitRow = createButtons(currentGame, canDoubleOnSplit, false, false, false);
            await buttonInteraction.update({ embeds: [splitEmbed], components: [splitRow] });
            return;
          }

          // Both hands done - dealer's turn
          currentGame.phase = 'dealer_turn';
          playDealerTurn(currentGame);
          currentGame.phase = 'finished';
          collector.stop('split_done');
          await buttonInteraction.deferUpdate();
          await resolveGame(interaction, currentGame, userId);
        } else {
          // Non-split game - dealer's turn
          currentGame.phase = 'dealer_turn';
          playDealerTurn(currentGame);
          currentGame.phase = 'finished';
          collector.stop('21');
          await buttonInteraction.deferUpdate();
          await resolveGame(interaction, currentGame, userId);
        }
      } else {
        // Hand is still playable
        const handLabel: string = currentGame.splitHand
          ? currentGame.playingSplitHand
            ? 'Hand 2'
            : 'Hand 1'
          : 'Your turn';
        const embedUpdate = createGameEmbed(
          currentGame,
          `${handLabel} - Hit or Stand?`,
          0xf1c40f,
          true
        );
        const rowUpdate = createButtons(currentGame, false, false, false, false);
        await buttonInteraction.update({ embeds: [embedUpdate], components: [rowUpdate] });
      }
    } else if (action === 'blackjack_stand') {
      if (currentGame.splitHand) {
        // Split game - mark current hand as stood
        if (currentGame.playingSplitHand) {
          currentGame.splitHandResult = 'stood';
        } else {
          currentGame.mainHandResult = 'stood';
        }

        // Try to switch to split hand
        if (shouldSwitchToSplitHand(currentGame)) {
          // Switched to split hand - reset hasHit for new hand
          currentGame.hasHit = false;
          const splitEmbed = createGameEmbed(
            currentGame,
            'Hand 1 stands! Playing Hand 2 - Hit, Stand, or Double?',
            0x3498db,
            true
          );
          const canDoubleOnSplit: boolean =
            ((await economyDb.getUser(userId))?.wallet ?? 0) >= currentGame.originalBet;
          const splitRow = createButtons(currentGame, canDoubleOnSplit, false, false, false);
          await buttonInteraction.update({ embeds: [splitEmbed], components: [splitRow] });
          return;
        }

        // Both hands done - dealer's turn
        currentGame.phase = 'dealer_turn';
        playDealerTurn(currentGame);
        currentGame.phase = 'finished';
        collector.stop('split_done');
        await buttonInteraction.deferUpdate();
        await resolveGame(interaction, currentGame, userId);
      } else {
        // Non-split game - simple stand
        currentGame.phase = 'dealer_turn';
        playDealerTurn(currentGame);
        currentGame.phase = 'finished';
        collector.stop('stand');
        await buttonInteraction.deferUpdate();
        await resolveGame(interaction, currentGame, userId);
      }
    } else if (action === 'blackjack_double') {
      if (currentGame.hasHit) {
        await buttonInteraction.reply({
          content: 'You can only double down on your first two cards!',
          ephemeral: true,
        });
        return;
      }

      const currentUser: EconomyUser | null = await economyDb.getUser(userId);
      if (!currentUser || currentUser.wallet < currentGame.originalBet) {
        await buttonInteraction.reply({
          content: `You don't have enough coins to double down! Need ${formatCurrency(currentGame.originalBet)}.`,
          ephemeral: true,
        });
        return;
      }

      const doubleResult: EconomyUser | null = await economyDb.gambleLose(userId, currentGame.originalBet);
      if (!doubleResult) {
        await buttonInteraction.reply({
          content: 'Insufficient funds to double down!',
          ephemeral: true,
        });
        return;
      }

      // Update bet and doubled flag for current hand
      if (currentGame.splitHand && currentGame.playingSplitHand) {
        currentGame.splitHandBet = currentGame.splitHandBet + currentGame.originalBet;
        currentGame.splitHandDoubled = true;
      } else {
        currentGame.bet = currentGame.bet + currentGame.originalBet;
        currentGame.doubledDown = true;
      }

      // Draw one card to current hand
      const currentHand: Hand = getCurrentHand(currentGame);
      const doubleCard: Card | undefined = drawCard(currentGame.deck);
      if (doubleCard) {
        currentHand.push(doubleCard);
      }

      const handValue: number = calculateHandValue(currentHand);

      if (handValue > 21) {
        // Busted on double
        if (currentGame.splitHand) {
          // Split game - mark current hand as busted
          if (currentGame.playingSplitHand) {
            currentGame.splitHandResult = 'busted';
          } else {
            currentGame.mainHandResult = 'busted';
          }

          // Try to switch to split hand
          if (shouldSwitchToSplitHand(currentGame)) {
            currentGame.hasHit = false;
            const splitEmbed = createGameEmbed(
              currentGame,
              'Hand 1 doubled and busted! Playing Hand 2 - Hit, Stand, or Double?',
              0xe74c3c,
              true
            );
            const canDoubleOnSplit: boolean = doubleResult.wallet >= currentGame.originalBet;
            const splitRow = createButtons(currentGame, canDoubleOnSplit, false, false, false);
            await buttonInteraction.update({ embeds: [splitEmbed], components: [splitRow] });
            return;
          }

          // Both hands done
          if (didAllHandsBust(currentGame)) {
            currentGame.phase = 'finished';
            collector.stop('all_bust_double');
            await buttonInteraction.deferUpdate();
            await resolveGame(interaction, currentGame, userId);
          } else {
            currentGame.phase = 'dealer_turn';
            playDealerTurn(currentGame);
            currentGame.phase = 'finished';
            collector.stop('split_done_double');
            await buttonInteraction.deferUpdate();
            await resolveGame(interaction, currentGame, userId);
          }
        } else {
          // Non-split game - simple bust
          currentGame.phase = 'finished';
          collector.stop('bust_double');
          await buttonInteraction.deferUpdate();
          await resolveGame(interaction, currentGame, userId);
        }
      } else {
        // Stood on double (auto-stand after double)
        if (currentGame.splitHand) {
          // Split game - mark current hand as stood
          if (currentGame.playingSplitHand) {
            currentGame.splitHandResult = 'stood';
          } else {
            currentGame.mainHandResult = 'stood';
          }

          // Try to switch to split hand
          if (shouldSwitchToSplitHand(currentGame)) {
            currentGame.hasHit = false;
            const splitEmbed = createGameEmbed(
              currentGame,
              'Hand 1 doubled! Playing Hand 2 - Hit, Stand, or Double?',
              0x9b59b6,
              true
            );
            const canDoubleOnSplit: boolean = doubleResult.wallet >= currentGame.originalBet;
            const splitRow = createButtons(currentGame, canDoubleOnSplit, false, false, false);
            await buttonInteraction.update({ embeds: [splitEmbed], components: [splitRow] });
            return;
          }

          // Both hands done - dealer's turn
          currentGame.phase = 'dealer_turn';
          playDealerTurn(currentGame);
          currentGame.phase = 'finished';
          collector.stop('split_done_double');
          await buttonInteraction.deferUpdate();
          await resolveGame(interaction, currentGame, userId);
        } else {
          // Non-split game - dealer's turn
          currentGame.phase = 'dealer_turn';
          playDealerTurn(currentGame);
          currentGame.phase = 'finished';
          collector.stop('double');
          await buttonInteraction.deferUpdate();
          await resolveGame(interaction, currentGame, userId);
        }
      }
    } else if (action === 'blackjack_surrender') {
      if (!currentGame.canSurrender) {
        await buttonInteraction.reply({
          content: 'You can only surrender before taking any action!',
          ephemeral: true,
        });
        return;
      }

      const refundAmount: number = Math.floor(currentGame.bet / 2);
      const refundResult: EconomyUser | null = await economyDb.gambleWin(userId, refundAmount);
      if (!refundResult) {
        await buttonInteraction.reply({
          content: 'Something went wrong processing your surrender.',
          ephemeral: true,
        });
        return;
      }

      currentGame.phase = 'finished';
      currentGame.surrendered = true;
      collector.stop('surrender');

      // Record surrender in stats
      try {
        await blackjackDb.recordGameResult({
          userId,
          username: interaction.user.username,
          outcome: 'loss',
          bet: currentGame.bet,
          payout: refundAmount,
          wasBlackjack: false,
          wasBust: false,
          wasDouble: false,
          wasSplit: false,
          wasInsurance: false,
          wasSurrender: true,
        });
      } catch (statsError) {
        console.error('Failed to record surrender stats:', statsError);
      }

      const finalEmbed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle(`🃏 Blackjack (${currentGame.table.displayName}) - Surrendered`)
        .setDescription(
          `**Dealer's Hand:**\n${formatHand(currentGame.dealerHand, false)} *(${calculateHandValue(currentGame.dealerHand)})*\n\n` +
            `**Your Hand:**\n${formatHand(currentGame.playerHand)} *(${formatHandValue(currentGame.playerHand)})*`
        )
        .addFields(
          { name: 'Bet', value: formatCurrency(currentGame.bet), inline: true },
          { name: 'Refunded', value: formatCurrency(refundAmount), inline: true },
          { name: 'Balance', value: formatCurrency(refundResult.wallet), inline: true }
        )
        .setFooter({ text: 'You surrendered and got half your bet back.' })
        .setTimestamp();

      // Add play again button if can afford
      const canPlayAgain: boolean = refundResult.wallet >= currentGame.originalBet;
      const finalComponents: ActionRowBuilder<ButtonBuilder>[] = [createButtons(currentGame, false, true, false)];
      if (canPlayAgain) {
        finalComponents.push(createPlayAgainRow(currentGame.originalBet));
      }

      await buttonInteraction.update({
        embeds: [finalEmbed],
        components: finalComponents,
      });

      activeGames.delete(userId);
      blackjackCooldowns.set(userId, Date.now());

      // Create Play Again collector for surrender
      if (canPlayAgain) {
        const surrenderReplayCollector = buttonInteraction.message.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 30000,
          filter: (i: ButtonInteraction) => i.user.id === userId && i.customId.startsWith('blackjack_replay_'),
        });

        surrenderReplayCollector.on('collect', async (replayInteraction: ButtonInteraction) => {
          // Check cooldown
          const lastGame: number | undefined = blackjackCooldowns.get(userId);
          if (lastGame) {
            const elapsed: number = Date.now() - lastGame;
            const cooldownMs: number = CONFIG.BLACKJACK_COOLDOWN_SECONDS * 1000;
            if (elapsed < cooldownMs) {
              const remaining: number = Math.ceil((cooldownMs - elapsed) / 1000);
              await replayInteraction.reply({
                content: `Slow down! You can play again in ${remaining} seconds.`,
                ephemeral: true,
              });
              return;
            }
          }

          // Check for existing game
          if (activeGames.has(userId)) {
            await replayInteraction.reply({
              content: 'You already have a blackjack game in progress!',
              ephemeral: true,
            });
            return;
          }

          // Re-fetch wallet to validate funds
          const currentUser: EconomyUser | null = await economyDb.getUser(userId);
          if (!currentUser || currentUser.wallet < currentGame.originalBet) {
            await replayInteraction.reply({
              content: `You don't have enough coins! Need ${formatCurrency(currentGame.originalBet)}.`,
              ephemeral: true,
            });
            return;
          }

          // Remove Play Again button
          surrenderReplayCollector.stop('replaying');

          // Disable the button visually
          await replayInteraction.update({
            components: [createButtons(currentGame, false, true, false)],
          });

          // Start a new game with the same bet and table
          const fakeInteraction = {
            ...interaction,
            client: interaction.client,
            options: {
              getString: (name: string): string | null => (name === 'amount' ? currentGame.originalBet.toString() : null),
            },
            deferReply: async (): Promise<void> => {},
            editReply: interaction.editReply.bind(interaction),
            user: replayInteraction.user,
          };

          await executeNewGame(fakeInteraction as unknown as ChatInputCommandInteraction, currentGame.originalBet, currentGame.table);
        });

        surrenderReplayCollector.on('end', async (_collected, reason: string) => {
          if (reason === 'time') {
            // Disable the Play Again button after timeout
            try {
              await buttonInteraction.editReply({
                components: [createButtons(currentGame, false, true, false)],
              });
            } catch {
              // Message may have been deleted
            }
          }
        });
      }
    } else if (action === 'blackjack_split') {
      // Validate split conditions
      if (currentGame.hasHit) {
        await buttonInteraction.reply({
          content: 'You can only split on your first two cards!',
          ephemeral: true,
        });
        return;
      }

      if (currentGame.splitHand) {
        await buttonInteraction.reply({
          content: 'You can only split once per game!',
          ephemeral: true,
        });
        return;
      }

      if (!canSplitExactMatch(currentGame.playerHand)) {
        await buttonInteraction.reply({
          content: 'You can only split pairs of matching cards!',
          ephemeral: true,
        });
        return;
      }

      // Check wallet for split bet
      const splitUser: EconomyUser | null = await economyDb.getUser(userId);
      if (!splitUser || splitUser.wallet < currentGame.originalBet) {
        await buttonInteraction.reply({
          content: `You don't have enough coins to split! Need ${formatCurrency(currentGame.originalBet)}.`,
          ephemeral: true,
        });
        return;
      }

      // Deduct split bet from wallet
      const splitDeduct: EconomyUser | null = await economyDb.deductFromWallet(
        userId,
        currentGame.originalBet
      );
      if (!splitDeduct) {
        await buttonInteraction.reply({
          content: 'Failed to process split bet.',
          ephemeral: true,
        });
        return;
      }

      // Check if splitting aces
      const isSplitAces: boolean = isPairOfAces(currentGame.playerHand);

      // Separate the cards
      const secondCard: Card = currentGame.playerHand.pop()!;
      currentGame.splitHand = [secondCard];
      currentGame.splitHandBet = currentGame.originalBet;
      currentGame.wasSplitAces = isSplitAces;
      currentGame.canSurrender = false; // No surrender after split

      // Draw a card for each hand
      const card1: Card | undefined = drawCard(currentGame.deck);
      const card2: Card | undefined = drawCard(currentGame.deck);
      if (card1) currentGame.playerHand.push(card1);
      if (card2) currentGame.splitHand.push(card2);

      // Initialize hand results
      currentGame.mainHandResult = 'playing';
      currentGame.splitHandResult = 'playing';
      currentGame.playingSplitHand = false; // Start with main hand

      if (isSplitAces) {
        // Split aces: each gets one card only, auto-stand both
        currentGame.mainHandResult = 'stood';
        currentGame.splitHandResult = 'stood';
        currentGame.phase = 'dealer_turn';

        // Check if either hand busted (shouldn't happen with aces, but be safe)
        const hand1Value: number = calculateHandValue(currentGame.playerHand);
        const hand2Value: number = calculateHandValue(currentGame.splitHand);
        if (hand1Value > 21) currentGame.mainHandResult = 'busted';
        if (hand2Value > 21) currentGame.splitHandResult = 'busted';

        // Play dealer turn
        playDealerTurn(currentGame);
        currentGame.phase = 'finished';
        collector.stop('split_aces');
        await buttonInteraction.deferUpdate();
        await resolveGame(interaction, currentGame, userId);
      } else {
        // Normal split - player plays hand 1 first
        const splitEmbed = createGameEmbed(
          currentGame,
          'Split! Playing Hand 1 - Hit, Stand, or Double?',
          0x9b59b6,
          true
        );

        // Can double after split, no surrender, no re-split
        const canDoubleAfterSplit: boolean = splitDeduct.wallet >= currentGame.originalBet;
        const splitRow = createButtons(currentGame, canDoubleAfterSplit, false, false, false);

        await buttonInteraction.update({
          embeds: [splitEmbed],
          components: [splitRow],
        });
      }
    }
  });

  collector.on('end', async (_collected, reason: string) => {
    const currentGame: GameState | undefined = activeGames.get(userId);
    if (reason === 'time' && currentGame && currentGame.phase === 'playing') {
      // Auto-stand on timeout
      if (currentGame.splitHand) {
        // In split game - auto-stand remaining hands
        if (!currentGame.playingSplitHand && currentGame.mainHandResult === 'playing') {
          currentGame.mainHandResult = 'stood';
        }
        if (currentGame.splitHandResult === 'playing') {
          currentGame.splitHandResult = 'stood';
        }
      }
      currentGame.phase = 'dealer_turn';
      playDealerTurn(currentGame);
      currentGame.phase = 'finished';

      const timeoutEmbed = createGameEmbed(
        currentGame,
        "Time's up! Auto-standing...",
        0xf1c40f,
        false
      );
      await interaction.editReply({
        embeds: [timeoutEmbed],
        components: [createButtons(currentGame, false, true, false)],
      });

      await resolveGame(interaction, currentGame, userId);
    }
  });
}

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId: string = interaction.user.id;
    const username: string = interaction.user.username;
    const amountStr: string = interaction.options.getString('amount')!.toLowerCase();
    const tableChoice: string = interaction.options.getString('table') ?? 'classic';
    const table: TableConfig = TABLES[tableChoice] ?? DEFAULT_TABLE;

    // Check cooldown
    const lastGame: number | undefined = blackjackCooldowns.get(userId);
    if (lastGame) {
      const elapsed: number = Date.now() - lastGame;
      const cooldownMs: number = CONFIG.BLACKJACK_COOLDOWN_SECONDS * 1000;
      if (elapsed < cooldownMs) {
        const remaining: number = Math.ceil((cooldownMs - elapsed) / 1000);
        await interaction.editReply({
          content: `Slow down! You can play again in ${remaining} seconds.`,
        });
        return;
      }
    }

    // Check for existing game
    if (activeGames.has(userId)) {
      await interaction.editReply({
        content: 'You already have a blackjack game in progress! Finish it first.',
      });
      return;
    }

    // Get or create user
    const userData: EconomyUser = await economyDb.getOrCreateUser(userId, username);

    // Parse amount
    let amount: number;
    if (amountStr === 'all' || amountStr === 'max') {
      amount = userData.wallet;
    } else {
      amount = parseInt(amountStr, 10);
    }

    // Validate amount
    if (isNaN(amount) || amount <= 0) {
      await interaction.editReply({
        content: "Please enter a valid amount (a positive number or 'all').",
      });
      return;
    }

    // Check min/max
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

    // Check wallet balance
    if (userData.wallet < amount) {
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('🃏 Blackjack Failed')
        .setDescription(
          `You don't have enough coins in your wallet!\n\nYour wallet: ${formatCurrency(userData.wallet)}\nBet amount: ${formatCurrency(amount)}`
        )
        .setFooter({ text: 'Tip: Use /withdraw to get coins from your bank' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Start the game
    await executeNewGame(interaction, amount, table);
  } catch (error: unknown) {
    console.error('blackjack command error:', error);
    activeGames.delete(interaction.user.id);
    const message: string = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `An error occurred: ${message}`,
    });
  }
}
