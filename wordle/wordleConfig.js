// Wordle Game Configuration
// All constants and settings for the Wordle command

/**
 * Core game settings
 */
export const CONFIG = {
  // Game rules
  MAX_GUESSES: 6,
  WORD_LENGTH: 5,

  // Word rotation - word changes every N hours, but only if someone solved it
  ROTATION_HOURS: 1,
};

/**
 * Reward configuration
 */
export const REWARDS = {
  // Base reward for solving the wordle
  BASE_WIN: 300,

  // Additional bonus for being the first to solve
  FIRST_SOLVER_BONUS: 200,

  // Item awarded to first solver
  FIRST_SOLVER_ITEM: "wordle_lucky_letter",
};

/**
 * Discord embed colors (hex values)
 */
export const COLORS = {
  PLAYING: 0xf1c40f, // Yellow - game in progress
  WON: 0x2ecc71, // Green - victory
  LOST: 0xe74c3c, // Red - defeat
  INFO: 0x3498db, // Blue - informational
  FIRST_SOLVE: 0xffd700, // Gold - first solver announcement
};

/**
 * Wordle grid emojis
 */
export const EMOJIS = {
  CORRECT: "🟩", // Letter in correct position (green)
  PRESENT: "🟨", // Letter in word but wrong position (yellow)
  ABSENT: "⬛", // Letter not in word (black/gray)
  EMPTY: "⬜", // Unused guess slot (white)
};

/**
 * Feedback types for letter evaluation
 */
export const FEEDBACK_TYPES = {
  CORRECT: "correct",
  PRESENT: "present",
  ABSENT: "absent",
};

/**
 * Get emoji for a feedback type
 * @param {string} feedbackType - 'correct', 'present', or 'absent'
 * @returns {string} The corresponding emoji
 */
export function getFeedbackEmoji(feedbackType) {
  switch (feedbackType) {
    case FEEDBACK_TYPES.CORRECT:
      return EMOJIS.CORRECT;
    case FEEDBACK_TYPES.PRESENT:
      return EMOJIS.PRESENT;
    case FEEDBACK_TYPES.ABSENT:
      return EMOJIS.ABSENT;
    default:
      return EMOJIS.EMPTY;
  }
}

/**
 * Calculate total reward for a win
 * @param {boolean} isFirstSolver - Whether this user is the first to solve
 * @returns {number} Total coin reward
 */
export function calculateReward(isFirstSolver) {
  let reward = REWARDS.BASE_WIN;
  if (isFirstSolver) {
    reward += REWARDS.FIRST_SOLVER_BONUS;
  }
  return reward;
}
