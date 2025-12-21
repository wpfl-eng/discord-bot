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
import type { Card, Hand, Deck } from '../blackjack/blackjackUtils.js';
import { drawCard } from '../blackjack/blackjackUtils.js';
import * as economyDb from '../../economy/economyDb.js';
import type { EconomyUser } from '../../types/database.js';
import { CONFIG, formatCurrency, CHANNELS } from '../../economy/economyConfig.js';
import { getDefaultVariant } from './videoPokerVariants.js';
import type { VideoPokerVariant } from './videoPokerVariants.js';
import {
  formatVideoPokerHand,
  formatVideoPokerHandSimple,
  getHandEmoji,
} from './videoPokerUtils.js';
import { HandRank, HAND_NAMES, JACKS_OR_BETTER_PAYOUTS } from './videoPokerConfig.js';
import * as videoPokerDb from '../../videopoker/videoPokerDb.js';
import { checkForAchievements } from '../../achievements/achievementService.js';
import { ACTION_TYPES } from '../../achievements/achievementConfig.js';

// ============================================================
// Type Definitions
// ============================================================

interface VideoPokerGameState {
  deck: Deck;
  hand: Hand;
  bet: number;
  originalBet: number;
  variantId: string;
  phase: 'selecting' | 'finished';
  heldCards: [boolean, boolean, boolean, boolean, boolean];
}

// ============================================================
// Module State
// ============================================================

// In-memory state tracking (resets on bot restart)
const activeGames: Map<string, VideoPokerGameState> = new Map();
const videoPokerCooldowns: Map<string, number> = new Map();

// ============================================================
// Command Definition
// ============================================================

export const data = new SlashCommandBuilder()
  .setName('videopoker')
  .setDescription('Play Video Poker (Jacks or Better)!')
  .addStringOption((option) =>
    option.setName('amount').setDescription("Amount to bet (number or 'all')").setRequired(true)
  );

// ============================================================
// Helper Functions
// ============================================================

/**
 * Create the game embed showing the current hand
 */
