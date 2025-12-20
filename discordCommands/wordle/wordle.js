// Wordle Discord Command
// Play Wordle! Guess the 5-letter word.

import { SlashCommandBuilder, EmbedBuilder } from 'discord.js';
import * as wordleDb from '../../wordle/wordleDb.js';
import {
  renderBoard,
  checkGameState,
  formatGuessCount,
  generateShareText,
} from '../../wordle/wordleUtils.js';
import { CONFIG, COLORS, REWARDS, calculateReward } from '../../wordle/wordleConfig.js';
import { isValidWord } from '../../wordle/wordleWords.js';
import * as economyDb from '../../economy/economyDb.js';
import * as inventoryDb from '../../inventory/inventoryDb.js';
import { formatCurrency, CHANNELS } from '../../economy/economyConfig.js';
import { checkForAchievements } from '../../achievements/achievementService.js';
import { ACTION_TYPES } from '../../achievements/achievementConfig.js';
import * as nflmonService from '../../nflmon/nflmonService.js';
import { DROP_CONFIG } from '../../nflmon/nflmonConfig.js';

export const data = new SlashCommandBuilder()
  .setName('wordle')
  .setDescription('Play Wordle! Guess the 5-letter word.')
  .addStringOption((option) =>
    option.setName('guess').setDescription('Your 5-letter guess').setMinLength(5).setMaxLength(5)
  );

/**
 * Create the main game embed showing the board
 * @param {object} game - User game record
 * @param {object} currentWord - Current word record
 * @param {string} footer - Footer text
 * @param {number} color - Embed color
 * @param {boolean} showAnswer - Whether to reveal the answer
 * @returns {EmbedBuilder}
 */
function createGameEmbed(game, currentWord, footer, color, showAnswer = false) {
  const guesses = game?.guesses || [];
  const answer = currentWord.current_word;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`Wordle #${currentWord.word_number}`)
    .setDescription(renderBoard(guesses, answer))
    .addFields(
      {
        name: 'Guesses',
        value: formatGuessCount(guesses.length),
        inline: true,
      },
      {
        name: 'Status',
        value: currentWord.solved ? `Solved by ${currentWord.solve_count}` : 'Unsolved!',
        inline: true,
      }
    )
    .setFooter({ text: footer })
    .setTimestamp();

  if (currentWord.solved && currentWord.first_solver_username) {
    embed.addFields({
      name: 'First Solver',
      value: currentWord.first_solver_username,
      inline: true,
    });
  }

  if (showAnswer) {
    embed.addFields({
      name: 'Answer',
      value: answer.toUpperCase(),
      inline: false,
    });
  }

  return embed;
}

/**
 * Create win embed with rewards
 * @param {object} game - User game record
 * @param {object} currentWord - Current word record
 * @param {number} reward - Total reward amount
 * @param {boolean} isFirstSolver - Whether user is first solver
 * @returns {EmbedBuilder}
 */
function createWinEmbed(game, currentWord, reward, isFirstSolver) {
  const guesses = game.guesses;
  const answer = currentWord.current_word;
  const color = isFirstSolver ? COLORS.FIRST_SOLVE : COLORS.WON;

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`Wordle #${currentWord.word_number} - ${isFirstSolver ? 'First Solve!' : 'Victory!'}`)
    .setDescription(renderBoard(guesses, answer))
    .addFields(
      { name: 'Answer', value: answer.toUpperCase(), inline: true },
      { name: 'Guesses', value: formatGuessCount(guesses.length), inline: true },
      { name: 'Reward', value: formatCurrency(reward), inline: true }
    )
    .setTimestamp();

  if (isFirstSolver) {
    embed.addFields({
      name: 'Bonus Item',
      value: 'Lucky Letter',
      inline: true,
    });
  }

  // Add share text in footer
  const shareText = generateShareText(guesses, answer, currentWord.word_number, true);
  embed.setFooter({ text: shareText });

  return embed;
}

/**
 * Create loss embed showing the answer
 * @param {object} game - User game record
 * @param {object} currentWord - Current word record
 * @returns {EmbedBuilder}
 */
function createLossEmbed(game, currentWord) {
  const guesses = game.guesses;
  const answer = currentWord.current_word;

  return new EmbedBuilder()
    .setColor(COLORS.LOST)
    .setTitle(`Wordle #${currentWord.word_number} - Better luck next time`)
    .setDescription(renderBoard(guesses, answer))
    .addFields(
      { name: 'Answer', value: answer.toUpperCase(), inline: true },
      { name: 'Guesses', value: formatGuessCount(guesses.length), inline: true }
    )
    .setFooter({
      text: 'New word available in 1 hours',
    })
    .setTimestamp();
}

