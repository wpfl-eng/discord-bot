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
    name: "Thief",
    description: "Successfully rob another player",
    rewardValue: 100,
  },
};

/**
 * Action types that can trigger achievement checks
 */
export const ACTION_TYPES = {
  ROB_SUCCESS: "ROB_SUCCESS",
  ROB_FAIL: "ROB_FAIL",
  GAMBLE_WIN: "GAMBLE_WIN",
  GAMBLE_LOSE: "GAMBLE_LOSE",
  BLACKJACK_WIN: "BLACKJACK_WIN",
  BLACKJACK_LOSE: "BLACKJACK_LOSE",
  SLOTS_WIN: "SLOTS_WIN",
  SLOTS_LOSE: "SLOTS_LOSE",
  STOCK_BUY: "STOCK_BUY",
  STOCK_SELL: "STOCK_SELL",
  REDZONE_WIN: "REDZONE_WIN",
  REDZONE_LOSE: "REDZONE_LOSE",
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
