// Wordle Discord Command
// Play Wordle! Guess the 5-letter word.

import {
  SlashCommandBuilder,
  EmbedBuilder,
  ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ComponentType,
  ButtonInteraction,
  ModalSubmitInteraction,
} from 'discord.js';
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
import { formatCurrency } from '../../economy/economyConfig.js';
import { checkForAchievements } from '../../achievements/achievementService.js';
import { ACTION_TYPES } from '../../achievements/achievementConfig.js';
import type { WordleWord, WordleUserGame } from '../../wordle/wordleDb.js';

export const data = new SlashCommandBuilder()
  .setName('wordle')
  .setDescription('Play Wordle! Guess the 5-letter word.');

/**
 * Create the main game embed showing the board
 */
function createGameEmbed(
  game: WordleUserGame | null,
  currentWord: WordleWord,
  footer: string,
  color: number,
  showAnswer: boolean = false
): EmbedBuilder {
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
 */
function createWinEmbed(
  game: WordleUserGame,
  currentWord: WordleWord,
  reward: number,
  isFirstSolver: boolean
): EmbedBuilder {
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
 */
function createLossEmbed(game: WordleUserGame, currentWord: WordleWord): EmbedBuilder {
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
      text: 'New word available in 1 hour',
    })
    .setTimestamp();
}

/**
 * Create embed for already completed games
 */
function createAlreadyPlayedEmbed(game: WordleUserGame, currentWord: WordleWord): EmbedBuilder {
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
 * Create the "Make Guess" button component
 */
function createGuessButton(disabled: boolean = false): ActionRowBuilder<ButtonBuilder> {
  const button = new ButtonBuilder()
    .setCustomId('wordle_guess')
    .setLabel('Make Guess')
    .setEmoji('📝')
    .setStyle(ButtonStyle.Primary)
    .setDisabled(disabled);

  return new ActionRowBuilder<ButtonBuilder>().addComponents(button);
}

/**
 * Create the modal for guess input
 */
function createGuessModal(wordNumber: number): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId('wordle_guess_modal')
    .setTitle(`Wordle #${wordNumber} - Enter Guess`);

  const guessInput = new TextInputBuilder()
    .setCustomId('wordle_guess_input')
    .setLabel('Your 5-letter guess')
    .setStyle(TextInputStyle.Short)
    .setMinLength(5)
    .setMaxLength(5)
    .setPlaceholder('Enter a 5-letter word')
    .setRequired(true);

  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(guessInput);
  modal.addComponents(row);

  return modal;
}

/**
 * Process a guess and handle win/loss/continue states
 */
async function processGuess(
  interaction: ChatInputCommandInteraction,
  game: WordleUserGame,
  currentWord: WordleWord,
  guess: string,
  userId: string,
  username: string
): Promise<{ updatedGame: WordleUserGame; isOver: boolean; won: boolean; embed: EmbedBuilder }> {
  const answer = currentWord.current_word;

  // Add the guess
  const updatedGame = await wordleDb.addGuess(game.id, guess, game.guesses || []);
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
    }

    const embed = createWinEmbed(updatedGame, currentWord, reward, isFirstSolver);

    return { updatedGame, isOver: true, won: true, embed };
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

    const embed = createLossEmbed(updatedGame, currentWord);
    return { updatedGame, isOver: true, won: false, embed };
  }

  // Game continues
  const remaining = CONFIG.MAX_GUESSES - guesses.length;
  const footer = `${remaining} guess${remaining === 1 ? '' : 'es'} remaining. Click the button to guess!`;

  const embed = createGameEmbed(updatedGame, currentWord, footer, COLORS.PLAYING);
  return { updatedGame, isOver: false, won: false, embed };
}

/**
 * Execute the wordle command
 */
