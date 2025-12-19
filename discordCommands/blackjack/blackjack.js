import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from "discord.js";
import * as economyDb from "../../economy/economyDb.js";
import {
  CONFIG,
  formatCurrency,
  CHANNELS,
} from "../../economy/economyConfig.js";
import {
  createDeck,
  calculateHandValue,
  isBlackjack,
  isSoft,
  formatHand,
  drawCard,
  getVisibleDealerValue,
} from "./blackjackUtils.js";
import * as blackjackDb from "../../blackjack/blackjackDb.js";
import { checkForAchievements } from "../../achievements/achievementService.js";
import { ACTION_TYPES } from "../../achievements/achievementConfig.js";

// In-memory state tracking (resets on bot restart)
const activeGames = new Map();
const blackjackCooldowns = new Map();

/**
 * Format hand value with soft indicator
 * @param {Array<{suit: string, rank: string}>} hand - The hand to evaluate
 * @returns {string} - Formatted value (e.g., "17" or "Soft 17")
 */
function formatHandValue(hand) {
  const value = calculateHandValue(hand);
  const soft = isSoft(hand);
  return soft && value <= 21 ? `Soft ${value}` : `${value}`;
}

export const data = new SlashCommandBuilder()
  .setName("blackjack")
  .setDescription("Play a game of blackjack!")
  .addStringOption((option) =>
    option
      .setName("amount")
      .setDescription("Amount to bet (number or 'all')")
      .setRequired(true)
  );

/**
 * Create the game embed
 * @param {object} game - Game state
 * @param {string} status - Game status message
 * @param {number} color - Embed color
 * @param {boolean} hideDealer - Whether to hide dealer's second card
 * @returns {EmbedBuilder}
 */
function createGameEmbed(game, status, color, hideDealer = true) {
  const playerValueText = formatHandValue(game.playerHand);
  const dealerValue = hideDealer
    ? getVisibleDealerValue(game.dealerHand, true)
    : calculateHandValue(game.dealerHand);

  const dealerValueText = hideDealer ? `showing: ${dealerValue}` : `${dealerValue}`;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle("🃏 Blackjack")
    .setDescription(
      `**Dealer's Hand:**\n${formatHand(game.dealerHand, hideDealer)} *(${dealerValueText})*\n\n` +
        `**Your Hand:**\n${formatHand(game.playerHand)} *(${playerValueText})*`
    )
    .addFields({ name: "Bet", value: formatCurrency(game.bet), inline: true })
    .setFooter({ text: status })
    .setTimestamp();

  return embed;
}

/**
 * Create action buttons
 * @param {object} game - Game state
 * @param {boolean} canDoubleDown - Whether double down is available
 * @param {boolean} disabled - Whether all buttons should be disabled
 * @param {boolean} canSurrender - Whether surrender is available
 * @returns {ActionRowBuilder}
 */
function createButtons(game, canDoubleDown = true, disabled = false, canSurrender = false) {
  const hitButton = new ButtonBuilder()
    .setCustomId("blackjack_hit")
    .setLabel("Hit")
    .setStyle(ButtonStyle.Primary)
    .setDisabled(disabled);

  const standButton = new ButtonBuilder()
    .setCustomId("blackjack_stand")
    .setLabel("Stand")
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(disabled);

  const doubleButton = new ButtonBuilder()
    .setCustomId("blackjack_double")
    .setLabel("Double Down")
    .setStyle(ButtonStyle.Success)
    .setDisabled(disabled || !canDoubleDown);

  const surrenderButton = new ButtonBuilder()
    .setCustomId("blackjack_surrender")
    .setLabel("Surrender")
    .setStyle(ButtonStyle.Danger)
    .setDisabled(disabled || !canSurrender);

  const buttons = [hitButton, standButton, doubleButton];
  if (canSurrender) {
    buttons.push(surrenderButton);
  }

  return new ActionRowBuilder().addComponents(buttons);
}

