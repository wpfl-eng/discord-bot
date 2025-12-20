// Wordle Game Configuration
// All constants and settings for the Wordle command

// ============ TYPE DEFINITIONS ============

export type FeedbackType = 'correct' | 'present' | 'absent';

export interface GameConfig {
  readonly MAX_GUESSES: number;
  readonly WORD_LENGTH: number;
  readonly ROTATION_HOURS: number;
}

export interface RewardsConfig {
  readonly BASE_WIN: number;
  readonly FIRST_SOLVER_BONUS: number;
  readonly FIRST_SOLVER_ITEM: string;
}

export interface ColorsConfig {
  readonly PLAYING: number;
  readonly WON: number;
  readonly LOST: number;
  readonly INFO: number;
  readonly FIRST_SOLVE: number;
}

export interface EmojisConfig {
  readonly CORRECT: string;
  readonly PRESENT: string;
  readonly ABSENT: string;
  readonly EMPTY: string;
}

export interface FeedbackTypesConfig {
  readonly CORRECT: FeedbackType;
  readonly PRESENT: FeedbackType;
  readonly ABSENT: FeedbackType;
}

// ============ CONFIGURATION ============

/**
 * Core game settings
 */
export const CONFIG: GameConfig = {
  // Game rules
  MAX_GUESSES: 6,
  WORD_LENGTH: 5,

  // Word rotation - word changes every N hours, but only if someone solved it
  ROTATION_HOURS: 1,
} as const;

/**
 * Reward configuration
 */
export const REWARDS: RewardsConfig = {
  // Base reward for solving the wordle
  BASE_WIN: 300,

  // Additional bonus for being the first to solve
  FIRST_SOLVER_BONUS: 200,

  // Item awarded to first solver
  FIRST_SOLVER_ITEM: 'wordle_lucky_letter',
} as const;

/**
 * Discord embed colors (hex values)
 */
export const COLORS: ColorsConfig = {
  PLAYING: 0xf1c40f, // Yellow - game in progress
  WON: 0x2ecc71, // Green - victory
  LOST: 0xe74c3c, // Red - defeat
  INFO: 0x3498db, // Blue - informational
  FIRST_SOLVE: 0xffd700, // Gold - first solver announcement
} as const;

/**
 * Wordle grid emojis
 */
export const EMOJIS: EmojisConfig = {
  CORRECT: '🟩', // Letter in correct position (green)
  PRESENT: '🟨', // Letter in word but wrong position (yellow)
  ABSENT: '⬛', // Letter not in word (black/gray)
  EMPTY: '⬜', // Unused guess slot (white)
} as const;

/**
 * Feedback types for letter evaluation
 */
export const FEEDBACK_TYPES: FeedbackTypesConfig = {
  CORRECT: 'correct',
  PRESENT: 'present',
  ABSENT: 'absent',
} as const;

// ============ HELPER FUNCTIONS ============

/**
 * Get emoji for a feedback type
 */
export function getFeedbackEmoji(feedbackType: string | null | undefined): string {
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
 */
export function calculateReward(isFirstSolver: boolean): number {
  let reward = REWARDS.BASE_WIN;
  if (isFirstSolver) {
    reward += REWARDS.FIRST_SOLVER_BONUS;
  }
  return reward;
}