/**
 * Create embed for already completed games
 * @param {object} game - User game record
 * @param {object} currentWord - Current word record
 * @returns {EmbedBuilder}
 */
function createAlreadyPlayedEmbed(game, currentWord) {
  const answer = currentWord.current_word;
  const color = game.won ? COLORS.WON : COLORS.LOST;
  const rotationInfo = wordleDb.getRotationInfo(currentWord);

  let footerText = game.won ? 'You already solved this puzzle!' : 'You already played this puzzle.';

  if (rotationInfo.canRotate) {
    footerText += ' A new word is available!';
  } else if (rotationInfo.minutesRemaining > 0) {
    footerText += ` Next word in ${rotationInfo.minutesRemaining} minutes.`;
  }

  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(`Wordle #${currentWord.word_number} - ${game.won ? 'Solved!' : 'Complete'}`)
    .setDescription(renderBoard(game.guesses, answer))
    .addFields(
      { name: 'Answer', value: answer.toUpperCase(), inline: true },
      { name: 'Guesses', value: formatGuessCount(game.guesses.length), inline: true },
      { name: 'Result', value: game.won ? 'Won' : 'Lost', inline: true }
    )
    .setFooter({ text: footerText })
    .setTimestamp();

  return embed;
}

/**
 * Announce first solver to town square
 * @param {import('discord.js').Client} client - Discord client
 * @param {string} userId - Discord user ID
 * @param {object} currentWord - Current word record
 * @param {number} guessCount - Number of guesses used
 */
async function announceFirstSolver(client, userId, currentWord, guessCount) {
  if (!CHANNELS.TOWN_SQUARE) return;

  try {
    const channel = await client.channels.fetch(CHANNELS.TOWN_SQUARE);
    if (!channel) return;

    const embed = new EmbedBuilder()
      .setColor(COLORS.FIRST_SOLVE)
      .setTitle('First Solve!')
      .setDescription(`<@${userId}> was the first to solve **Wordle #${currentWord.word_number}**!`)
      .addFields(
        { name: 'Guesses', value: `${guessCount}/${CONFIG.MAX_GUESSES}`, inline: true },
        {
          name: 'Bonus',
          value: `${formatCurrency(REWARDS.FIRST_SOLVER_BONUS)} + Lucky Letter`,
          inline: true,
        }
      )
      .setTimestamp();

    await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error('Failed to announce first solver:', error);
  }
}