/**
 * Create a "Play Again" button row
 * @param {number} originalBet - The original bet amount to replay with
 * @returns {ActionRowBuilder}
 */
function createPlayAgainRow(originalBet) {
  const playAgainButton = new ButtonBuilder()
    .setCustomId(`blackjack_replay_${originalBet}`)
    .setLabel(`Play Again (${formatCurrency(originalBet)})`)
    .setStyle(ButtonStyle.Success);

  return new ActionRowBuilder().addComponents(playAgainButton);
}

/**
 * Play out the dealer's turn
 * @param {object} game - Game state
 */
function playDealerTurn(game) {
  // Dealer hits on 16 or less, stands on 17+
  while (calculateHandValue(game.dealerHand) < 17) {
    game.dealerHand.push(drawCard(game.deck));
  }
}

/**
 * Determine game outcome and payout
 * @param {object} game - Game state
 * @returns {{outcome: string, payout: number, color: number, isWin: boolean, isPush: boolean, isBust: boolean, isBlackjack: boolean, isBigWin?: boolean}}
 */
function determineOutcome(game) {
  const playerValue = calculateHandValue(game.playerHand);
  const dealerValue = calculateHandValue(game.dealerHand);
  const playerBJ = isBlackjack(game.playerHand);
  const dealerBJ = isBlackjack(game.dealerHand);

  // Both have blackjack - push
  if (playerBJ && dealerBJ) {
    return {
      outcome: "Push! Both have Blackjack",
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
      outcome: "Blackjack! You win 3:2!",
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
      outcome: "Dealer has Blackjack! You lose.",
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
      outcome: "Bust! You went over 21.",
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
      outcome: "Dealer busts! You win!",
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
      outcome: "You win!",
      payout: game.bet * 2,
      color: 0x2ecc71,
      isWin: true,
      isPush: false,
      isBust: false,
      isBlackjack: false,
    };
  } else if (dealerValue > playerValue) {
    return {
      outcome: "Dealer wins!",
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

/**
 * Resolve the game and handle payouts
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {object} game - Game state
 * @param {string} userId - User ID
 */
async function resolveGame(interaction, game, userId) {
  const { outcome, payout, color, isBigWin, isWin, isPush, isBust, isBlackjack } = determineOutcome(game);

  // Award payout if any
  let updatedUser;
  if (payout > 0) {
    updatedUser = await economyDb.gambleWin(userId, payout);
  } else {
    updatedUser = await economyDb.getUser(userId);
  }

  // Record stats (non-blocking - don't let stats failure break game)
  let stats = null;
  try {
    const statsOutcome = isWin ? "win" : isPush ? "push" : "loss";
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
    console.error("Failed to record blackjack stats:", statsError);
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
    }).catch((err) => console.error("Failed to check achievements:", err));
  }

  const embed = createGameEmbed(game, outcome, color, false);

  // Update fields with payout info
  embed.spliceFields(0, 1); // Remove old bet field
  embed.addFields(
    { name: "Bet", value: formatCurrency(game.bet), inline: true },
    {
      name: payout > 0 ? "Payout" : "Lost",
      value: payout > 0 ? formatCurrency(payout) : formatCurrency(game.bet),
      inline: true,
    },
    { name: "Balance", value: formatCurrency(updatedUser.wallet), inline: true }
  );

  // Build footer with outcome and streak
  let footerText = outcome;
  if (stats && stats.current_streak > 1) {
    footerText += ` | ${stats.current_streak} win streak!`;
  } else if (stats && stats.current_streak < -1) {
    footerText += ` | ${Math.abs(stats.current_streak)} loss streak`;
  }
  if (updatedUser.wallet === 0) {
    footerText += " | You're broke!";
  }
  embed.setFooter({ text: footerText });

  // Show result with Play Again button (if player can afford the original bet)
  const canPlayAgain = updatedUser.wallet >= game.originalBet;
  const components = [createButtons(game, false, true, false)];
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
      filter: (i) => i.user.id === userId && i.customId.startsWith("blackjack_replay_"),
    });

    replayCollector.on("collect", async (buttonInteraction) => {
      // Check cooldown
      const lastGame = blackjackCooldowns.get(userId);
      if (lastGame) {
        const elapsed = Date.now() - lastGame;
        const cooldownMs = CONFIG.BLACKJACK_COOLDOWN_SECONDS * 1000;
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
          content: "You already have a blackjack game in progress!",
          ephemeral: true,
        });
        return;
      }

      // Re-fetch wallet to validate funds
      const currentUser = await economyDb.getUser(userId);
      if (!currentUser || currentUser.wallet < game.originalBet) {
        await buttonInteraction.reply({
          content: `You don't have enough coins! Need ${formatCurrency(game.originalBet)}.`,
          ephemeral: true,
        });
        return;
      }

      // Remove Play Again button
      replayCollector.stop("replaying");

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
          getString: (name) => (name === "amount" ? game.originalBet.toString() : null),
        },
        deferReply: async () => {},
        editReply: interaction.editReply.bind(interaction),
        user: buttonInteraction.user,
      };

      // Execute a new game
      await executeNewGame(fakeInteraction, game.originalBet);
    });

    replayCollector.on("end", async (collected, reason) => {
      if (reason === "time") {
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
      if (casinoChannel) {
        const announcementEmbed = new EmbedBuilder()
          .setColor(0xf1c40f)
          .setTitle("🃏 BLACKJACK! 🃏")
          .setDescription(
            `<@${userId}> just hit **Natural Blackjack**!\n\nWon ${formatCurrency(payout)} on a ${formatCurrency(game.originalBet)} bet!`
          )
          .setTimestamp();

        await casinoChannel.send({ embeds: [announcementEmbed] });
      }
    } catch (error) {
      console.error("Failed to send casino announcement:", error);
    }
  }

  // Clean up game state
  activeGames.delete(userId);
}

