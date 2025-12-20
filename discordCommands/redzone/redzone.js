import {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} from 'discord.js';
import * as economyDb from '../../economy/economyDb.js';
import {
  CONFIG,
  formatCurrency,
  randomInt,
  REDZONE_FIELD_POSITIONS,
  CHANNELS,
} from '../../economy/economyConfig.js';
import * as redzoneDb from '../../redzone/redzoneDb.js';
import { checkForAchievements } from '../../achievements/achievementService.js';
import { ACTION_TYPES } from '../../achievements/achievementConfig.js';

/** @type {Map<string, object>} */
const activeGames = new Map();
/** @type {Map<string, number>} */
const redzoneCooldowns = new Map();

export const data = new SlashCommandBuilder()
  .setName('redzone')
  .setDescription('Push your luck football game - drive for a touchdown!')
  .addStringOption((option) =>
    option
      .setName('bet')
      .setDescription("Amount to bet (10-10000, or 'all'/'max')")
      .setRequired(true)
  );

/**
 * Get the field position data for a given yard line
 * @param {number} yardLine - Current yard line (20-100)
 * @returns {{multiplier: number, fumbleChance: number, label: string}}
 */
function getFieldPosition(yardLine) {
  // Find the closest 10-yard marker at or below the current position
  const marker = Math.floor(yardLine / 10) * 10;
  const clampedMarker = Math.min(Math.max(marker, 20), 100);
  return REDZONE_FIELD_POSITIONS[clampedMarker] || REDZONE_FIELD_POSITIONS[20];
}

/**
 * Render a visual field progress bar
 * @param {number} yardLine - Current yard line (20-100)
 * @returns {string} - Visual representation of field position
 */
function renderField(yardLine) {
  const totalYards = 80; // 20 to 100
  const progress = yardLine - 20;
  const barLength = 20;
  const filled = Math.floor((progress / totalYards) * barLength);

  // Create progress bar with football marker
  let bar = '';
  for (let i = 0; i < barLength; i++) {
    if (i < filled) {
      bar += '=';
    } else if (i === filled) {
      bar += '>';
    } else {
      bar += ' ';
    }
  }

  return `\`[${bar}]\``;
}

/**
 * Get a description of the field position
 * @param {number} yardLine - Current yard line
 * @returns {string}
 */
function getFieldDescription(yardLine) {
  if (yardLine >= 100) return 'TOUCHDOWN!';
  if (yardLine >= 80) return `Opp ${100 - yardLine} - RED ZONE`;
  if (yardLine >= 50) return `Opp ${100 - yardLine}`;
  if (yardLine > 20) return `Own ${yardLine}`;
  return 'Own 20 - Starting Position';
}

/**
 * Create the game embed
 * @param {object} game - Game state
 * @param {string} status - Status message
 * @param {number} color - Embed color
 * @returns {EmbedBuilder}
 */
function createGameEmbed(game, status, color) {
  const position = getFieldPosition(game.yardLine);
  const potentialPayout = Math.floor(game.bet * position.multiplier);
  const profit = potentialPayout - game.bet;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle('🏈 RED ZONE 🏈')
    .setDescription(
      `${renderField(game.yardLine)}\n` +
        `**${getFieldDescription(game.yardLine)}**\n\n` +
        `Current Multiplier: **${position.multiplier}x**\n` +
        `Potential Payout: **${formatCurrency(potentialPayout)}** (+${formatCurrency(profit)})\n\n` +
        `Fumble Risk: **${Math.round(position.fumbleChance * 100)}%**`
    )
    .addFields(
      { name: 'Bet', value: formatCurrency(game.bet), inline: true },
      { name: 'Yards Gained', value: `${game.yardsGained}`, inline: true }
    )
    .setFooter({ text: status })
    .setTimestamp();

  return embed;
}

/**
 * Create action buttons
 * @param {boolean} disabled - Whether buttons should be disabled
 * @returns {ActionRowBuilder}
 */