export async function execute(interaction: ChatInputCommandInteraction): Promise<void> {
  await interaction.deferReply({ ephemeral: true });

  try {
    const userId = interaction.user.id;
    const username = interaction.user.username;

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

    // This should never happen after the above checks, but satisfy TypeScript
    if (!game) {
      await interaction.editReply({
        content: 'Failed to create or retrieve game. Please try again.',
      });
      return;
    }

    // Handle already completed game - no button needed
    if (game.completed) {
      const embed = createAlreadyPlayedEmbed(game, currentWord);
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    // Show current state with "Make Guess" button
    const guesses = game.guesses || [];
    const remaining = CONFIG.MAX_GUESSES - guesses.length;
    const footer =
      guesses.length === 0
        ? 'Click the button below to make your first guess!'
        : `${remaining} guess${remaining === 1 ? '' : 'es'} remaining. Click the button to guess!`;

    const embed = createGameEmbed(game, currentWord, footer, COLORS.PLAYING);
    const response = await interaction.editReply({
      embeds: [embed],
      components: [createGuessButton(false)],
    });

    // Create collector for button clicks (5 minute timeout)
    const collector = response.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 300000, // 5 minutes
      filter: (i: ButtonInteraction) => i.user.id === userId && i.customId === 'wordle_guess',
    });

    collector.on('collect', async (buttonInteraction: ButtonInteraction) => {
      try {
        // Re-fetch game state in case it was modified elsewhere
        const freshGame = await wordleDb.getUserGame(userId, answer);
        if (!freshGame || freshGame.completed) {
          await buttonInteraction.reply({
            content:
              'This game has already ended. Use `/wordle` to see your results or start a new game.',
            ephemeral: true,
          });
          collector.stop('completed');
          return;
        }

        // Show modal for guess input
        const modal = createGuessModal(currentWord.word_number);
        await buttonInteraction.showModal(modal);

        // Wait for modal submission (60 second timeout)
        let modalInteraction: ModalSubmitInteraction;
        try {
          modalInteraction = await buttonInteraction.awaitModalSubmit({
            time: 60000,
            filter: (mi: ModalSubmitInteraction) =>
              mi.customId === 'wordle_guess_modal' && mi.user.id === userId,
          });
        } catch {
          // Modal was dismissed or timed out - silently continue
          // User can click the button again
          return;
        }

        // Process the modal submission
        try {
          await modalInteraction.deferUpdate();

          const guess = modalInteraction.fields
            .getTextInputValue('wordle_guess_input')
            .toLowerCase();

          // Validate guess is a valid word
          if (!isValidWord(guess)) {
            await modalInteraction.followUp({
              content: `"${guess.toUpperCase()}" is not in the word list. Try a different word!`,
              ephemeral: true,
            });
            return;
          }

          // Re-fetch game state again before adding guess (most up-to-date state)
          const gameBeforeGuess = await wordleDb.getUserGame(userId, answer);
          if (!gameBeforeGuess || gameBeforeGuess.completed) {
            await modalInteraction.followUp({
              content: 'This game has already ended.',
              ephemeral: true,
            });
            collector.stop('completed');
            return;
          }

          // Check for duplicate guess
          const existingGuesses = gameBeforeGuess.guesses || [];
          if (existingGuesses.includes(guess)) {
            await modalInteraction.followUp({
              content: `You already guessed "${guess.toUpperCase()}". Try a different word!`,
              ephemeral: true,
            });
            return;
          }

          // Process the guess
          const result = await processGuess(
            interaction,
            gameBeforeGuess,
            currentWord,
            guess,
            userId,
            username
          );

          // Update the original message using modalInteraction
          if (result.isOver) {
            // Game over - remove button
            await modalInteraction.editReply({
              embeds: [result.embed],
              components: [],
            });
            collector.stop(result.won ? 'won' : 'lost');
          } else {
            // Game continues - keep button
            await modalInteraction.editReply({
              embeds: [result.embed],
              components: [createGuessButton(false)],
            });
          }
        } catch (processingError) {
          console.error('Error processing wordle guess:', processingError);
          try {
            await modalInteraction.followUp({
              content: 'An error occurred processing your guess. Please try again.',
              ephemeral: true,
            });
          } catch {
            // followUp may fail if interaction expired
          }
        }
      } catch (error) {
        console.error('Error handling wordle button interaction:', error);
        try {
          await buttonInteraction.reply({
            content: 'An error occurred. Please try again.',
            ephemeral: true,
          });
        } catch {
          // Interaction may have already been acknowledged
        }
      }
    });

    collector.on('end', async (_collected, reason) => {
      if (reason === 'time') {
        // Session timed out - show message and disable button
        try {
          const expiredEmbed = createGameEmbed(
            game,
            currentWord,
            'Session expired - use /wordle to continue your game.',
            COLORS.PLAYING
          );
          await interaction.editReply({
            embeds: [expiredEmbed],
            components: [createGuessButton(true)],
          });
        } catch {
          // Message may have been deleted
        }
      }
      // 'won', 'lost', and 'completed' reasons already handled
    });
  } catch (error: unknown) {
    console.error('Wordle command error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    await interaction.editReply({
      content: `An error occurred: ${message}`,
    });
  }
}