/**
 * Start a new blackjack game (used by both initial execute and replay)
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {number} amount - Bet amount (already validated)
 */
async function executeNewGame(interaction, amount) {
  const userId = interaction.user.id;

  // Deduct bet
  const betResult = await economyDb.gambleLose(userId, amount);
  if (!betResult) {
    await interaction.editReply({
      content: "Something went wrong placing your bet. Please try again.",
    });
    return;
  }

  // Set cooldown
  blackjackCooldowns.set(userId, Date.now());

  // Initialize game state
  const deck = createDeck();
  const game = {
    deck,
    playerHand: [drawCard(deck), drawCard(deck)],
    dealerHand: [drawCard(deck), drawCard(deck)],
    bet: amount,
    originalBet: amount,
    phase: "playing",
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
  const canDoubleDown = betResult.wallet >= amount;

  // Show game with buttons
  const embed = createGameEmbed(game, "Your turn - Hit, Stand, Double Down, or Surrender?", 0xf1c40f, true);
  const row = createButtons(game, canDoubleDown, false, game.canSurrender);

  const response = await interaction.editReply({
    embeds: [embed],
    components: [row],
  });

  // Create button collector
  const collector = response.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: CONFIG.BLACKJACK_TIMEOUT_SECONDS * 1000,
    filter: (i) => i.user.id === userId && !i.customId.startsWith("blackjack_replay_"),
  });

  collector.on("collect", async (buttonInteraction) => {
    const currentGame = activeGames.get(userId);
    if (!currentGame || currentGame.phase !== "playing") {
      await buttonInteraction.reply({
        content: "This game is no longer active.",
        ephemeral: true,
      });
      return;
    }

    const action = buttonInteraction.customId;

    if (action === "blackjack_hit") {
      currentGame.playerHand.push(drawCard(currentGame.deck));
      currentGame.hasHit = true;
      currentGame.canSurrender = false;

      const playerValue = calculateHandValue(currentGame.playerHand);

      if (playerValue > 21) {
        currentGame.phase = "finished";
        collector.stop("bust");
        await buttonInteraction.deferUpdate();
        await resolveGame(interaction, currentGame, userId);
      } else if (playerValue === 21) {
        currentGame.phase = "dealer_turn";
        playDealerTurn(currentGame);
        currentGame.phase = "finished";
        collector.stop("21");
        await buttonInteraction.deferUpdate();
        await resolveGame(interaction, currentGame, userId);
      } else {
        const embedUpdate = createGameEmbed(currentGame, "Your turn - Hit or Stand?", 0xf1c40f, true);
        const rowUpdate = createButtons(currentGame, false, false, false);
        await buttonInteraction.update({ embeds: [embedUpdate], components: [rowUpdate] });
      }
    } else if (action === "blackjack_stand") {
      currentGame.phase = "dealer_turn";
      playDealerTurn(currentGame);
      currentGame.phase = "finished";
      collector.stop("stand");
      await buttonInteraction.deferUpdate();
      await resolveGame(interaction, currentGame, userId);
    } else if (action === "blackjack_double") {
      if (currentGame.hasHit) {
        await buttonInteraction.reply({
          content: "You can only double down on your first two cards!",
          ephemeral: true,
        });
        return;
      }

      const currentUser = await economyDb.getUser(userId);
      if (currentUser.wallet < currentGame.originalBet) {
        await buttonInteraction.reply({
          content: `You don't have enough coins to double down! Need ${formatCurrency(currentGame.originalBet)}.`,
          ephemeral: true,
        });
        return;
      }

      const doubleResult = await economyDb.gambleLose(userId, currentGame.originalBet);
      if (!doubleResult) {
        await buttonInteraction.reply({
          content: "Insufficient funds to double down!",
          ephemeral: true,
        });
        return;
      }

      currentGame.bet = currentGame.bet + currentGame.originalBet;
      currentGame.doubledDown = true;
      currentGame.playerHand.push(drawCard(currentGame.deck));

      const playerValue = calculateHandValue(currentGame.playerHand);

      if (playerValue > 21) {
        currentGame.phase = "finished";
        collector.stop("bust_double");
        await buttonInteraction.deferUpdate();
        await resolveGame(interaction, currentGame, userId);
      } else {
        currentGame.phase = "dealer_turn";
        playDealerTurn(currentGame);
        currentGame.phase = "finished";
        collector.stop("double");
        await buttonInteraction.deferUpdate();
        await resolveGame(interaction, currentGame, userId);
      }
    } else if (action === "blackjack_surrender") {
      if (!currentGame.canSurrender) {
        await buttonInteraction.reply({
          content: "You can only surrender before taking any action!",
          ephemeral: true,
        });
        return;
      }

      const refundAmount = Math.floor(currentGame.bet / 2);
      const refundResult = await economyDb.gambleWin(userId, refundAmount);
      if (!refundResult) {
        await buttonInteraction.reply({
          content: "Something went wrong processing your surrender.",
          ephemeral: true,
        });
        return;
      }

      currentGame.phase = "finished";
      currentGame.surrendered = true;
      collector.stop("surrender");

      // Record surrender in stats
      try {
        await blackjackDb.recordGameResult({
          userId,
          username: interaction.user.username,
          outcome: "loss",
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
        console.error("Failed to record surrender stats:", statsError);
      }

      const finalEmbed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle("🃏 Blackjack - Surrendered")
        .setDescription(
          `**Dealer's Hand:**\n${formatHand(currentGame.dealerHand, false)} *(${calculateHandValue(currentGame.dealerHand)})*\n\n` +
            `**Your Hand:**\n${formatHand(currentGame.playerHand)} *(${formatHandValue(currentGame.playerHand)})*`
        )
        .addFields(
          { name: "Bet", value: formatCurrency(currentGame.bet), inline: true },
          { name: "Refunded", value: formatCurrency(refundAmount), inline: true },
          { name: "Balance", value: formatCurrency(refundResult.wallet), inline: true }
        )
        .setFooter({ text: "You surrendered and got half your bet back." })
        .setTimestamp();

      // Add play again button if can afford
      const canPlayAgain = refundResult.wallet >= currentGame.originalBet;
      const finalComponents = [createButtons(currentGame, false, true, false)];
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
          filter: (i) => i.user.id === userId && i.customId.startsWith("blackjack_replay_"),
        });

        replayCollector.on("collect", async (replayInteraction) => {
          const lastGameCheck = blackjackCooldowns.get(userId);
          if (lastGameCheck) {
            const elapsed = Date.now() - lastGameCheck;
            const cooldownMs = CONFIG.BLACKJACK_COOLDOWN_SECONDS * 1000;
            if (elapsed < cooldownMs) {
              const remaining = Math.ceil((cooldownMs - elapsed) / 1000);
              await replayInteraction.reply({
                content: `Slow down! You can play again in ${remaining} seconds.`,
                ephemeral: true,
              });
              return;
            }
          }

          if (activeGames.has(userId)) {
            await replayInteraction.reply({
              content: "You already have a blackjack game in progress!",
              ephemeral: true,
            });
            return;
          }

          const walletCheck = await economyDb.getUser(userId);
          if (!walletCheck || walletCheck.wallet < currentGame.originalBet) {
            await replayInteraction.reply({
              content: `You don't have enough coins! Need ${formatCurrency(currentGame.originalBet)}.`,
              ephemeral: true,
            });
            return;
          }

          replayCollector.stop("replaying");
          await replayInteraction.update({
            components: [createButtons(currentGame, false, true, false)],
          });
          await executeNewGame(interaction, currentGame.originalBet);
        });

        replayCollector.on("end", async (collected, reason) => {
          if (reason === "time") {
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

  collector.on("end", async (collected, reason) => {
    const currentGame = activeGames.get(userId);
    if (reason === "time" && currentGame && currentGame.phase === "playing") {
      currentGame.phase = "dealer_turn";
      playDealerTurn(currentGame);
      currentGame.phase = "finished";

      const timeoutEmbed = createGameEmbed(currentGame, "Time's up! Auto-standing...", 0xf1c40f, false);
      await interaction.editReply({
        embeds: [timeoutEmbed],
        components: [createButtons(currentGame, false, true, false)],
      });

      await resolveGame(interaction, currentGame, userId);
    }
  });
}

/**
 * Execute the blackjack command
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const amountStr = interaction.options.getString("amount").toLowerCase();

    // Check cooldown
    const lastGame = blackjackCooldowns.get(userId);
    if (lastGame) {
      const elapsed = Date.now() - lastGame;
      const cooldownMs = CONFIG.BLACKJACK_COOLDOWN_SECONDS * 1000;
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
        content: "You already have a blackjack game in progress! Finish it first.",
      });
      return;
    }

    // Get or create user
    const userData = await economyDb.getOrCreateUser(userId, username);

    // Parse amount
    let amount;
    let isAllIn = false;

    if (amountStr === "all" || amountStr === "max") {
      amount = userData.wallet;
      isAllIn = true;
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
        .setTitle("🃏 Blackjack Failed")
        .setDescription(
          `You don't have enough coins in your wallet!\n\nYour wallet: ${formatCurrency(userData.wallet)}\nBet amount: ${formatCurrency(amount)}`
        )
        .setFooter({ text: "Tip: Use /withdraw to get coins from your bank" })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Start the game
    await executeNewGame(interaction, amount);
  } catch (error) {
    console.error("blackjack command error:", error);
    activeGames.delete(interaction.user.id);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}
