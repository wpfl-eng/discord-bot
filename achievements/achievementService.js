import { EmbedBuilder } from 'discord.js';
import * as achievementDb from './achievementDb.js';
import { ACTION_TYPES, getAchievement } from './achievementConfig.js';
import { CHANNELS, formatCurrency } from '../economy/economyConfig.js';
import * as economyDb from '../economy/economyDb.js';
import * as wordleDb from '../wordle/wordleDb.js';

/**
 * @typedef {Object} ActionMetadata
 * @property {string} actionType - The type of action (from ACTION_TYPES)
 * @property {string} userId - Discord user ID who performed the action
 * @property {string} username - Discord username
 * @property {import('discord.js').Client} client - Discord client for channel access
 * @property {number} [amount] - Amount involved in the action (optional)
 * @property {string} [targetUserId] - Target user ID if applicable (optional)
 * @property {string} [targetUsername] - Target username if applicable (optional)
 */

/**
 * Map of action types to the achievements they can unlock
 * @type {Object.<string, string[]>}
 */
const ACTION_TO_ACHIEVEMENTS = {
  [ACTION_TYPES.ROB_SUCCESS]: ['THIEF'],
  [ACTION_TYPES.WORDLE_SOLVE]: ['WORDLE_5_SOLVES', 'WORDLE_10_SOLVES'],
  [ACTION_TYPES.WORDLE_FIRST_SOLVE]: ['WORDLE_FIRST_SOLVE'],
};

/**
 * Check for and grant any applicable achievements based on an action
 * This is the main public function that should be called after money-related actions
 *
 * @param {ActionMetadata} metadata - Metadata about the action that occurred
 * @returns {Promise<string[]>} - Array of achievement keys that were newly granted
 */
export async function checkForAchievements(metadata) {
  const { actionType, userId, username, client } = metadata;

  // Get the list of achievements that could be unlocked by this action
  const possibleAchievements = ACTION_TO_ACHIEVEMENTS[actionType] || [];

  if (possibleAchievements.length === 0) {
    return [];
  }

  const grantedAchievements = [];

  for (const achievementKey of possibleAchievements) {
    try {
      // Check if the achievement criteria are met
      const isMet = await checkAchievementCriteria(achievementKey, metadata);
      if (!isMet) {
        continue;
      }

      // Attempt to grant the achievement (will return null if already exists)
      const granted = await achievementDb.grantAchievement(userId, username, achievementKey);

      if (granted) {
        grantedAchievements.push(achievementKey);

        // Give the reward
        const achievement = getAchievement(achievementKey);
        if (achievement && achievement.rewardValue > 0) {
          await economyDb.addToWallet(userId, achievement.rewardValue);
        }

        // Announce to town-square
        await announceAchievement(client, userId, achievementKey);
      }
    } catch (error) {
      console.error(`Error checking achievement ${achievementKey}:`, error);
    }
  }

  return grantedAchievements;
}

/**
 * Check if the criteria for a specific achievement are met
 * @param {string} achievementKey - The achievement key to check
 * @param {ActionMetadata} metadata - Action metadata
 * @returns {Promise<boolean>} - True if criteria are met
 */
async function checkAchievementCriteria(achievementKey, metadata) {
  switch (achievementKey) {
    case 'THIEF':
      // THIEF is granted on any successful rob
      return metadata.actionType === ACTION_TYPES.ROB_SUCCESS;

    case 'WORDLE_FIRST_SOLVE':
      // Granted on first solve of any Wordle puzzle
      return metadata.actionType === ACTION_TYPES.WORDLE_FIRST_SOLVE;

    case 'WORDLE_5_SOLVES': {
      // Check if user has solved 5 or more Wordle puzzles
      const stats5 = await wordleDb.getUserStats(metadata.userId);
      return stats5 && stats5.games_won >= 5;
    }

    case 'WORDLE_10_SOLVES': {
      // Check if user has solved 10 or more Wordle puzzles
      const stats10 = await wordleDb.getUserStats(metadata.userId);
      return stats10 && stats10.games_won >= 10;
    }

    default:
      return false;
  }
}

/**
 * Announce an achievement to the town-square channel
 * @param {import('discord.js').Client} client - Discord client
 * @param {string} userId - Discord user ID
 * @param {string} achievementKey - Achievement key
 * @returns {Promise<void>}
 */
async function announceAchievement(client, userId, achievementKey) {
  if (!CHANNELS.TOWN_SQUARE) {
    return;
  }

  const achievement = getAchievement(achievementKey);
  if (!achievement) {
    return;
  }

  try {
    const townSquare = await client.channels.fetch(CHANNELS.TOWN_SQUARE);
    if (!townSquare) {
      return;
    }

    const embed = new EmbedBuilder()
      .setColor(0xffd700) // Gold color for achievements
      .setTitle('Achievement Unlocked!')
      .setDescription(`<@${userId}> has earned **${achievement.name}**!`)
      .addFields(
        {
          name: 'Description',
          value: achievement.description,
          inline: false,
        },
        {
          name: 'Reward',
          value: formatCurrency(achievement.rewardValue),
          inline: true,
        }
      )
      .setTimestamp();

    await townSquare.send({ embeds: [embed] });
  } catch (error) {
    console.error('Failed to announce achievement:', error);
  }
}
