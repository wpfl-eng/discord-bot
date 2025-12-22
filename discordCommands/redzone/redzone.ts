import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ButtonInteraction,
} from 'discord.js';
import * as economyDb from '../../economy/economyDb.js';
import {
  CONFIG,
  formatCurrency,
  randomInt,
  REDZONE_FIELD_POSITIONS,
  CHANNELS,
} from '../../economy/economyConfig.js';
import type { FieldPosition } from '../../economy/economyConfig.js';
import * as redzoneDb from '../../redzone/redzoneDb.js';
import type { GameOutcome, RedzoneStats } from '../../redzone/redzoneDb.js';
import { checkForAchievements } from '../../achievements/achievementService.js';
import { ACTION_TYPES } from '../../achievements/achievementConfig.js';
import type { EconomyUser } from '../../types/database.js';

// ============ Type Definitions ============

/**
 * Game state for an active Red Zone game
 */
interface RedzoneGameState {
  readonly bet: number;
  readonly originalBet: number;
  yardLine: number;
  yardsGained: number;
  phase: 'playing' | 'finished';
}

/**
 * Result of running a play
 */
interface PlayResult {
  readonly fumbled: boolean;
  readonly yardsGained: number;
  readonly touchdown: boolean;
}

// ============ Module State ============

/** Active games keyed by user ID */
const activeGames: Map<string, RedzoneGameState> = new Map();

/** Cooldowns keyed by user ID (timestamp of last game) */
const redzoneCooldowns: Map<string, number> = new Map();

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
 * @param yardLine - Current yard line (20-100)
 * @returns Field position data with multiplier and fumble chance
 */
function getFieldPosition(yardLine: number): FieldPosition {
  // Find the closest 10-yard marker at or below the current position
  const marker: number = Math.floor(yardLine / 10) * 10;
  const clampedMarker: number = Math.min(Math.max(marker, 20), 100);
  return REDZONE_FIELD_POSITIONS[clampedMarker] ?? REDZONE_FIELD_POSITIONS[20];
}

/**
 * Render a visual field progress bar
 * @param yardLine - Current yard line (20-100)
 * @returns Visual representation of field position
 */
