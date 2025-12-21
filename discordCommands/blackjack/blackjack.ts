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
} from './blackjackUtils.js';
import type { Hand, Deck, Card } from './blackjackUtils.js';
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
  );

function createGameEmbed(
  game: GameState,
  status: string,
  color: number,
  hideDealer: boolean = true
): EmbedBuilder {
  const playerValueText: string = formatHandValue(game.playerHand);
  const dealerValue: number = hideDealer
    ? getVisibleDealerValue(game.dealerHand, true)
    : calculateHandValue(game.dealerHand);

  const dealerValueText = hideDealer ? `showing: ${dealerValue}` : `${dealerValue}`;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('🃏 Blackjack')
    .setDescription(
      `**Dealer's Hand:**\n${formatHand(game.dealerHand, hideDealer)} *(${dealerValueText})*\n\n` +
        `**Your Hand:**\n${formatHand(game.playerHand)} *(${playerValueText})*`
    )
    .addFields({ name: 'Bet', value: formatCurrency(game.bet), inline: true })
    .setFooter({ text: status })
    .setTimestamp();

  return embed;
}

function createButtons(
  game: GameState,
  canDoubleDown: boolean = true,
  disabled: boolean = false,
  canSurrender: boolean = false
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

  const surrenderButton = new ButtonBuilder()
    .setCustomId('blackjack_surrender')
    .setLabel('Surrender')
    .setStyle(ButtonStyle.Danger)
    .setDisabled(disabled || !canSurrender);

  const buttons: ButtonBuilder[] = [hitButton, standButton, doubleButton];
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

function playDealerTurn(game: GameState): void {
  // Dealer hits on 16 or less, stands on 17+
  while (calculateHandValue(game.dealerHand) < 17) {
    const card: Card | undefined = drawCard(game.deck);
    if (card) {
      game.dealerHand.push(card);
    }
  }
}

function determineOutcome(game: GameState): GameOutcomeResult {
  const playerValue: number = calculateHandValue(game.playerHand);
  const dealerValue: number = calculateHandValue(game.dealerHand);
  const playerBJ: boolean = isBlackjack(game.playerHand);
  const dealerBJ: boolean = isBlackjack(game.dealerHand);

  // Both have blackjack - push
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

  // Dealer has blackjack - player loses
  if (dealerBJ) {
    return {
      outcome: 'Dealer has Blackjack! You lose.',
      payout: 0,
      color: 0xe74c3c,
      isWin: false,
      isPush: false,
      isBust: false,
      isBlackjack: false,
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
  const { outcome, payout, color, isBigWin, isWin, isPush, isBust, isBlackjack }: GameOutcomeResult =
    determineOutcome(game);

  // Award payout if any
  let updatedUser: EconomyUser | null;
  if (payout > 0) {
    updatedUser = await economyDb.gambleWin(userId, payout);
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
      payout,
      wasBlackjack: isBlackjack,
      wasBust: isBust,
      wasDouble: game.doubledDown || false,
      wasSplit: false, // Will be updated when splitting is implemented
      wasInsurance: false, // Will be updated when insurance is implemented
      wasSurrender: false,
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
  embed.addFields(
    { name: 'Bet', value: formatCurrency(game.bet), inline: true },
    {
      name: payout > 0 ? 'Payout' : 'Lost',
      value: payout > 0 ? formatCurrency(payout) : formatCurrency(game.bet),
      inline: true,
    },
    { name: 'Balance', value: formatCurrency(updatedUser?.wallet ?? 0), inline: true }
  );

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

      // Start a new game by calling the command again with the same bet
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

      // Execute a new game
      await executeNewGame(fakeInteraction as unknown as ChatInputCommandInteraction, game.originalBet);
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
  amount: number
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

  // Initialize game state
  const deck: Deck = createDeck();
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
  };

  activeGames.set(userId, game);

  // Check for immediate naturals
  const playerBJ = isBlackjack(game.playerHand);
  const dealerBJ = isBlackjack(game.dealerHand);

  if (playerBJ || dealerBJ) {
    await resolveGame(interaction, game, userId);
    return;
  }

  // Check if player can afford to double down
  const canDoubleDown: boolean = betResult.wallet >= amount;

  // Show game with buttons
  const embed = createGameEmbed(
    game,
    'Your turn - Hit, Stand, Double Down, or Surrender?',
    0xf1c40f,
    true
  );
  const row = createButtons(game, canDoubleDown, false, game.canSurrender);

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
      const newCard: Card | undefined = drawCard(currentGame.deck);
      if (newCard) {
        currentGame.playerHand.push(newCard);
      }
      currentGame.hasHit = true;
      currentGame.canSurrender = false;

      const playerValue: number = calculateHandValue(currentGame.playerHand);

      if (playerValue > 21) {
        currentGame.phase = 'finished';
        collector.stop('bust');
        await buttonInteraction.deferUpdate();
        await resolveGame(interaction, currentGame, userId);
      } else if (playerValue === 21) {
        currentGame.phase = 'dealer_turn';
        playDealerTurn(currentGame);
        currentGame.phase = 'finished';
        collector.stop('21');
        await buttonInteraction.deferUpdate();
        await resolveGame(interaction, currentGame, userId);
      } else {
        const embedUpdate = createGameEmbed(
          currentGame,
          'Your turn - Hit or Stand?',
          0xf1c40f,
          true
        );
        const rowUpdate = createButtons(currentGame, false, false, false);
        await buttonInteraction.update({ embeds: [embedUpdate], components: [rowUpdate] });
      }
    } else if (action === 'blackjack_stand') {
      currentGame.phase = 'dealer_turn';
      playDealerTurn(currentGame);
      currentGame.phase = 'finished';
      collector.stop('stand');
      await buttonInteraction.deferUpdate();
      await resolveGame(interaction, currentGame, userId);
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

      currentGame.bet = currentGame.bet + currentGame.originalBet;
      currentGame.doubledDown = true;
      const doubleCard: Card | undefined = drawCard(currentGame.deck);
      if (doubleCard) {
        currentGame.playerHand.push(doubleCard);
      }

      const playerValue: number = calculateHandValue(currentGame.playerHand);

      if (playerValue > 21) {
        currentGame.phase = 'finished';
        collector.stop('bust_double');
        await buttonInteraction.deferUpdate();
        await resolveGame(interaction, currentGame, userId);
      } else {
        currentGame.phase = 'dealer_turn';
        playDealerTurn(currentGame);
        currentGame.phase = 'finished';
        collector.stop('double');
        await buttonInteraction.deferUpdate();
        await resolveGame(interaction, currentGame, userId);
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
        .setTitle('🃏 Blackjack - Surrendered')
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

      // Create Play Again collector for surrender
      if (canPlayAgain) {
        const replayCollector = response.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: 30000,
          filter: (i: ButtonInteraction) => i.user.id === userId && i.customId.startsWith('blackjack_replay_'),
        });

        replayCollector.on('collect', async (replayInteraction: ButtonInteraction) => {
          const lastGameCheck: number | undefined = blackjackCooldowns.get(userId);
          if (lastGameCheck) {
            const elapsed: number = Date.now() - lastGameCheck;
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

          if (activeGames.has(userId)) {
            await replayInteraction.reply({
              content: 'You already have a blackjack game in progress!',
              ephemeral: true,
            });
            return;
          }

          const walletCheck: EconomyUser | null = await economyDb.getUser(userId);
          if (!walletCheck || walletCheck.wallet < currentGame.originalBet) {
            await replayInteraction.reply({
              content: `You don't have enough coins! Need ${formatCurrency(currentGame.originalBet)}.`,
              ephemeral: true,
            });
            return;
          }

          replayCollector.stop('replaying');
          await replayInteraction.update({
            components: [createButtons(currentGame, false, true, false)],
          });
          await executeNewGame(interaction, currentGame.originalBet);
        });

        replayCollector.on('end', async (_collected, reason: string) => {
          if (reason === 'time') {
            try {
              await interaction.editReply({
                embeds: [finalEmbed],
                components: [createButtons(currentGame, false, true, false)],
              });
            } catch {
              // Ignore
            }
          }
        });
      }
    }
  });

  collector.on('end', async (_collected, reason: string) => {
    const currentGame: GameState | undefined = activeGames.get(userId);
    if (reason === 'time' && currentGame && currentGame.phase === 'playing') {
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
      amount = parseInt(amountStr);
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
    await executeNewGame(interaction, amount);
  } catch (error: unknown) {
    console.error('blackjack command error:', error);
    activeGames.delete(interaction.user.id);
    const message: string = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `An error occurred: ${message}`,
    });
  }
}