/**
 * Execute the wordle command
 * @param {import('discord.js').ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const guess = interaction.options.getString('guess')?.toLowerCase();

    // Ensure user exists in economy system
    await economyDb.getOrCreateUser(userId, username);

    // Get current word (rotates if needed)
    const currentWord = await wordleDb.rotateWordIfNeeded();
    const answer = currentWord.current_word;

    // Get or create user's game for this word
    let game = await wordleDb.getUserGame(userId, answer);
    if (!game) {
      game = await wordleDb.createUserGame(userId, username, answer, currentWord.word_number);
      // Handle race condition - if createUserGame returns null due to ON CONFLICT,
      // another request created it first, so fetch the existing game
      if (!game) {
        game = await wordleDb.getUserGame(userId, answer);
      }
    }

    // Handle already completed game
    if (game.completed) {
      const embed = createAlreadyPlayedEmbed(game, currentWord);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Handle no guess provided - show current state
    if (!guess) {
      const guesses = game.guesses || [];
      const footer =
        guesses.length === 0
          ? 'Use /wordle guess:<word> to make your first guess!'
          : `Use /wordle guess:<word> to continue. ${CONFIG.MAX_GUESSES - guesses.length} guesses remaining.`;

      const embed = createGameEmbed(game, currentWord, footer, COLORS.PLAYING);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Validate guess is a valid word
    if (!isValidWord(guess)) {
      await interaction.editReply({
        content: `"${guess.toUpperCase()}" is not in the word list. Try a different word!`,
      });
      return;
    }

    // Check for duplicate guess
    const existingGuesses = game.guesses || [];
    if (existingGuesses.includes(guess)) {
      await interaction.editReply({
        content: `You already guessed "${guess.toUpperCase()}". Try a different word!`,
      });
      return;
    }

    // Add the guess
    const updatedGame = await wordleDb.addGuess(game.id, guess, existingGuesses);
    const guesses = updatedGame.guesses;

    // Check game state
    const { isOver, won } = checkGameState(guesses, answer);

    if (won) {
      // Mark word as solved and check if first solver
      const wordResult = await wordleDb.markWordSolved(currentWord.id, userId, username);
      const isFirstSolver = wordResult.is_first_solver;

      // Calculate and award reward
      const reward = calculateReward(isFirstSolver);
      await economyDb.addToWallet(userId, reward);

      // Award item if first solver
      if (isFirstSolver) {
        await inventoryDb.addItem(userId, REWARDS.FIRST_SOLVER_ITEM, 1);
      }

      // === NFLmon Integration ===
      let nflmonDropped = null;
      let xpResult = null;

      // Determine drop chance (100% for first solver, 20% for regular wins)
      const dropChance = isFirstSolver
        ? DROP_CONFIG.WORDLE_FIRST_CHANCE
        : DROP_CONFIG.WORDLE_WIN_CHANCE;

      // Roll for NFLmon drop
      if (Math.random() < dropChance) {
        nflmonDropped = await nflmonService.rollForNflmon(userId, username, 'wordle');
      }

      // Award XP to training NFLmon
      const xpSource = isFirstSolver ? 'wordle_first' : 'wordle_win';
      xpResult = await nflmonService.addXpToTraining(userId, xpSource);

      // Record game result and complete game
      await wordleDb.recordGameResult({
        userId,
        username,
        won: true,
        guessCount: guesses.length,
        wasFirstSolver: isFirstSolver,
      });
      await wordleDb.completeGame(updatedGame.id, true);

      // Check for achievements (non-blocking)
      checkForAchievements({
        actionType: ACTION_TYPES.WORDLE_SOLVE,
        userId,
        username,
        client: interaction.client,
      }).catch((err) => console.error('Failed to check wordle achievements:', err));

      if (isFirstSolver) {
        checkForAchievements({
          actionType: ACTION_TYPES.WORDLE_FIRST_SOLVE,
          userId,
          username,
          client: interaction.client,
        }).catch((err) => console.error('Failed to check first solve achievement:', err));

        // Announce first solver
        announceFirstSolver(interaction.client, userId, currentWord, guesses.length).catch((err) =>
          console.error('Failed to announce first solver:', err)
        );
      }

      // Update game object with completed guesses for embed
      updatedGame.guesses = guesses;
      const embed = createWinEmbed(updatedGame, currentWord, reward, isFirstSolver);

      // Add NFLmon info to embed
      if (nflmonDropped) {
        embed.addFields({
          name: 'NFLmon Caught!',
          value: `You caught **${nflmonDropped.player.name}** (${nflmonDropped.rarity.name})!\nUse \`/nflmon view ${nflmonDropped.nflmon.id}\` to see stats.`,
        });
      }

      if (xpResult && xpResult.results.length > 0) {
        const xpLines = xpResult.results.map((r) => {
          let line = `${r.player?.name || 'Unknown'} +${xpResult.xpAmount} XP`;
          if (r.levelsGained > 0) line += ` (Lv.${r.nflmon.level}!)`;
          if (r.evolved) line += ` EVOLVED!`;
          return line;
        });
        embed.addFields({
          name: 'Training XP',
          value: xpLines.join('\n'),
        });
      }

      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (isOver) {
      // Loss - out of guesses
      await wordleDb.recordGameResult({
        userId,
        username,
        won: false,
        guessCount: guesses.length,
        wasFirstSolver: false,
      });
      await wordleDb.completeGame(updatedGame.id, false);

      updatedGame.guesses = guesses;
      const embed = createLossEmbed(updatedGame, currentWord);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Game continues
    const remaining = CONFIG.MAX_GUESSES - guesses.length;
    const footer = `${remaining} guess${remaining === 1 ? '' : 'es'} remaining. Use /wordle guess:<word>`;

    updatedGame.guesses = guesses;
    const embed = createGameEmbed(updatedGame, currentWord, footer, COLORS.PLAYING);
    await interaction.editReply({ embeds: [embed] });
  } catch (error) {
    console.error('Wordle command error:', error);
    await interaction.editReply({
      content: `An error occurred: ${error.message}`,
    });
  }
}
