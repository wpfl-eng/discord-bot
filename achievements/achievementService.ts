import { Client } from 'discord.js';
import * as achievementDb from './achievementDb.js';
import {
  ACTION_TYPES,
  getAchievement,
  type ActionType,
  type AchievementKey,
} from './achievementConfig.js';
import * as economyDb from '../economy/economyDb.js';
import * as wordleDb from '../wordle/wordleDb.js';
import * as polymarketDb from '../polymarket/polymarketDb.js';

// ============ Type Definitions ============

/**
 * Metadata about an action that may trigger achievements
 */
export interface ActionMetadata {
  readonly actionType: ActionType;
  readonly userId: string;
  readonly username: string;
  readonly client: Client;
  readonly amount?: number;
  readonly targetUserId?: string;
  readonly targetUsername?: string;
}

/**
 * Map of action types to the achievements they can unlock
 */
type ActionToAchievements = Record<string, AchievementKey[]>;

// ============ Configuration ============

const ACTION_TO_ACHIEVEMENTS: ActionToAchievements = {
  [ACTION_TYPES.ROB_SUCCESS]: ['THIEF'],
  [ACTION_TYPES.WORDLE_SOLVE]: ['WORDLE_5_SOLVES', 'WORDLE_10_SOLVES'],
  [ACTION_TYPES.WORDLE_FIRST_SOLVE]: ['WORDLE_FIRST_SOLVE'],
  [ACTION_TYPES.PREDICTION_WIN]: ['ORACLE', 'FORTUNE_TELLER', 'WHALE'],
};

// ============ Public Functions ============

/**
 * Check for and grant any applicable achievements based on an action
 * This is the main public function that should be called after money-related actions
 *
 * @param metadata - Metadata about the action that occurred
 * @returns Array of achievement keys that were newly granted
 */
export async function checkForAchievements(metadata: ActionMetadata): Promise<AchievementKey[]> {
  const { actionType, userId, username } = metadata;

  // Get the list of achievements that could be unlocked by this action
  const possibleAchievements = ACTION_TO_ACHIEVEMENTS[actionType] || [];

  if (possibleAchievements.length === 0) {
    return [];
  }

  const grantedAchievements: AchievementKey[] = [];

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
      }
    } catch (error) {
      console.error(`Error checking achievement ${achievementKey}:`, error);
    }
  }

  return grantedAchievements;
}

// ============ Private Functions ============

/**
 * Check if the criteria for a specific achievement are met
 * @param achievementKey - The achievement key to check
 * @param metadata - Action metadata
 * @returns True if criteria are met
 */
async function checkAchievementCriteria(
  achievementKey: AchievementKey,
  metadata: ActionMetadata
): Promise<boolean> {
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
      return stats5 !== null && stats5.games_won >= 5;
    }

    case 'WORDLE_10_SOLVES': {
      // Check if user has solved 10 or more Wordle puzzles
      const stats10 = await wordleDb.getUserStats(metadata.userId);
      return stats10 !== null && stats10.games_won >= 10;
    }

    case 'ORACLE': {
      // Granted on first prediction win
      const wonCount = await polymarketDb.countWonBets(metadata.userId);
      return wonCount === 1; // Just won their first
    }

    case 'FORTUNE_TELLER': {
      // Granted on 10th prediction win
      const wonCount10 = await polymarketDb.countWonBets(metadata.userId);
      return wonCount10 >= 10;
    }

    case 'WHALE': {
      // Granted when winning a payout of 5000+ coins
      return metadata.amount !== undefined && metadata.amount >= 5000;
    }

    default:
      return false;
  }
}
