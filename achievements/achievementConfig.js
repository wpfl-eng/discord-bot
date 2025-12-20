// Achievement System Configuration
// Maps achievement keys to their metadata

/**
 * Achievement definitions
 * @property {string} name - Display name for the achievement
 * @property {string} description - Description of how to earn the achievement
 * @property {number} rewardValue - Coin reward for earning the achievement
 */
export const ACHIEVEMENTS = {
  THIEF: {
    name: 'Thief',
    description: 'Successfully rob another player',
    rewardValue: 100,
  },
  WORDLE_FIRST_SOLVE: {
    name: 'Word Wizard',
    description: 'Be the first to solve a Wordle puzzle',
    rewardValue: 500,
  },
  WORDLE_5_SOLVES: {
    name: 'Vocabulary Builder',
    description: 'Successfully solve 5 Wordle puzzles',
    rewardValue: 750,
  },
  WORDLE_10_SOLVES: {
    name: 'Lexicon Master',
    description: 'Successfully solve 10 Wordle puzzles',
    rewardValue: 1000,
  },
};

/**
 * Action types that can trigger achievement checks
 */
export const ACTION_TYPES = {
  ROB_SUCCESS: 'ROB_SUCCESS',
  ROB_FAIL: 'ROB_FAIL',
  GAMBLE_WIN: 'GAMBLE_WIN',
  GAMBLE_LOSE: 'GAMBLE_LOSE',
  BLACKJACK_WIN: 'BLACKJACK_WIN',
  BLACKJACK_LOSE: 'BLACKJACK_LOSE',
  SLOTS_WIN: 'SLOTS_WIN',
  SLOTS_LOSE: 'SLOTS_LOSE',
  STOCK_BUY: 'STOCK_BUY',
  STOCK_SELL: 'STOCK_SELL',
  REDZONE_WIN: 'REDZONE_WIN',
  REDZONE_LOSE: 'REDZONE_LOSE',
  WORDLE_SOLVE: 'WORDLE_SOLVE',
  WORDLE_FIRST_SOLVE: 'WORDLE_FIRST_SOLVE',
};

/**
 * Get achievement by key
 * @param {string} key - Achievement key
 * @returns {object|null} - Achievement data or null if not found
 */
export function getAchievement(key) {
  return ACHIEVEMENTS[key] || null;
}

/**
 * Get all achievement keys
 * @returns {string[]} - Array of achievement keys
 */
export function getAllAchievementKeys() {
  return Object.keys(ACHIEVEMENTS);
}
