import cron from 'node-cron';
import crypto from 'crypto';
import { EmbedBuilder } from 'discord.js';
import * as triviaDb from './triviaDb.js';
import { checkAnswer } from './answerMatcher.js';
import * as economyDb from '../economy/economyDb.js';
import nflQuestions from './nflQuestions.json' with { type: 'json' };
import wpflQuestions from './wpflQuestions.json' with { type: 'json' };
import * as nflmonService from '../nflmon/nflmonService.js';
import { DROP_CONFIG } from '../nflmon/nflmonConfig.js';

export class TriviaService {
  constructor(client) {
    this.client = client;
  }

  /**
   * Initialize the trivia scheduler
   */
  init() {
    const hours = [9, 11, 13, 15, 17, 19, 21];

    hours.forEach((hour) => {
      // Post questions at each slot
      cron.schedule(
        `0 ${hour} * * *`,
        async () => {
          await this.sendQuestion('nfl');
          // await this.sendQuestion("wpfl");
        },
        { timezone: 'America/New_York' }
      );

      // Close windows 2 hours later (handle 23:00 edge case)
      const closeHour = hour + 2;
      if (closeHour <= 23) {
        cron.schedule(
          `0 ${closeHour} * * *`,
          async () => {
            await this.closeWindow('nfl');
            // await this.closeWindow("wpfl");
          },
          { timezone: 'America/New_York' }
        );
      }
    });

    console.log('[TRIVIA] Scheduler initialized (9am-9pm EST, every 2 hours)');
  }

  /**
   * Send a trivia question to the channel
   * @param {string} category - 'nfl' or 'wpfl'
   */
  async sendQuestion(category) {
    try {
      const channelId = process.env.TRIVIA_CHANNEL_ID;
      if (!channelId) {
        console.error('[TRIVIA] TRIVIA_CHANNEL_ID not set');
        return;
      }

      const channel = await this.client.channels.fetch(channelId);
      if (!channel) {
        console.error('[TRIVIA] Could not find trivia channel');
        return;
      }

      // Get questions for category
      const questions = category === 'nfl' ? nflQuestions : wpflQuestions;

      // Build list of unasked questions with their hashes
      const unaskedQuestions = [];

      for (const q of questions) {
        // Calculate hash based on category
        // NFL: use question.id
        // WPFL: hash source_data if exists, otherwise fall back to question.id
        let hash;
        if (category === 'nfl') {
          hash = q.id;
        } else {
          hash = q.source_data
            ? crypto.createHash('md5').update(JSON.stringify(q.source_data)).digest('hex')
            : q.id; // Fallback to id if no source_data
        }

        const asked = await triviaDb.isQuestionAsked(hash);
        if (!asked) {
          unaskedQuestions.push({ question: q, hash });
        }
      }

      // Pick a random unasked question
      let unaskedQuestion = null;
      let questionHash = null;

      if (unaskedQuestions.length > 0) {
        const randomIndex = Math.floor(Math.random() * unaskedQuestions.length);
        const selected = unaskedQuestions[randomIndex];
        unaskedQuestion = selected.question;
        questionHash = selected.hash;
      }

      if (!unaskedQuestion) {
        console.warn(`[TRIVIA] No unasked ${category.toUpperCase()} questions remaining!`);
        await channel.send({
          content: `No more ${category.toUpperCase()} trivia questions available!`,
        });
        return;
      }

      // Record that we're asking this question
      await triviaDb.recordQuestionHash(questionHash, category);

      // Calculate window close time (2 hours from now)
      const windowClosesAt = new Date(Date.now() + 2 * 60 * 60 * 1000);

      // Save to active questions
      const activeQuestion = await triviaDb.saveActiveQuestion({
        category,
        questionId: unaskedQuestion.id,
        question: unaskedQuestion.question,
        answer: unaskedQuestion.answer,
        acceptableAnswers: unaskedQuestion.acceptable_answers || [],
        pointValue: unaskedQuestion.point_value || 1,
        sourceData: unaskedQuestion.source_data
          ? JSON.stringify(unaskedQuestion.source_data)
          : null,
        channelId,
        windowClosesAt,
      });

      // Build and send embed
      const embed = this.buildQuestionEmbed(unaskedQuestion, category, windowClosesAt);
      await channel.send({ embeds: [embed] });

      console.log(`[TRIVIA] Posted ${category.toUpperCase()} question #${activeQuestion.id}`);
    } catch (error) {
      console.error(`[TRIVIA] Error sending ${category} question:`, error);
    }
  }