function createButtons(disabled = false) {
  const runButton = new ButtonBuilder()
    .setCustomId('redzone_run')
    .setLabel('🏈 Run Play')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(disabled);

  const cashOutButton = new ButtonBuilder()
    .setCustomId('redzone_cashout')
    .setLabel('💰 Cash Out')
    .setStyle(ButtonStyle.Success)
    .setDisabled(disabled);

  return new ActionRowBuilder().addComponents(runButton, cashOutButton);
}

/**
 * Create a "Play Again" button row
 * @param {number} originalBet - The original bet amount
 * @returns {ActionRowBuilder}
 */
function createPlayAgainRow(originalBet) {
  const playAgainButton = new ButtonBuilder()
    .setCustomId(`redzone_replay_${originalBet}`)
    .setLabel(`Play Again (${formatCurrency(originalBet)})`)
    .setStyle(ButtonStyle.Success);

  return new ActionRowBuilder().addComponents(playAgainButton);
}

/**
 * Run a play - advance and check for fumble
 * @param {object} game - Game state
 * @returns {{fumbled: boolean, yardsGained: number, touchdown: boolean}}
 */
function runPlay(game) {
  const position = getFieldPosition(game.yardLine);

  // Check for fumble first
  if (Math.random() < position.fumbleChance) {
    return { fumbled: true, yardsGained: 0, touchdown: false };
  }

  // Gain yards
  const yards = randomInt(CONFIG.REDZONE_YARD_GAIN_MIN, CONFIG.REDZONE_YARD_GAIN_MAX);
  game.yardLine = Math.min(game.yardLine + yards, 100);
  game.yardsGained += yards;

  // Check for touchdown
  if (game.yardLine >= 100) {
    return { fumbled: false, yardsGained: yards, touchdown: true };
  }

  return { fumbled: false, yardsGained: yards, touchdown: false };
}

/**
 * Resolve the game with a final outcome
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {object} game - Game state
 * @param {string} userId - User ID
 * @param {'touchdown'|'fumble'|'cashout'} outcome - Game outcome
 */