function renderField(yardLine: number): string {
  const totalYards: number = 80; // 20 to 100
  const progress: number = yardLine - 20;
  const barLength: number = 20;
  const filled: number = Math.floor((progress / totalYards) * barLength);

  // Create progress bar with football marker
  let bar: string = '';
  for (let i: number = 0; i < barLength; i++) {
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
 * @param yardLine - Current yard line
 * @returns Description string
 */
function getFieldDescription(yardLine: number): string {
  if (yardLine >= 100) return 'TOUCHDOWN!';
  if (yardLine >= 80) return `Opp ${100 - yardLine} - RED ZONE`;
  if (yardLine >= 50) return `Opp ${100 - yardLine}`;
  if (yardLine > 20) return `Own ${yardLine}`;
  return 'Own 20 - Starting Position';
}

/**
 * Create the game embed
 * @param game - Game state
 * @param status - Status message
 * @param color - Embed color
 * @returns Configured embed builder
 */
function createGameEmbed(game: RedzoneGameState, status: string, color: number): EmbedBuilder {
  const position: FieldPosition = getFieldPosition(game.yardLine);
  const potentialPayout: number = Math.floor(game.bet * position.multiplier);
  const profit: number = potentialPayout - game.bet;

  const embed: EmbedBuilder = new EmbedBuilder()
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
 * @param disabled - Whether buttons should be disabled
 * @returns Action row with buttons
 */
function createButtons(disabled: boolean = false): ActionRowBuilder<ButtonBuilder> {
  const runButton: ButtonBuilder = new ButtonBuilder()
    .setCustomId('redzone_run')
    .setLabel('🏈 Run Play')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(disabled);

  const cashOutButton: ButtonBuilder = new ButtonBuilder()
    .setCustomId('redzone_cashout')
    .setLabel('💰 Cash Out')
    .setStyle(ButtonStyle.Success)
    .setDisabled(disabled);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(runButton, cashOutButton);
}

/**
 * Create a "Play Again" button row
 * @param originalBet - The original bet amount
 * @returns Action row with play again button
 */
function createPlayAgainRow(originalBet: number): ActionRowBuilder<ButtonBuilder> {
  const playAgainButton: ButtonBuilder = new ButtonBuilder()
    .setCustomId(`redzone_replay_${originalBet}`)
    .setLabel(`Play Again (${formatCurrency(originalBet)})`)
    .setStyle(ButtonStyle.Success);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(playAgainButton);
}

/**
 * Run a play - advance and check for fumble
 * @param game - Game state (mutated)
 * @returns Play result with fumble, yards gained, and touchdown status
 */
function runPlay(game: RedzoneGameState): PlayResult {
  const position: FieldPosition = getFieldPosition(game.yardLine);

  // Check for fumble first
  if (Math.random() < position.fumbleChance) {
    return { fumbled: true, yardsGained: 0, touchdown: false };
  }

  // Gain yards
  const yards: number = randomInt(CONFIG.REDZONE_YARD_GAIN_MIN, CONFIG.REDZONE_YARD_GAIN_MAX);
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
 * @param interaction - The Discord command interaction
 * @param game - Game state
 * @param userId - User ID
 * @param outcome - Game outcome
 */
async function resolveGame(
  interaction: ChatInputCommandInteraction,
  game: RedzoneGameState,
  userId: string,
  outcome: GameOutcome
): Promise<void> {
  const position: FieldPosition = getFieldPosition(game.yardLine);
  let payout: number = 0;
  let color: number;
  let title: string;
  let description: string;
  let isBigWin: boolean = false;

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
  let updatedUser: EconomyUser | null;
  if (payout > 0) {
    updatedUser = await economyDb.gambleWin(userId, payout);
  } else {
    updatedUser = await economyDb.getUser(userId);
  }

  // Handle null case
  if (!updatedUser) {
    await interaction.editReply({
      content: 'Something went wrong. Please try again.',
    });
    return;
  }

  const profit: number = payout - game.bet;

  // Record stats
  let stats: RedzoneStats | null = null;
  try {
    stats = await redzoneDb.recordGameResult({
      userId,
      username: interaction.user.username,
      outcome,
      bet: game.bet,
      payout,
      yardsGained: game.yardsGained,
    });
  } catch (statsError: unknown) {
    console.error('Failed to record redzone stats:', statsError);
  }

  // Check for achievements (non-blocking)
  // Touchdown and cashout with profit are wins, fumble is a loss
  const isWin: boolean = outcome === 'touchdown' || (outcome === 'cashout' && payout > game.bet);
  checkForAchievements({
    actionType: isWin ? ACTION_TYPES.REDZONE_WIN : ACTION_TYPES.REDZONE_LOSE,
    userId,
    username: interaction.user.username,
    client: interaction.client,
    amount: isWin ? payout : game.bet,
  }).catch((err: unknown) => console.error('Failed to check achievements:', err));

  const embed: EmbedBuilder = new EmbedBuilder()
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
  let footerText: string = '';
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
  const canPlayAgain: boolean = updatedUser.wallet >= game.originalBet;
  const components: ActionRowBuilder<ButtonBuilder>[] = [createButtons(true)];
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
      filter: (i: ButtonInteraction) => i.user.id === userId && i.customId.startsWith('redzone_replay_'),
    });

    replayCollector.on('collect', async (buttonInteraction: ButtonInteraction) => {
      // Check cooldown
      const lastGame: number | undefined = redzoneCooldowns.get(userId);
      if (lastGame) {
        const elapsed: number = Date.now() - lastGame;
        const cooldownMs: number = CONFIG.REDZONE_COOLDOWN_SECONDS * 1000;
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
          content: 'You already have a Red Zone game in progress!',
          ephemeral: true,
        });
        return;
      }

      // Check wallet
      const currentUser: EconomyUser | null = await economyDb.getUser(userId);
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

    replayCollector.on('end', async (_collected: unknown, reason: string) => {
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
      if (casinoChannel && 'send' in casinoChannel) {
        const announcementEmbed: EmbedBuilder = new EmbedBuilder()
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
    } catch (error: unknown) {
      console.error('Failed to send casino announcement:', error);
    }
  }

  // Clean up game state
  activeGames.delete(userId);
}

/**
 * Start a new Red Zone game
 * @param interaction - The Discord command interaction
 * @param amount - Bet amount
 */
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
  redzoneCooldowns.set(userId, Date.now());

  // Initialize game state
  const game: RedzoneGameState = {
    bet: amount,
    originalBet: amount,
    yardLine: 20, // Start at own 20
    yardsGained: 0,
    phase: 'playing',
  };

  activeGames.set(userId, game);

  // Show initial game state
  const embed: EmbedBuilder = createGameEmbed(
    game,
    'Your ball at your own 20. Run a play or cash out!',
    0xf1c40f
  );
  const row: ActionRowBuilder<ButtonBuilder> = createButtons(false);

  const response = await interaction.editReply({
    embeds: [embed],
    components: [row],
  });

  // Create button collector
  const collector = response.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: CONFIG.REDZONE_TIMEOUT_SECONDS * 1000,
    filter: (i: ButtonInteraction) => i.user.id === userId && !i.customId.startsWith('redzone_replay_'),
  });

  collector.on('collect', async (buttonInteraction: ButtonInteraction) => {
    const currentGame: RedzoneGameState | undefined = activeGames.get(userId);
    if (!currentGame || currentGame.phase !== 'playing') {
      await buttonInteraction.reply({
        content: 'This game is no longer active.',
        ephemeral: true,
      });
      return;
    }

    const action: string = buttonInteraction.customId;

    if (action === 'redzone_run') {
      const result: PlayResult = runPlay(currentGame);

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
        const position: FieldPosition = getFieldPosition(currentGame.yardLine);
        const statusMsg: string = `📣 Great run! +${result.yardsGained} yards! Fumble risk: ${Math.round(position.fumbleChance * 100)}%`;
        const embedUpdate: EmbedBuilder = createGameEmbed(currentGame, statusMsg, 0xf1c40f);
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

  collector.on('end', async (_collected: unknown, reason: string) => {
    const currentGame: RedzoneGameState | undefined = activeGames.get(userId);
    if (reason === 'time' && currentGame && currentGame.phase === 'playing') {
      // Auto cash out on timeout
      currentGame.phase = 'finished';
      await resolveGame(interaction, currentGame, userId, 'cashout');
    }
  });
}

/**
 * Execute the redzone command
 * @param interaction - The Discord command interaction
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId: string = interaction.user.id;
    const username: string = interaction.user.username;
    const betStr: string = interaction.options.getString('bet')!.toLowerCase();

    // Check cooldown
    const lastGame: number | undefined = redzoneCooldowns.get(userId);
    if (lastGame) {
      const elapsed: number = Date.now() - lastGame;
      const cooldownMs: number = CONFIG.REDZONE_COOLDOWN_SECONDS * 1000;
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
        content: 'You already have a Red Zone game in progress! Finish it first.',
      });
      return;
    }

    // Get or create user
    const userData: EconomyUser = await economyDb.getOrCreateUser(userId, username);

    // Parse bet amount
    let amount: number;
    if (betStr === 'all' || betStr === 'max') {
      amount = userData.wallet;
    } else {
      amount = parseInt(betStr, 10);
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
      const embed: EmbedBuilder = new EmbedBuilder()
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
  } catch (error: unknown) {
    console.error('redzone command error:', error);
    activeGames.delete(interaction.user.id);
    const message: string = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `An error occurred: ${message}`,
    });
  }
}