function createGameEmbed(
  game: VideoPokerGameState,
  variant: VideoPokerVariant,
  status: string,
  color: number,
  showPayoutTable: boolean = true
): EmbedBuilder {
  const handDisplay = game.phase === 'selecting'
    ? formatVideoPokerHand(game.hand, game.heldCards)
    : formatVideoPokerHandSimple(game.hand);

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🃏 Video Poker - ${variant.name}`)
    .setDescription(`**Your Hand:**\n${handDisplay}`)
    .addFields({ name: 'Bet', value: formatCurrency(game.bet), inline: true })
    .setFooter({ text: status })
    .setTimestamp();

  // Add payout table as a field
  if (showPayoutTable) {
    const payoutInfo = [
      `Royal Flush: ${JACKS_OR_BETTER_PAYOUTS[HandRank.ROYAL_FLUSH]}x`,
      `Straight Flush: ${JACKS_OR_BETTER_PAYOUTS[HandRank.STRAIGHT_FLUSH]}x`,
      `Four of a Kind: ${JACKS_OR_BETTER_PAYOUTS[HandRank.FOUR_OF_A_KIND]}x`,
      `Full House: ${JACKS_OR_BETTER_PAYOUTS[HandRank.FULL_HOUSE]}x`,
      `Flush: ${JACKS_OR_BETTER_PAYOUTS[HandRank.FLUSH]}x`,
      `Straight: ${JACKS_OR_BETTER_PAYOUTS[HandRank.STRAIGHT]}x`,
      `3 of a Kind: ${JACKS_OR_BETTER_PAYOUTS[HandRank.THREE_OF_A_KIND]}x`,
      `Two Pair: ${JACKS_OR_BETTER_PAYOUTS[HandRank.TWO_PAIR]}x`,
      `Jacks+: ${JACKS_OR_BETTER_PAYOUTS[HandRank.JACKS_OR_BETTER]}x`,
    ].join(' | ');
    embed.addFields({ name: 'Payouts', value: payoutInfo, inline: false });
  }

  return embed;
}

/**
 * Create the hold buttons row
 */
function createHoldButtons(
  game: VideoPokerGameState,
  disabled: boolean = false
): ActionRowBuilder<ButtonBuilder> {
  const buttons: ButtonBuilder[] = [];

  for (let i = 0; i < 5; i++) {
    const isHeld = game.heldCards[i];
    const button = new ButtonBuilder()
      .setCustomId(`vp_hold_${i}`)
      .setLabel(isHeld ? `HOLD ${i + 1}` : `Card ${i + 1}`)
      .setStyle(isHeld ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setDisabled(disabled);
    buttons.push(button);
  }

  return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
}

/**
 * Create the action buttons row (Draw, Hold All, Clear)
 */
function createActionButtons(
  disabled: boolean = false
): ActionRowBuilder<ButtonBuilder> {
  const drawButton = new ButtonBuilder()
    .setCustomId('vp_draw')
    .setLabel('DRAW')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(disabled);

  const holdAllButton = new ButtonBuilder()
    .setCustomId('vp_hold_all')
    .setLabel('Hold All')
    .setStyle(ButtonStyle.Success)
    .setDisabled(disabled);

  const clearButton = new ButtonBuilder()
    .setCustomId('vp_clear')
    .setLabel('Clear Holds')
    .setStyle(ButtonStyle.Danger)
    .setDisabled(disabled);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    drawButton,
    holdAllButton,
    clearButton
  );
}

/**
 * Create play again button row
 */
function createPlayAgainRow(originalBet: number): ActionRowBuilder<ButtonBuilder> {
  const playAgainButton = new ButtonBuilder()
    .setCustomId(`vp_replay_${originalBet}`)
    .setLabel(`Play Again (${formatCurrency(originalBet)})`)
    .setStyle(ButtonStyle.Success);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(playAgainButton);
}

/**
 * Resolve the game after draw
 */
async function resolveGame(
  interaction: ChatInputCommandInteraction,
  game: VideoPokerGameState,
  userId: string,
  variant: VideoPokerVariant
): Promise<void> {
  // Evaluate the final hand
  const result = variant.evaluateHand(game.hand);
  const payout = game.bet * result.multiplier;

  // Award payout if any
  let updatedUser: EconomyUser | null;
  if (payout > 0) {
    updatedUser = await economyDb.gambleWin(userId, payout);
  } else {
    updatedUser = await economyDb.getUser(userId);
  }

  // Determine outcome for stats
  const outcome: 'win' | 'loss' = result.isWin ? 'win' : 'loss';

  // Record stats
  try {
    await videoPokerDb.recordGameResult({
      userId,
      username: interaction.user.username,
      variantId: game.variantId,
      outcome,
      handRank: result.rank,
      bet: game.bet,
      payout,
    });
  } catch (statsError) {
    console.error('Failed to record video poker stats:', statsError);
  }

  // Check for achievements
  const actionType = result.isWin ? ACTION_TYPES.VIDEO_POKER_WIN : ACTION_TYPES.VIDEO_POKER_LOSE;
  checkForAchievements({
    actionType,
    userId,
    username: interaction.user.username,
    client: interaction.client,
    amount: result.isWin ? payout : game.bet,
  }).catch((err) => console.error('Failed to check achievements:', err));

  // Check for royal flush achievement
  if (result.rank === HandRank.ROYAL_FLUSH) {
    checkForAchievements({
      actionType: ACTION_TYPES.VIDEO_POKER_ROYAL_FLUSH,
      userId,
      username: interaction.user.username,
      client: interaction.client,
      amount: payout,
    }).catch((err) => console.error('Failed to check royal flush achievement:', err));
  }

  // Build result embed
  const resultEmoji = getHandEmoji(result.rank);
  const color = result.isWin ? (result.isBigWin ? 0xf1c40f : 0x2ecc71) : 0xe74c3c;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`🃏 Video Poker - ${result.isWin ? 'Winner!' : 'No Win'}`)
    .setDescription(
      `**Your Hand:**\n${formatVideoPokerHandSimple(game.hand)}\n\n` +
        `${resultEmoji} **${result.name}** ${resultEmoji}`
    )
    .addFields(
      { name: 'Bet', value: formatCurrency(game.bet), inline: true },
      {
        name: payout > 0 ? 'Payout' : 'Lost',
        value: payout > 0 ? formatCurrency(payout) : formatCurrency(game.bet),
        inline: true,
      },
      { name: 'Balance', value: formatCurrency(updatedUser?.wallet ?? 0), inline: true }
    )
    .setFooter({
      text: result.isWin
        ? `${result.multiplier}x multiplier!`
        : 'Better luck next hand!',
    })
    .setTimestamp();

  // Show result with Play Again button if can afford
  const canPlayAgain = (updatedUser?.wallet ?? 0) >= game.originalBet;
  const components: ActionRowBuilder<ButtonBuilder>[] = [];
  if (canPlayAgain) {
    components.push(createPlayAgainRow(game.originalBet));
  }

  const response = await interaction.editReply({
    embeds: [embed],
    components,
  });

  // Create Play Again button collector
  if (canPlayAgain) {
    const replayCollector = response.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 30000,
      filter: (i: ButtonInteraction) =>
        i.user.id === userId && i.customId.startsWith('vp_replay_'),
    });

    replayCollector.on('collect', async (buttonInteraction: ButtonInteraction) => {
      // Check cooldown
      const lastGame = videoPokerCooldowns.get(userId);
      if (lastGame) {
        const elapsed = Date.now() - lastGame;
        const cooldownMs = CONFIG.VIDEO_POKER_COOLDOWN_SECONDS * 1000;
        if (elapsed < cooldownMs) {
          const remaining = Math.ceil((cooldownMs - elapsed) / 1000);
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
          content: 'You already have a video poker game in progress!',
          ephemeral: true,
        });
        return;
      }

      // Re-fetch wallet
      const currentUser = await economyDb.getUser(userId);
      if (!currentUser || currentUser.wallet < game.originalBet) {
        await buttonInteraction.reply({
          content: `You don't have enough coins! Need ${formatCurrency(game.originalBet)}.`,
          ephemeral: true,
        });
        return;
      }

      // Remove Play Again button
      replayCollector.stop('replaying');
      await buttonInteraction.update({ components: [] });

      // Start new game
      await executeNewGame(interaction, game.originalBet);
    });

    replayCollector.on('end', async (_collected, reason: string) => {
      if (reason === 'time') {
        try {
          await interaction.editReply({ embeds: [embed], components: [] });
        } catch {
          // Ignore
        }
      }
    });
  }

  // Announce big wins in casino channel
  if (result.isBigWin && CHANNELS.CASINO) {
    try {
      const casinoChannel = await interaction.client.channels.fetch(CHANNELS.CASINO);
      if (casinoChannel && 'send' in casinoChannel) {
        const announcementEmbed = new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle(`🃏 ${result.name}! 🃏`)
          .setDescription(
            `${formatVideoPokerHandSimple(game.hand)}\n\n` +
              `<@${userId}> just hit **${result.name}** in Video Poker!\n\n` +
              `Won ${formatCurrency(payout)} on a ${formatCurrency(game.originalBet)} bet!`
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

/**
 * Execute a new game
 */
async function executeNewGame(
  interaction: ChatInputCommandInteraction,
  amount: number
): Promise<void> {
  const userId = interaction.user.id;
  const variant = getDefaultVariant();

  // Deduct bet
  const betResult = await economyDb.gambleLose(userId, amount);
  if (!betResult) {
    await interaction.editReply({
      content: 'Something went wrong placing your bet. Please try again.',
    });
    return;
  }

  // Set cooldown
  videoPokerCooldowns.set(userId, Date.now());

  // Create deck and deal 5 cards
  const deck = variant.createDeck();
  const hand: Hand = [];
  for (let i = 0; i < 5; i++) {
    const card = drawCard(deck);
    if (card) {
      hand.push(card);
    }
  }

  if (hand.length !== 5) {
    await interaction.editReply({
      content: 'Something went wrong dealing cards. Please try again.',
    });
    return;
  }

  // Initialize game state
  const game: VideoPokerGameState = {
    deck,
    hand,
    bet: amount,
    originalBet: amount,
    variantId: variant.id,
    phase: 'selecting',
    heldCards: [false, false, false, false, false],
  };

  activeGames.set(userId, game);

  // Show initial hand with hold buttons
  const embed = createGameEmbed(game, variant, 'Select cards to HOLD, then press DRAW', 0xf1c40f);
  const holdRow = createHoldButtons(game);
  const actionRow = createActionButtons();

  const response = await interaction.editReply({
    embeds: [embed],
    components: [holdRow, actionRow],
  });

  // Create button collector
  const collector = response.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: CONFIG.VIDEO_POKER_TIMEOUT_SECONDS * 1000,
    filter: (i: ButtonInteraction) =>
      i.user.id === userId &&
      (i.customId.startsWith('vp_hold_') ||
        i.customId === 'vp_draw' ||
        i.customId === 'vp_hold_all' ||
        i.customId === 'vp_clear'),
  });

  collector.on('collect', async (buttonInteraction: ButtonInteraction) => {
    const currentGame = activeGames.get(userId);
    if (!currentGame || currentGame.phase !== 'selecting') {
      await buttonInteraction.reply({
        content: 'This game is no longer active.',
        ephemeral: true,
      });
      return;
    }

    const action = buttonInteraction.customId;

    if (action.startsWith('vp_hold_') && action !== 'vp_hold_all') {
      // Toggle hold for specific card
      const cardIndex = parseInt(action.split('_')[2], 10);
      if (cardIndex >= 0 && cardIndex < 5) {
        currentGame.heldCards[cardIndex] = !currentGame.heldCards[cardIndex];

        // Update display
        const updatedEmbed = createGameEmbed(
          currentGame,
          variant,
          'Select cards to HOLD, then press DRAW',
          0xf1c40f
        );
        const updatedHoldRow = createHoldButtons(currentGame);
        const updatedActionRow = createActionButtons();

        await buttonInteraction.update({
          embeds: [updatedEmbed],
          components: [updatedHoldRow, updatedActionRow],
        });
      }
    } else if (action === 'vp_hold_all') {
      // Hold all cards
      currentGame.heldCards = [true, true, true, true, true];

      const updatedEmbed = createGameEmbed(
        currentGame,
        variant,
        'All cards held! Press DRAW to keep this hand.',
        0xf1c40f
      );
      const updatedHoldRow = createHoldButtons(currentGame);
      const updatedActionRow = createActionButtons();

      await buttonInteraction.update({
        embeds: [updatedEmbed],
        components: [updatedHoldRow, updatedActionRow],
      });
    } else if (action === 'vp_clear') {
      // Clear all holds
      currentGame.heldCards = [false, false, false, false, false];

      const updatedEmbed = createGameEmbed(
        currentGame,
        variant,
        'Holds cleared. Select cards to HOLD, then press DRAW',
        0xf1c40f
      );
      const updatedHoldRow = createHoldButtons(currentGame);
      const updatedActionRow = createActionButtons();

      await buttonInteraction.update({
        embeds: [updatedEmbed],
        components: [updatedHoldRow, updatedActionRow],
      });
    } else if (action === 'vp_draw') {
      // Draw replacement cards
      currentGame.phase = 'finished';
      collector.stop('draw');

      // Replace non-held cards
      for (let i = 0; i < 5; i++) {
        if (!currentGame.heldCards[i]) {
          const newCard = drawCard(currentGame.deck);
          if (newCard) {
            currentGame.hand[i] = newCard;
          }
        }
      }

      await buttonInteraction.deferUpdate();
      await resolveGame(interaction, currentGame, userId, variant);
    }
  });

  collector.on('end', async (_collected, reason: string) => {
    const currentGame = activeGames.get(userId);
    if (reason === 'time' && currentGame && currentGame.phase === 'selecting') {
      // Auto-draw on timeout
      currentGame.phase = 'finished';

      // Replace non-held cards
      for (let i = 0; i < 5; i++) {
        if (!currentGame.heldCards[i]) {
          const newCard = drawCard(currentGame.deck);
          if (newCard) {
            currentGame.hand[i] = newCard;
          }
        }
      }

      await resolveGame(interaction, currentGame, userId, variant);
    }
  });
}

// ============================================================
// Command Execution
// ============================================================

export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const amountStr = interaction.options.getString('amount')!.toLowerCase();

    // Check cooldown
    const lastGame = videoPokerCooldowns.get(userId);
    if (lastGame) {
      const elapsed = Date.now() - lastGame;
      const cooldownMs = CONFIG.VIDEO_POKER_COOLDOWN_SECONDS * 1000;
      if (elapsed < cooldownMs) {
        const remaining = Math.ceil((cooldownMs - elapsed) / 1000);
        await interaction.editReply({
          content: `Slow down! You can play again in ${remaining} seconds.`,
        });
        return;
      }
    }

    // Check for existing game
    if (activeGames.has(userId)) {
      await interaction.editReply({
        content: 'You already have a video poker game in progress! Finish it first.',
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
    if (amount < CONFIG.VIDEO_POKER_MIN) {
      await interaction.editReply({
        content: `Minimum bet is ${formatCurrency(CONFIG.VIDEO_POKER_MIN)}.`,
      });
      return;
    }

    if (amount > CONFIG.VIDEO_POKER_MAX) {
      await interaction.editReply({
        content: `Maximum bet is ${formatCurrency(CONFIG.VIDEO_POKER_MAX)}.`,
      });
      return;
    }

    // Check wallet balance
    if (userData.wallet < amount) {
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('🃏 Video Poker Failed')
        .setDescription(
          `You don't have enough coins in your wallet!\n\n` +
            `Your wallet: ${formatCurrency(userData.wallet)}\n` +
            `Bet amount: ${formatCurrency(amount)}`
        )
        .setFooter({ text: 'Tip: Use /withdraw to get coins from your bank' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Start the game
    await executeNewGame(interaction, amount);
  } catch (error: unknown) {
    console.error('videopoker command error:', error);
    activeGames.delete(interaction.user.id);
    const message = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `An error occurred: ${message}`,
    });
  }
}
