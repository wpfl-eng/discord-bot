import cron from 'node-cron';
import {
  Client,
  EmbedBuilder,
  Message,
  TextChannel,
  ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ButtonInteraction
} from 'discord.js';
import * as triviaDb from './triviaDb.js';
import { checkAnswer } from './answerMatcher.js';
import * as economyDb from '../economy/economyDb.js';
import * as categoryLoader from './categoryLoader.js';
import * as nflmonService from '../nflmon/nflmonService.js';
import { DROP_CONFIG } from '../nflmon/nflmonConfig.js';

// ============ Category Weighting ============

/**
 * Weight distribution for category selection
 * NFL stays dominant (70%) since this is a fantasy football bot
 * Video games provides variety (30%)
 */
const CATEGORY_WEIGHTS: Record<string, number> = {
  nfl: 0.7,
  videogames: 0.3,
};

/**
 * Select a category using weighted random selection
 * @param availableCategories - Categories with unasked questions
 * @returns Selected category name
 */
/**
 * Fisher-Yates shuffle algorithm
 * Returns a new shuffled array (does not mutate original)
 */
function shuffleArray<T>(array: readonly T[]): T[] {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

function selectWeightedCategory(availableCategories: string[]): string {
  // Filter to categories with defined weights
  const weighted = availableCategories.filter((c) => c in CATEGORY_WEIGHTS);

  // If no weighted categories available, fall back to random
  if (weighted.length === 0) {
    return availableCategories[Math.floor(Math.random() * availableCategories.length)];
  }

  // If only one weighted category available, use it
  if (weighted.length === 1) return weighted[0];

  // Calculate total weight for available categories
  const totalWeight = weighted.reduce((sum, c) => sum + CATEGORY_WEIGHTS[c], 0);

  // Weighted random selection
  let random = Math.random() * totalWeight;
  for (const category of weighted) {
    random -= CATEGORY_WEIGHTS[category];
    if (random <= 0) return category;
  }

  return weighted[0]; // Fallback
}

// ============ Type Definitions ============

/**
 * Trivia category type - now dynamic (any string)
 */
export type TriviaCategory = string;

/**
 * Re-export TriviaQuestion from categoryLoader
 */
export type { TriviaQuestion } from './categoryLoader.js';

/**
 * Trivia winner record
 */
export interface TriviaWinner {
  readonly username: string;
}

/**
 * Active question record from database
 */
export interface ActiveQuestion {
  readonly id: number;
  readonly category: TriviaCategory;
  readonly question: string;
  readonly answer: string;
  readonly acceptable_answers: readonly string[] | null;
  readonly choices: readonly string[] | null;
  readonly point_value: number;
  readonly channel_id: string | null;
  readonly window_closes_at: string | Date;
  readonly is_closed: boolean;
}

/**
 * User answer record from database
 */
interface UserAnswerRecord {
  readonly is_correct: boolean;
  readonly attempt_count: number;
}

/**
 * Recorded answer result
 */
interface RecordedAnswer {
  readonly attempt_count: number;
}

/**
 * Result from processing an answer submission
 */
interface AnswerResult {
  message: string;      // Response text for user
  isCorrect: boolean;   // Did they get it right?
  isExhausted: boolean; // Out of guesses (for roast announcement)?
}

// ============ Service Class ============

/**
 * Background service for trivia question scheduling and handling
 * Follows the same pattern as TrainingNotificationService
 */
export class TriviaService {
  private readonly client: Client;

  constructor(client: Client) {
    this.client = client;
  }

  /**
   * Initialize the trivia scheduler
   */
  init(): void {
    const hours = [9, 11, 13, 15, 17, 19, 21];

    hours.forEach((hour) => {
      // Post random category question at each slot
      cron.schedule(
        `0 ${hour} * * *`,
        async () => {
          await this.sendRandomQuestion();
        },
        { timezone: 'America/New_York' }
      );

      // Timeout close (in case no new question replaces it)
      const closeHour = hour + 2;
      if (closeHour <= 23) {
        cron.schedule(
          `0 ${closeHour} * * *`,
          async () => {
            await this.closeCurrentQuestion();
          },
          { timezone: 'America/New_York' }
        );
      }
    });

    // End-of-month season processing - runs at midnight on the 1st
    cron.schedule(
      '0 0 1 * *',
      async () => {
        await this.handleSeasonEnd();
      },
      { timezone: 'America/New_York' }
    );

    console.log('[TRIVIA] Scheduler initialized (9am-9pm EST, every 2 hours)');
    console.log('[TRIVIA] Season end scheduler initialized (midnight on 1st of month)');
  }

  /**
   * Close the currently active question (if any) and post results
   * Idempotent - safe to call even if no active question
   */
  async closeCurrentQuestion(): Promise<void> {
    const activeQuestion = await triviaDb.getAnyActiveQuestion();

    if (!activeQuestion || activeQuestion.is_closed) {
      return; // Nothing to close
    }

    // Get winners for results embed
    const winners = await triviaDb.getCorrectAnswers(activeQuestion.id);

    // Close in database
    await triviaDb.closeQuestion(activeQuestion.id);

    // Post results to channel
    const channelId = activeQuestion.channel_id || process.env.TRIVIA_CHANNEL_ID;
    if (channelId) {
      try {
        const channel = await this.client.channels.fetch(channelId);
        if (channel?.isTextBased()) {
          const embed = this.buildResultsEmbed(activeQuestion, winners, activeQuestion.category);
          await (channel as TextChannel).send({ embeds: [embed] });
        }
      } catch (error) {
        console.error('[TRIVIA] Error posting results:', error);
      }
    }

    console.log(`[TRIVIA] Closed question #${activeQuestion.id} (${activeQuestion.category})`);
  }

  /**
   * Handle end of month - snapshot winners, pay rewards, announce
   * Should be called at midnight on the 1st of each month
   */
  async handleSeasonEnd(): Promise<void> {
    // Get last month's year-month string (e.g., "2025-01")
    const now = new Date();
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const yearMonth = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;

    console.log(`[TRIVIA] Processing season end for ${yearMonth}`);

    // Check if already processed
    const existing = await triviaDb.getSeasonResults(yearMonth);
    if (existing?.rewards_paid) {
      console.log(`[TRIVIA] Season ${yearMonth} already processed`);
      return;
    }

    // Get the leaderboard for last month
    const startOfMonth = new Date(lastMonth.getFullYear(), lastMonth.getMonth(), 1);
    const endOfMonth = new Date(lastMonth.getFullYear(), lastMonth.getMonth() + 1, 0, 23, 59, 59);
    const leaderboard = await triviaDb.getLeaderboardForDateRange(startOfMonth, endOfMonth, 10);

    if (leaderboard.length === 0) {
      console.log(`[TRIVIA] No participants in ${yearMonth}`);
      return;
    }

    // Save season results
    const winners = leaderboard.slice(0, 3).map(entry => ({
      userId: entry.user_id,
      username: entry.username,
      points: entry.points,
    }));

    await triviaDb.saveSeasonResults(yearMonth, winners);

    // Pay rewards
    const rewards = [250000, 100000, 50000];
    for (let i = 0; i < Math.min(winners.length, 3); i++) {
      if (winners[i].userId) {
        try {
          await economyDb.getOrCreateUser(winners[i].userId, winners[i].username);
          await economyDb.addToWallet(winners[i].userId, rewards[i]);
          console.log(`[TRIVIA] Paid ${rewards[i]} to ${winners[i].username} (${['1st', '2nd', '3rd'][i]} place)`);
        } catch (error) {
          console.error(`[TRIVIA] Failed to pay ${winners[i].username}:`, error);
        }
      }
    }

    // Mark as paid
    await triviaDb.markSeasonRewardsPaid(yearMonth);

    // Announce in channel
    await this.announceSeasonResults(yearMonth, winners, rewards);

    console.log(`[TRIVIA] Season ${yearMonth} completed`);
  }

  /**
   * Announce season results in trivia channel
   */
  private async announceSeasonResults(
    yearMonth: string,
    winners: { userId: string; username: string; points: number }[],
    rewards: number[]
  ): Promise<void> {
    const channelId = process.env.TRIVIA_CHANNEL_ID;
    if (!channelId) return;

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel?.isTextBased()) return;

      const medals = ['🥇', '🥈', '🥉'];
      const [year, monthNum] = yearMonth.split('-');
      const monthName = new Date(parseInt(year), parseInt(monthNum) - 1).toLocaleString('en-US', { month: 'long' });

      let description = `**${monthName} ${year} Trivia Season has ended!**\n\n`;

      winners.forEach((winner, i) => {
        description += `${medals[i]} **${winner.username}** - ${winner.points} pts → 🪙 ${rewards[i].toLocaleString()}\n`;
      });

      description += '\nA new season has begun! Good luck!';

      const embed = new EmbedBuilder()
        .setColor(0xffd700)
        .setTitle('🏆 Trivia Season Results')
        .setDescription(description)
        .setTimestamp();

      await (channel as TextChannel).send({ embeds: [embed] });
    } catch (error) {
      console.error('[TRIVIA] Error announcing season results:', error);
    }
  }

  /**
   * Send a question from a randomly selected category
   * Picks only from categories that have unasked questions
   */
  async sendRandomQuestion(): Promise<void> {
    const categories = await categoryLoader.getAllCategoryNames();

    if (categories.length === 0) {
      console.warn('[TRIVIA] No categories available');
      return;
    }

    // Filter to categories with available questions
    const availableCategories: string[] = [];

    for (const category of categories) {
      const questions = await categoryLoader.getQuestionsForCategory(category);
      const askedHashes = await triviaDb.getAskedHashes(category);
      const unaskedCount = questions.filter(q => !askedHashes.has(String(q.id))).length;

      if (unaskedCount > 0) {
        availableCategories.push(category);
      }
    }

    if (availableCategories.length === 0) {
      // All categories exhausted - reset all and retry
      console.log('[TRIVIA] All categories exhausted, resetting pools...');
      for (const category of categories) {
        await triviaDb.clearCategoryHistory(category);
      }
      // Pick random from all categories after reset
      const randomCategory = categories[Math.floor(Math.random() * categories.length)];
      await this.sendQuestion(randomCategory);
      return;
    }

    // Pick category using weighted selection (70% NFL, 30% video games)
    const randomCategory = selectWeightedCategory(availableCategories);
    await this.sendQuestion(randomCategory);
  }

  /**
   * Send a trivia question to the channel
   * Uses advisory lock to prevent race conditions with concurrent requests
   * @param category - Category name (e.g., 'nfl', 'wpfl')
   */
  async sendQuestion(category: TriviaCategory): Promise<void> {
    // Try to acquire lock - if another request is in progress, skip
    const lockAcquired = await triviaDb.tryAcquireQuestionLock();
    if (!lockAcquired) {
      console.log('[TRIVIA] Another question post in progress, skipping');
      return;
    }

    try {
      // CLOSE-AND-REPLACE: Always close current question first
      await this.closeCurrentQuestion();

      const channelId = process.env.TRIVIA_CHANNEL_ID;
      if (!channelId) {
        console.error('[TRIVIA] TRIVIA_CHANNEL_ID not set');
        return;
      }

      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        console.error('[TRIVIA] Could not find trivia channel or not text-based');
        return;
      }

      // Get questions from category loader (dynamic)
      const questions = await categoryLoader.getQuestionsForCategory(category);

      if (questions.length === 0) {
        console.warn(`[TRIVIA] No questions available for category: ${category}`);
        return;
      }

      // Fetch all asked hashes for this category
      const askedHashes = await triviaDb.getAskedHashes(category);

      // Filter to unasked questions (simplified: always use String(q.id) as hash)
      let unaskedQuestions = questions.filter(q => !askedHashes.has(String(q.id)));

      // Auto-reset if pool exhausted
      if (unaskedQuestions.length === 0) {
        console.log(`[TRIVIA] Pool exhausted for ${category}, resetting...`);
        await triviaDb.clearCategoryHistory(category);
        unaskedQuestions = questions; // All questions now available
      }

      // Pick random question
      const randomIndex = Math.floor(Math.random() * unaskedQuestions.length);
      const selectedQuestion = unaskedQuestions[randomIndex];
      const questionHash = String(selectedQuestion.id);

      // Record that we're asking this question
      await triviaDb.recordQuestionHash(questionHash, category);

      // Calculate window close time (2 hours from now)
      const windowClosesAt = new Date(Date.now() + 2 * 60 * 60 * 1000);

      // Save to active questions
      // Format array as PostgreSQL array literal: {"value1","value2"}
      // Escape backslashes first, then quotes (order matters for PostgreSQL)
      const escapeForPgArray = (s: string): string =>
        s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      const acceptableAnswers = selectedQuestion.acceptable_answers?.length
        ? `{${selectedQuestion.acceptable_answers.map(a => `"${escapeForPgArray(a)}"`).join(',')}}`
        : null;

      // Shuffle choices for multiple choice questions to randomize answer position
      const shuffledChoices = selectedQuestion.choices
        ? shuffleArray(selectedQuestion.choices)
        : null;

      const activeQuestion = await triviaDb.saveActiveQuestion({
        category,
        questionId: selectedQuestion.id != null ? String(selectedQuestion.id) : null,
        question: selectedQuestion.question,
        answer: selectedQuestion.answer,
        acceptableAnswers,
        choices: shuffledChoices,
        type: selectedQuestion.type,
        pointValue: selectedQuestion.point_value || 1,
        sourceData: selectedQuestion.metadata
          ? JSON.stringify(selectedQuestion.metadata)
          : null,
        channelId,
        windowClosesAt,
      });

      // Build and send embed - use shuffled choices for display
      const questionForEmbed = shuffledChoices
        ? { ...selectedQuestion, choices: shuffledChoices }
        : selectedQuestion;
      const embed = this.buildQuestionEmbed(questionForEmbed, category, windowClosesAt);

      // Add buttons for multiple choice questions - use shuffled choices
      if (selectedQuestion.type === 'multiple_choice' && shuffledChoices) {
        const row = this.buildChoiceButtons(activeQuestion.id, shuffledChoices);
        await (channel as TextChannel).send({ embeds: [embed], components: [row] });
      } else {
        await (channel as TextChannel).send({ embeds: [embed] });
      }

      console.log(`[TRIVIA] Posted ${category.toUpperCase()} question #${activeQuestion.id}`);
    } catch (error) {
      console.error(`[TRIVIA] Error sending ${category} question:`, error);
    } finally {
      // Always release the lock
      await triviaDb.releaseQuestionLock();
    }
  }

  /**
   * Process an answer submission (shared logic for DM and slash command)
   * @param userId - Discord user ID
   * @param username - Discord username
   * @param userAnswer - The user's answer
   * @param activeQuestion - The active trivia question
   * @returns Result with message text and status flags
   */
  private async processAnswerSubmission(
    userId: string,
    username: string,
    userAnswer: string,
    activeQuestion: ActiveQuestion
  ): Promise<AnswerResult> {
    const MAX_GUESSES = 2;

    // Check if user already answered
    const existingAnswer = (await triviaDb.getUserAnswer(
      activeQuestion.id,
      userId
    )) as UserAnswerRecord | null;

    // If already correct, don't allow more attempts
    if (existingAnswer && existingAnswer.is_correct) {
      return {
        message: 'You already got this one! Wait for the next question.',
        isCorrect: false,
        isExhausted: false,
      };
    }

    // Check if user has used all their guesses (2 max)
    if (existingAnswer && existingAnswer.attempt_count >= MAX_GUESSES) {
      return {
        message: `You've used your ${MAX_GUESSES} guesses for this question. Wait for the next one!`,
        isCorrect: false,
        isExhausted: false,
      };
    }

    // For multiple choice questions, convert A/B/C/D to actual choice text
    let normalizedAnswer = userAnswer;
    if (activeQuestion.choices && activeQuestion.choices.length > 0) {
      const letterMap: Record<string, number> = { a: 0, b: 1, c: 2, d: 3 };
      const letterIndex = letterMap[userAnswer.toLowerCase().trim()];
      if (letterIndex !== undefined && letterIndex < activeQuestion.choices.length) {
        normalizedAnswer = activeQuestion.choices[letterIndex];
      }
    }

    // Check the answer - spread to convert readonly to mutable for checkAnswer
    const questionData = {
      answer: activeQuestion.answer,
      acceptable_answers: activeQuestion.acceptable_answers ? [...activeQuestion.acceptable_answers] : [],
    };

    const isCorrect = checkAnswer(normalizedAnswer, questionData);

    // Record the answer (this increments attempt_count)
    const recorded = (await triviaDb.recordAnswer({
      questionId: activeQuestion.id,
      userId,
      username,
      isCorrect,
    })) as RecordedAnswer;

    if (isCorrect) {
      // Award points immediately
      let pointsAwarded = true;
      try {
        await triviaDb.addPoints(
          userId,
          username,
          activeQuestion.point_value,
          activeQuestion.category
        );
      } catch (error) {
        console.error('[TRIVIA] Error awarding points:', error);
        pointsAwarded = false;
      }

      // Award economy coins (2500 per correct answer)
      let coinsAwarded = 0;
      if (pointsAwarded) {
        try {
          const coinReward = 2500;
          await economyDb.getOrCreateUser(userId, username);
          await economyDb.addToWallet(userId, coinReward);
          coinsAwarded = coinReward;
        } catch (error) {
          console.error('[TRIVIA] Error awarding coins:', error);
        }
      }

      // === NFLmon Integration ===
      let nflmonDropped: nflmonService.RollResult | null = null;
      let xpResult: nflmonService.XpResult | null = null;

      // Roll for NFLmon drop (15% chance)
      if (Math.random() < DROP_CONFIG.TRIVIA_CORRECT_CHANCE) {
        nflmonDropped = await nflmonService.rollForNflmon(
          userId,
          username,
          'trivia'
        );
      }

      // Award XP to training NFLmon
      xpResult = await nflmonService.addXpToTraining(userId, 'trivia_correct');

      // Build combined reply message
      const replyParts: string[] = [];

      if (pointsAwarded) {
        const coinText = coinsAwarded > 0 ? ` and 🪙 ${coinsAwarded} coins` : '';
        replyParts.push(`Correct! +${activeQuestion.point_value} point(s)${coinText} added!`);
      } else {
        replyParts.push(`Correct! There was an issue adding points - please contact an admin.`);
      }

      // Add NFLmon drop info to same message
      if (nflmonDropped) {
        replyParts.push(
          `🎮 You caught **${nflmonDropped.player.name}** (${nflmonDropped.rarity?.name ?? 'Unknown'})! Use \`/nflmon view ${nflmonDropped.nflmon.id}\` to see stats.`
        );
      }

      // Add training XP info to same message
      if (xpResult && xpResult.results.length > 0) {
        const xpLines = xpResult.results.map((r) => {
          let line = `${r.player?.name || 'Unknown'} +${xpResult.xpAmount} XP`;
          if (r.levelsGained > 0) line += ` (Lv.${r.nflmon.level}!)`;
          if (r.evolved) line += ` EVOLVED!`;
          return line;
        });
        replyParts.push(`**Training XP:** ${xpLines.join(', ')}`);
      }

      return {
        message: replyParts.join('\n'),
        isCorrect: true,
        isExhausted: false,
      };
    } else {
      const attemptsLeft = MAX_GUESSES - recorded.attempt_count;
      if (attemptsLeft > 0) {
        return {
          message: `Incorrect. You have ${attemptsLeft} guess${attemptsLeft === 1 ? '' : 'es'} left.`,
          isCorrect: false,
          isExhausted: false,
        };
      } else {
        return {
          message: `Incorrect. No guesses remaining for this question.\n\nThe answer was: **${activeQuestion.answer}**`,
          isCorrect: false,
          isExhausted: true,
        };
      }
    }
  }

  /**
   * Handle a DM message (trivia answer attempt)
   * Now accepts answers directly - category prefix optional for backward compat
   * @param message - Discord message
   */
  async handleDM(message: Message): Promise<void> {
    let userAnswer = message.content.trim();

    // Strip category prefix if present (backward compatibility)
    // Matches: "nfl: answer", "wpfl: answer", or any "category: answer" format
    const prefixMatch = userAnswer.match(/^(\w+):\s*(.+)$/i);
    if (prefixMatch) {
      userAnswer = prefixMatch[2].trim();
    }

    // Get the ONE active question (any category)
    const activeQuestion = await triviaDb.getAnyActiveQuestion() as ActiveQuestion | null;

    if (!activeQuestion) {
      await message.reply('No active trivia question right now! Check back later.');
      return;
    }

    // Check if window is still open
    if (activeQuestion.is_closed || new Date() > new Date(activeQuestion.window_closes_at)) {
      await message.reply('The answer window has closed for this question!');
      return;
    }

    // Process the answer using shared logic
    const result = await this.processAnswerSubmission(
      message.author.id,
      message.author.username,
      userAnswer,
      activeQuestion
    );

    // Send the reply
    await message.reply(result.message);

    // Handle announcements
    if (result.isCorrect) {
      await this.announceCorrectAnswer(activeQuestion, message.author.username);
    } else if (result.isExhausted) {
      await this.announceExhaustedGuesses(activeQuestion, message.author.username);
    }
  }

  /**
   * Handle a slash command trivia answer
   * @param interaction - Discord slash command interaction (already deferred as ephemeral)
   * @param answer - The user's answer
   */
  async handleSlashAnswer(
    interaction: ChatInputCommandInteraction,
    answer: string
  ): Promise<void> {
    // Get any active question (auto-detect category)
    const activeQuestion = (await triviaDb.getAnyActiveQuestion()) as ActiveQuestion | null;

    if (!activeQuestion) {
      await interaction.editReply('No active trivia question right now!');
      return;
    }

    // Check if window is still open
    if (activeQuestion.is_closed || new Date() > new Date(activeQuestion.window_closes_at)) {
      await interaction.editReply('The answer window has closed for this question!');
      return;
    }

    // Process the answer using shared logic
    const result = await this.processAnswerSubmission(
      interaction.user.id,
      interaction.user.username,
      answer,
      activeQuestion
    );

    // Send the ephemeral reply
    await interaction.editReply(result.message);

    // Handle announcements
    if (result.isCorrect) {
      await this.announceCorrectAnswer(activeQuestion, interaction.user.username);
    } else if (result.isExhausted) {
      await this.announceExhaustedGuesses(activeQuestion, interaction.user.username);
    }
  }

  /**
   * Handle a button click for multiple choice answer
   * @param interaction - Discord button interaction
   */
  async handleButtonAnswer(interaction: ButtonInteraction): Promise<void> {
    // Parse custom_id: trivia_{questionId}_{choiceIndex}
    const parts = interaction.customId.split('_');
    if (parts.length !== 3 || parts[0] !== 'trivia') {
      return;
    }

    const questionId = parseInt(parts[1], 10);
    const choiceIndex = parseInt(parts[2], 10);

    if (isNaN(questionId) || isNaN(choiceIndex)) {
      await interaction.reply({ content: 'Invalid button data.', ephemeral: true });
      return;
    }

    // Get the active question
    const activeQuestion = await triviaDb.getAnyActiveQuestion() as ActiveQuestion | null;

    if (!activeQuestion || activeQuestion.id !== questionId) {
      await interaction.reply({ content: 'This question is no longer active!', ephemeral: true });
      return;
    }

    // Check if window is still open
    if (activeQuestion.is_closed || new Date() > new Date(activeQuestion.window_closes_at)) {
      await interaction.reply({ content: 'The answer window has closed for this question!', ephemeral: true });
      return;
    }

    // Get the selected answer from choices
    const choices = activeQuestion.choices;
    if (!choices || choiceIndex >= choices.length) {
      await interaction.reply({ content: 'Invalid choice.', ephemeral: true });
      return;
    }

    const selectedAnswer = choices[choiceIndex];

    // Process using shared logic
    const result = await this.processAnswerSubmission(
      interaction.user.id,
      interaction.user.username,
      selectedAnswer,
      activeQuestion
    );

    // Send ephemeral reply
    await interaction.reply({ content: result.message, ephemeral: true });

    // Handle announcements
    if (result.isCorrect) {
      await this.announceCorrectAnswer(activeQuestion, interaction.user.username);
    } else if (result.isExhausted) {
      await this.announceExhaustedGuesses(activeQuestion, interaction.user.username);
    }
  }

  /**
   * Announce in channel when a user gets the correct answer
   * @param activeQuestion - The active question
   * @param username - The user who got it correct
   */
  async announceCorrectAnswer(activeQuestion: ActiveQuestion, username: string): Promise<void> {
    try {
      const channelId = activeQuestion.channel_id || process.env.TRIVIA_CHANNEL_ID;
      if (!channelId) {
        return;
      }

      const channel = await this.client.channels.fetch(channelId);
      if (channel && channel.isTextBased()) {
        await (channel as TextChannel).send(`**${username}** got the answer correct!`);
      }
    } catch (error) {
      console.error('[TRIVIA] Error announcing correct answer:', error);
    }
  }

  /**
   * Announce in channel when a user exhausts their guesses
   * @param activeQuestion - The active question
   * @param username - The user who struck out
   */
  async announceExhaustedGuesses(activeQuestion: ActiveQuestion, username: string): Promise<void> {
    try {
      const channelId = activeQuestion.channel_id || process.env.TRIVIA_CHANNEL_ID;
      if (!channelId) {
        return;
      }

      const channel = await this.client.channels.fetch(channelId);
      if (channel && channel.isTextBased()) {
        const roasts = [
          `**${username}** used all their guesses and still couldn't get it!`,
          `**${username}** has exhausted their guesses. Better luck next time!`,
          `**${username}** struck out. Two swings, two misses.`,
          `**${username}** is officially 0 for 2 on this one.`,
          `**${username}** couldn't crack it. Maybe stick to multiple choice?`,
        ];
        const roast = roasts[Math.floor(Math.random() * roasts.length)];
        await (channel as TextChannel).send(roast);
      }
    } catch (error) {
      console.error('[TRIVIA] Error announcing exhausted guesses:', error);
    }
  }

  /**
   * Build question embed
   * @param question - Question data
   * @param category - Category name
   * @param windowClosesAt - When the window closes
   * @returns Notification embed
   */
  buildQuestionEmbed(question: categoryLoader.TriviaQuestion, category: TriviaCategory, windowClosesAt: Date): EmbedBuilder {
    const color = categoryLoader.getCategoryColor(category);
    const title = `${category.toUpperCase()} Trivia`;

    const embed = new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setTimestamp();

    // Build description based on question type
    if (question.type === 'multiple_choice' && question.choices) {
      const choiceLabels = ['A', 'B', 'C', 'D'];
      const choicesText = question.choices
        .slice(0, 4)
        .map((choice, i) => `**${choiceLabels[i]})** ${choice}`)
        .join('\n');

      embed.setDescription(`${question.question}\n\n${choicesText}`);
      embed.addFields({
        name: 'How to Answer',
        value: 'Click a button below or use `/trivia answer:A`',
        inline: false,
      });
    } else {
      embed.setDescription(question.question);
      embed.addFields({
        name: 'How to Answer',
        value: 'Use `/trivia answer:your answer` or DM me directly',
        inline: false,
      });
    }

    embed.addFields({
      name: 'Points',
      value: `${question.point_value || 1}`,
      inline: true,
    });
    embed.addFields({
      name: 'Window Closes',
      value: `<t:${Math.floor(windowClosesAt.getTime() / 1000)}:R>`,
      inline: true,
    });

    return embed;
  }

  /**
   * Build results embed
   * @param question - Question data
   * @param winners - Array of winners
   * @param category - Category name
   * @returns Results embed
   */
  buildResultsEmbed(question: ActiveQuestion, winners: TriviaWinner[], category: TriviaCategory): EmbedBuilder {
    const color = categoryLoader.getCategoryColor(category);
    const title = `${category.toUpperCase()} Trivia Results`;

    const winnerList =
      winners.length > 0 ? winners.map((w) => w.username).join(', ') : 'No one got it!';

    return new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .addFields({
        name: 'Question',
        value: question.question,
        inline: false,
      })
      .addFields({
        name: 'Answer',
        value: question.answer,
        inline: false,
      })
      .addFields({
        name: `Winners (+${question.point_value} pts each)`,
        value: winnerList,
        inline: false,
      })
      .setTimestamp();
  }

  /**
   * Build button row for multiple choice questions
   * @param questionId - Active question ID (for button custom_id)
   * @param choices - Array of choice strings [A, B, C, D]
   * @returns ActionRow with buttons
   */
  buildChoiceButtons(questionId: number, choices: readonly string[]): ActionRowBuilder<ButtonBuilder> {
    const labels = ['A', 'B', 'C', 'D'];

    const buttons = choices.slice(0, 4).map((_, index) =>
      new ButtonBuilder()
        .setCustomId(`trivia_${questionId}_${index}`)
        .setLabel(labels[index])
        .setStyle(ButtonStyle.Primary)
    );

    return new ActionRowBuilder<ButtonBuilder>().addComponents(buttons);
  }
}