async function resolveGame(interaction, game, userId, outcome) {
  const position = getFieldPosition(game.yardLine);
  let payout = 0;
  let color;
  let title;
  let description;
  let isBigWin = false;

  switch (outcome) {
    case 'touchdown':
      payout = Math.floor(game.bet * 10.0); // 10x for touchdown
      color = 0x2ecc71; // Green
      title = '🏆 TOUCHDOWN!!! 🏆';
      description = `You drove 80 yards for the score!\n\n**10x PAYOUT!**`;
      isBigWin = true;
      break;

    case 'fumble':
      payout = 0;
      color = 0xe74c3c; // Red
      title = '💥 FUMBLE! 💥';
      description = `The defense recovers at the ${getFieldDescription(game.yardLine)}!\n\nYou lost your bet.`;
      break;

    case 'cashout':
      payout = Math.floor(game.bet * position.multiplier);
      color = 0x3498db; // Blue
      title = '💰 Cashed Out! 💰';
      description = `Smart play! You cashed out at **${position.multiplier}x**`;
      break;
  }

  // Award payout if any
  let updatedUser;
  if (payout > 0) {
    updatedUser = await economyDb.gambleWin(userId, payout);
  } else {
    updatedUser = await economyDb.getUser(userId);
  }

  const profit = payout - game.bet;

  // Record stats
  let stats = null;
  try {
    stats = await redzoneDb.recordGameResult({
      userId,
      username: interaction.user.username,
      outcome,
      bet: game.bet,
      payout,
      yardsGained: game.yardsGained,
    });
  } catch (statsError) {
    console.error('Failed to record redzone stats:', statsError);
  }

  // Check for achievements (non-blocking)
  // Touchdown and cashout with profit are wins, fumble is a loss
  const isWin = outcome === 'touchdown' || (outcome === 'cashout' && payout > game.bet);
  checkForAchievements({
    actionType: isWin ? ACTION_TYPES.REDZONE_WIN : ACTION_TYPES.REDZONE_LOSE,
    userId,
    username: interaction.user.username,
    client: interaction.client,
    amount: isWin ? payout : game.bet,
    outcome,
    yardsGained: game.yardsGained,
  }).catch((err) => console.error('Failed to check achievements:', err));

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(`${renderField(game.yardLine)}\n\n` + description)
    .addFields(
      { name: 'Bet', value: formatCurrency(game.bet), inline: true },
      {
        name: payout > 0 ? 'Payout' : 'Lost',
        value:
          payout > 0
            ? `${formatCurrency(payout)} (+${formatCurrency(profit)})`
            : formatCurrency(game.bet),
        inline: true,
      },
      { name: 'Balance', value: formatCurrency(updatedUser.wallet), inline: true },
      { name: 'Yards Gained', value: `${game.yardsGained}`, inline: true }
    )
    .setTimestamp();

  // Add streak info to footer
  let footerText = '';
  if (stats) {
    if (outcome === 'touchdown' && stats.current_td_streak > 1) {
      footerText = `${stats.current_td_streak} touchdown streak! 🔥`;
    } else if (outcome === 'fumble' && stats.current_td_streak < -1) {
      footerText = `${Math.abs(stats.current_td_streak)} fumble streak 😔`;
    }
  }
  if (updatedUser.wallet === 0) {
    footerText += footerText ? " | You're broke!" : "You're broke!";
  }
  if (footerText) {
    embed.setFooter({ text: footerText });
  }

  // Show result with Play Again button
  const canPlayAgain = updatedUser.wallet >= game.originalBet;
  const components = [createButtons(true)];
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
      filter: (i) => i.user.id === userId && i.customId.startsWith('redzone_replay_'),
    });

    replayCollector.on('collect', async (buttonInteraction) => {
      // Check cooldown
      const lastGame = redzoneCooldowns.get(userId);
      if (lastGame) {
        const elapsed = Date.now() - lastGame;
        const cooldownMs = CONFIG.REDZONE_COOLDOWN_SECONDS * 1000;
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
          content: 'You already have a Red Zone game in progress!',
          ephemeral: true,
        });
        return;
      }

      // Check wallet
      const currentUser = await economyDb.getUser(userId);
      if (!currentUser || currentUser.wallet < game.originalBet) {
        await buttonInteraction.reply({
          content: `You don't have enough coins! Need ${formatCurrency(game.originalBet)}.`,
          ephemeral: true,
        });
        return;
      }

      // Stop collector and start new game
      replayCollector.stop('replaying');
      await buttonInteraction.update({
        components: [createButtons(true)],
      });
      await executeNewGame(interaction, game.originalBet);
    });

    replayCollector.on('end', async (collected, reason) => {
      if (reason === 'time') {
        try {
          await interaction.editReply({
            embeds: [embed],
            components: [createButtons(true)],
          });
        } catch {
          // Ignore - message may be deleted
        }
      }
    });
  }

  // Announce touchdown wins in casino channel
  if (isBigWin && CHANNELS.CASINO) {
    try {
      const casinoChannel = await interaction.client.channels.fetch(CHANNELS.CASINO);
      if (casinoChannel) {
        const announcementEmbed = new EmbedBuilder()
          .setColor(0x2ecc71)
          .setTitle('🏆 TOUCHDOWN! 🏆')
          .setDescription(
            `<@${userId}> just scored a **TOUCHDOWN** in Red Zone!\n\n` +
              `Won ${formatCurrency(payout)} on a ${formatCurrency(game.originalBet)} bet! (10x)` +
              (stats && stats.best_td_streak > 1
                ? `\n\nBest TD streak: ${stats.best_td_streak}`
                : '')
          )
          .setTimestamp();

        await casinoChannel.send({ embeds: [announcementEmbed] });
      }
    } catch (error) {
      console.error('Failed to send casino announcement:', error);
    }
  }

  // Clean up game state
  activeGames.delete(userId);
}

/**
 * Start a new Red Zone game
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 * @param {number} amount - Bet amount
 */
