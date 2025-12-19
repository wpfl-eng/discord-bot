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
  formatHand,
  drawCard,
  getVisibleDealerValue,
} from "./blackjackUtils.js";

// In-memory state tracking (resets on bot restart)
const activeGames = new Map();
const blackjackCooldowns = new Map();

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
  const playerValue = calculateHandValue(game.playerHand);
  const dealerValue = hideDealer
    ? getVisibleDealerValue(game.dealerHand, true)
    : calculateHandValue(game.dealerHand);

  const dealerValueText = hideDealer ? `showing: ${dealerValue}` : `${dealerValue}`;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle("🃏 Blackjack")
    .setDescription(
      `**Dealer's Hand:**\n${formatHand(game.dealerHand, hideDealer)} *(${dealerValueText})*\n\n` +
        `**Your Hand:**\n${formatHand(game.playerHand)} *(${playerValue})*`
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
 * @returns {ActionRowBuilder}
 */
function createButtons(game, canDoubleDown = true, disabled = false) {
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

  return new ActionRowBuilder().addComponents(hitButton, standButton, doubleButton);
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
 * @returns {{outcome: string, payout: number, color: number}}
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
      payout: game.bet, // Return original bet
      color: 0x3498db, // Blue
    };
  }

  // Player has blackjack - 3:2 payout
  if (playerBJ) {
    return {
      outcome: "Blackjack! You win 3:2!",
      payout: Math.floor(game.bet * 2.5),
      color: 0xf1c40f, // Gold
      isBigWin: true,
    };
  }

  // Dealer has blackjack - player loses
  if (dealerBJ) {
    return {
      outcome: "Dealer has Blackjack! You lose.",
      payout: 0,
      color: 0xe74c3c, // Red
    };
  }

  // Player busted
  if (playerValue > 21) {
    return {
      outcome: "Bust! You went over 21.",
      payout: 0,
      color: 0xe74c3c, // Red
    };
  }

  // Dealer busted
  if (dealerValue > 21) {
    return {
      outcome: "Dealer busts! You win!",
      payout: game.bet * 2,
      color: 0x2ecc71, // Green
    };
  }

  // Compare hands
  if (playerValue > dealerValue) {
    return {
      outcome: "You win!",
      payout: game.bet * 2,
      color: 0x2ecc71, // Green
    };
  } else if (dealerValue > playerValue) {
    return {
      outcome: "Dealer wins!",
      payout: 0,
      color: 0xe74c3c, // Red
    };
  } else {
    return {
      outcome: "Push! It's a tie.",
      payout: game.bet, // Return original bet
      color: 0x3498db, // Blue
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
  const { outcome, payout, color, isBigWin } = determineOutcome(game);

  // Award payout if any
  let updatedUser;
  if (payout > 0) {
    updatedUser = await economyDb.gambleWin(userId, payout);
  } else {
    updatedUser = await economyDb.getUser(userId);
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

  // Add broke text if applicable
  if (updatedUser.wallet === 0) {
    embed.setFooter({ text: `${outcome} 💸 You're broke!` });
  }

  await interaction.editReply({
    embeds: [embed],
    components: [createButtons(game, false, true)],
  });

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

    // Deduct bet FIRST (game spans multiple interactions)
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
    };

    activeGames.set(userId, game);

    // Check for immediate naturals
    const playerBJ = isBlackjack(game.playerHand);
    const dealerBJ = isBlackjack(game.dealerHand);

    if (playerBJ || dealerBJ) {
      // Immediate resolution
      await resolveGame(interaction, game, userId);
      return;
    }

    // Check if player can afford to double down
    const canDoubleDown = betResult.wallet >= amount;

    // Show game with buttons
    const embed = createGameEmbed(game, "Your turn - Hit, Stand, or Double Down?", 0xf1c40f, true);
    const row = createButtons(game, canDoubleDown);

    const response = await interaction.editReply({
      embeds: [embed],
      components: [row],
    });

    // Create button collector
    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: CONFIG.BLACKJACK_TIMEOUT_SECONDS * 1000,
      filter: (i) => i.user.id === userId,
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
        // Hit - draw a card
        currentGame.playerHand.push(drawCard(currentGame.deck));
        currentGame.hasHit = true;

        const playerValue = calculateHandValue(currentGame.playerHand);

        if (playerValue > 21) {
          // Bust
          currentGame.phase = "finished";
          collector.stop("bust");
          await buttonInteraction.deferUpdate();
          await resolveGame(interaction, currentGame, userId);
        } else if (playerValue === 21) {
          // Auto-stand on 21
          currentGame.phase = "dealer_turn";
          playDealerTurn(currentGame);
          currentGame.phase = "finished";
          collector.stop("21");
          await buttonInteraction.deferUpdate();
          await resolveGame(interaction, currentGame, userId);
        } else {
          // Continue playing - can no longer double down
          const embed = createGameEmbed(
            currentGame,
            "Your turn - Hit or Stand?",
            0xf1c40f,
            true
          );
          const row = createButtons(currentGame, false);

          await buttonInteraction.update({
            embeds: [embed],
            components: [row],
          });
        }
      } else if (action === "blackjack_stand") {
        // Stand - dealer's turn
        currentGame.phase = "dealer_turn";
        playDealerTurn(currentGame);
        currentGame.phase = "finished";
        collector.stop("stand");
        await buttonInteraction.deferUpdate();
        await resolveGame(interaction, currentGame, userId);
      } else if (action === "blackjack_double") {
        // Double down
        if (currentGame.hasHit) {
          await buttonInteraction.reply({
            content: "You can only double down on your first two cards!",
            ephemeral: true,
          });
          return;
        }

        // Re-fetch wallet to check if user can afford
        const currentUser = await economyDb.getUser(userId);
        if (currentUser.wallet < currentGame.originalBet) {
          await buttonInteraction.reply({
            content: `You don't have enough coins to double down! Need ${formatCurrency(currentGame.originalBet)}.`,
            ephemeral: true,
          });
          return;
        }

        // Deduct additional bet
        const doubleResult = await economyDb.gambleLose(userId, currentGame.originalBet);
        if (!doubleResult) {
          await buttonInteraction.reply({
            content: "Insufficient funds to double down!",
            ephemeral: true,
          });
          return;
        }

        // Update bet amount
        currentGame.bet = currentGame.bet + currentGame.originalBet;
        currentGame.doubledDown = true;

        // Draw exactly one card
        currentGame.playerHand.push(drawCard(currentGame.deck));

        const playerValue = calculateHandValue(currentGame.playerHand);

        if (playerValue > 21) {
          // Bust
          currentGame.phase = "finished";
          collector.stop("bust_double");
          await buttonInteraction.deferUpdate();
          await resolveGame(interaction, currentGame, userId);
        } else {
          // Auto-stand after double down
          currentGame.phase = "dealer_turn";
          playDealerTurn(currentGame);
          currentGame.phase = "finished";
          collector.stop("double");
          await buttonInteraction.deferUpdate();
          await resolveGame(interaction, currentGame, userId);
        }
      }
    });

    collector.on("end", async (collected, reason) => {
      const currentGame = activeGames.get(userId);

      // Handle timeout - auto-stand
      if (reason === "time" && currentGame && currentGame.phase === "playing") {
        currentGame.phase = "dealer_turn";
        playDealerTurn(currentGame);
        currentGame.phase = "finished";

        const embed = createGameEmbed(
          currentGame,
          "Time's up! Auto-standing...",
          0xf1c40f,
          false
        );
        await interaction.editReply({
          embeds: [embed],
          components: [createButtons(currentGame, false, true)],
        });

        await resolveGame(interaction, currentGame, userId);
      }
    });
  } catch (error) {
    console.error("blackjack command error:", error);
    activeGames.delete(interaction.user.id);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}