  /**
   * Handle a DM message (trivia answer attempt)
   * @param {Message} message - Discord message
   */
  async handleDM(message) {
    const content = message.content.trim();

    // Parse for category prefix
    const nflMatch = content.match(/^nfl:\s*(.+)$/i);
    const wpflMatch = content.match(/^wpfl:\s*(.+)$/i);

    if (!nflMatch && !wpflMatch) {
      await message.reply('Please use the format: `nfl: your answer` or `wpfl: your answer`');
      return;
    }

    const category = nflMatch ? 'nfl' : 'wpfl';
    const userAnswer = (nflMatch || wpflMatch)[1].trim();

    // Get active question
    const activeQuestion = await triviaDb.getActiveQuestion(category);

    if (!activeQuestion) {
      await message.reply(`No active ${category.toUpperCase()} trivia right now!`);
      return;
    }

    // Check if window is still open
    if (activeQuestion.is_closed || new Date() > new Date(activeQuestion.window_closes_at)) {
      await message.reply('The answer window has closed for this question!');
      return;
    }

    // Check if user already answered
    const existingAnswer = await triviaDb.getUserAnswer(activeQuestion.id, message.author.id);

    // If already correct, don't allow more attempts
    if (existingAnswer && existingAnswer.is_correct) {
      await message.reply('You already got this one! Wait for the next question.');
      return;
    }

    // Check if user has used all their guesses (2 max)
    const MAX_GUESSES = 2;
    if (existingAnswer && existingAnswer.attempt_count >= MAX_GUESSES) {
      await message.reply(
        `You've used your ${MAX_GUESSES} guesses for this question. Wait for the next one!`
      );
      return;
    }

    // Check the answer
    const questionData = {
      answer: activeQuestion.answer,
      acceptable_answers: activeQuestion.acceptable_answers || [],
    };

    const isCorrect = checkAnswer(userAnswer, questionData);

    // Record the answer (this increments attempt_count)
    const recorded = await triviaDb.recordAnswer({
      questionId: activeQuestion.id,
      userId: message.author.id,
      username: message.author.username,
      isCorrect,
    });

    if (isCorrect) {
      // Award points immediately
      let pointsAwarded = true;
      try {
        await triviaDb.addPoints(
          message.author.id,
          message.author.username,
          activeQuestion.point_value,
          category
        );
      } catch (error) {
        console.error('[TRIVIA] Error awarding points:', error);
        pointsAwarded = false;
      }

      // Award economy coins (25x point value)
      let coinsAwarded = 0;
      if (pointsAwarded) {
        try {
          const coinReward = activeQuestion.point_value * 25;
          await economyDb.getOrCreateUser(message.author.id, message.author.username);
          await economyDb.addToWallet(message.author.id, coinReward);
          coinsAwarded = coinReward;
        } catch (error) {
          console.error('[TRIVIA] Error awarding coins:', error);
        }
      }

      // === NFLmon Integration ===
      let nflmonDropped = null;
      let xpResult = null;

      // Roll for NFLmon drop (15% chance)
      if (Math.random() < DROP_CONFIG.TRIVIA_CORRECT_CHANCE) {
        nflmonDropped = await nflmonService.rollForNflmon(
          message.author.id,
          message.author.username,
          'trivia'
        );
      }

      // Award XP to training NFLmon
      xpResult = await nflmonService.addXpToTraining(message.author.id, 'trivia_correct');

      // Build combined reply message
      let replyParts = [];

      if (pointsAwarded) {
        const coinText = coinsAwarded > 0 ? ` and 🪙 ${coinsAwarded} coins` : '';
        replyParts.push(`Correct! +${activeQuestion.point_value} point(s)${coinText} added!`);
      } else {
        replyParts.push(`Correct! There was an issue adding points - please contact an admin.`);
      }

      // Add NFLmon drop info to same message
      if (nflmonDropped) {
        replyParts.push(
          `🎮 You caught **${nflmonDropped.player.name}** (${nflmonDropped.rarity.name})! Use \`/nflmon view ${nflmonDropped.nflmon.id}\` to see stats.`
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

      await message.reply(replyParts.join('\n'));

      // Announce in channel (no answer reveal)
      await this.announceCorrectAnswer(activeQuestion, message.author.username);
    } else {
      const attemptsLeft = MAX_GUESSES - recorded.attempt_count;
      if (attemptsLeft > 0) {
        await message.reply(
          `Incorrect. You have ${attemptsLeft} guess${attemptsLeft === 1 ? '' : 'es'} left.`
        );
      } else {
        await message.reply(
          `Incorrect. No guesses remaining for this question.\n\nThe answer was: **${activeQuestion.answer}**`
        );
        // Announce failure with roast
        await this.announceExhaustedGuesses(activeQuestion, message.author.username);
      }
    }
  }

  /**
   * Close the answer window and reveal the answer
   * @param {string} category - 'nfl' or 'wpfl'
   */
  async closeWindow(category) {
    try {
      const activeQuestion = await triviaDb.getActiveQuestion(category);

      if (!activeQuestion || activeQuestion.is_closed) {
        return;
      }

      // Get all correct answers (points already awarded in handleDM)
      const winners = await triviaDb.getCorrectAnswers(activeQuestion.id);

      // Close the question
      await triviaDb.closeQuestion(activeQuestion.id);

      // Post results to channel
      const channelId = activeQuestion.channel_id || process.env.TRIVIA_CHANNEL_ID;
      const channel = await this.client.channels.fetch(channelId);

      if (channel) {
        const embed = this.buildResultsEmbed(activeQuestion, winners, category);
        await channel.send({ embeds: [embed] });
      }

      console.log(
        `[TRIVIA] Closed ${category.toUpperCase()} question #${activeQuestion.id}, ${winners.length} winner(s)`
      );
    } catch (error) {
      console.error(`[TRIVIA] Error closing ${category} window:`, error);
    }
  }

  /**
   * Announce in channel when a user gets the correct answer
   * @param {object} activeQuestion - The active question
   * @param {string} username - The user who got it correct
   */
  async announceCorrectAnswer(activeQuestion, username) {
    try {
      const channelId = activeQuestion.channel_id || process.env.TRIVIA_CHANNEL_ID;
      const channel = await this.client.channels.fetch(channelId);
      if (channel) {
        await channel.send(`**${username}** got the answer correct!`);
      }
    } catch (error) {
      console.error('[TRIVIA] Error announcing correct answer:', error);
    }
  }

  /**
   * Announce in channel when a user exhausts their guesses
   * @param {object} activeQuestion - The active question
   * @param {string} username - The user who struck out
   */
  async announceExhaustedGuesses(activeQuestion, username) {
    try {
      const channelId = activeQuestion.channel_id || process.env.TRIVIA_CHANNEL_ID;
      const channel = await this.client.channels.fetch(channelId);
      if (channel) {
        const roasts = [
          `**${username}** used all their guesses and still couldn't get it!`,
          `**${username}** has exhausted their guesses. Better luck next time!`,
          `**${username}** struck out. Two swings, two misses.`,
          `**${username}** is officially 0 for 2 on this one.`,
          `**${username}** couldn't crack it. Maybe stick to multiple choice?`,
        ];
        const roast = roasts[Math.floor(Math.random() * roasts.length)];
        await channel.send(roast);
      }
    } catch (error) {
      console.error('[TRIVIA] Error announcing exhausted guesses:', error);
    }
  }

  /**
   * Build question embed
   * @param {object} question - Question data
   * @param {string} category - 'nfl' or 'wpfl'
   * @param {Date} windowClosesAt - When the window closes
   * @returns {EmbedBuilder}
   */
  buildQuestionEmbed(question, category, windowClosesAt) {
    const color = category === 'nfl' ? 0x013369 : 0x00ff88;
    const title = category === 'nfl' ? 'NFL Trivia' : 'WPFL Trivia';

    return new EmbedBuilder()
      .setColor(color)
      .setTitle(title)
      .setDescription(question.question)
      .addFields({
        name: 'How to Answer',
        value: `DM me with \`${category}: your answer\``,
        inline: false,
      })
      .addFields({
        name: 'Points',
        value: `${question.point_value || 1}`,
        inline: true,
      })
      .addFields({
        name: 'Window Closes',
        value: `<t:${Math.floor(windowClosesAt.getTime() / 1000)}:R>`,
        inline: true,
      })
      .setTimestamp();
  }

  /**
   * Build results embed
   * @param {object} question - Question data
   * @param {array} winners - Array of winners
   * @param {string} category - 'nfl' or 'wpfl'
   * @returns {EmbedBuilder}
   */
  buildResultsEmbed(question, winners, category) {
    const color = category === 'nfl' ? 0x013369 : 0x00ff88;
    const title = category === 'nfl' ? 'NFL Trivia Results' : 'WPFL Trivia Results';

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
}