async function executeNewGame(interaction, amount) {
  const userId = interaction.user.id;

  // Deduct bet
  const betResult = await economyDb.gambleLose(userId, amount);
  if (!betResult) {
    await interaction.editReply({
      content: 'Something went wrong placing your bet. Please try again.',
    });
    return;
  }

  // Set cooldown
  redzoneCooldowns.set(userId, Date.now());

  // Initialize game state
  const game = {
    bet: amount,
    originalBet: amount,
    yardLine: 20, // Start at own 20
    yardsGained: 0,
    phase: 'playing',
  };

  activeGames.set(userId, game);

  // Show initial game state
  const embed = createGameEmbed(
    game,
    'Your ball at your own 20. Run a play or cash out!',
    0xf1c40f
  );
  const row = createButtons(false);

  const response = await interaction.editReply({
    embeds: [embed],
    components: [row],
  });

  // Create button collector
  const collector = response.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: CONFIG.REDZONE_TIMEOUT_SECONDS * 1000,
    filter: (i) => i.user.id === userId && !i.customId.startsWith('redzone_replay_'),
  });

  collector.on('collect', async (buttonInteraction) => {
    const currentGame = activeGames.get(userId);
    if (!currentGame || currentGame.phase !== 'playing') {
      await buttonInteraction.reply({
        content: 'This game is no longer active.',
        ephemeral: true,
      });
      return;
    }

    const action = buttonInteraction.customId;

    if (action === 'redzone_run') {
      const result = runPlay(currentGame);

      if (result.fumbled) {
        currentGame.phase = 'finished';
        collector.stop('fumble');
        await buttonInteraction.deferUpdate();
        await resolveGame(interaction, currentGame, userId, 'fumble');
      } else if (result.touchdown) {
        currentGame.phase = 'finished';
        collector.stop('touchdown');
        await buttonInteraction.deferUpdate();
        await resolveGame(interaction, currentGame, userId, 'touchdown');
      } else {
        // Continue playing - show updated position
        const position = getFieldPosition(currentGame.yardLine);
        const statusMsg = `📣 Great run! +${result.yardsGained} yards! Fumble risk: ${Math.round(position.fumbleChance * 100)}%`;
        const embedUpdate = createGameEmbed(currentGame, statusMsg, 0xf1c40f);
        await buttonInteraction.update({
          embeds: [embedUpdate],
          components: [createButtons(false)],
        });
      }
    } else if (action === 'redzone_cashout') {
      currentGame.phase = 'finished';
      collector.stop('cashout');
      await buttonInteraction.deferUpdate();
      await resolveGame(interaction, currentGame, userId, 'cashout');
    }
  });

  collector.on('end', async (collected, reason) => {
    const currentGame = activeGames.get(userId);
    if (reason === 'time' && currentGame && currentGame.phase === 'playing') {
      // Auto cash out on timeout
      currentGame.phase = 'finished';
      await resolveGame(interaction, currentGame, userId, 'cashout');
    }
  });
}

/**
 * Execute the redzone command
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const betStr = interaction.options.getString('bet').toLowerCase();

    // Check cooldown
    const lastGame = redzoneCooldowns.get(userId);
    if (lastGame) {
      const elapsed = Date.now() - lastGame;
      const cooldownMs = CONFIG.REDZONE_COOLDOWN_SECONDS * 1000;
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
        content: 'You already have a Red Zone game in progress! Finish it first.',
      });
      return;
    }

    // Get or create user
    const userData = await economyDb.getOrCreateUser(userId, username);

    // Parse bet amount
    let amount;
    if (betStr === 'all' || betStr === 'max') {
      amount = userData.wallet;
    } else {
      amount = parseInt(betStr);
    }

    // Validate amount
    if (isNaN(amount) || amount <= 0) {
      await interaction.editReply({
        content: "Please enter a valid bet amount (a positive number or 'all').",
      });
      return;
    }

    // Check min/max
    if (amount < CONFIG.REDZONE_MIN) {
      await interaction.editReply({
        content: `Minimum bet is ${formatCurrency(CONFIG.REDZONE_MIN)}.`,
      });
      return;
    }

    if (amount > CONFIG.REDZONE_MAX) {
      await interaction.editReply({
        content: `Maximum bet is ${formatCurrency(CONFIG.REDZONE_MAX)}.`,
      });
      return;
    }

    // Check wallet balance
    if (userData.wallet < amount) {
      const embed = new EmbedBuilder()
        .setColor(0xe74c3c)
        .setTitle('🏈 Red Zone - Insufficient Funds')
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
  } catch (error) {
    console.error('redzone command error:', error);
    activeGames.delete(interaction.user.id);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}
