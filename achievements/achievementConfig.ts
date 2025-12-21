// Achievement System Configuration
// Maps achievement keys to their metadata

// ============ TYPE DEFINITIONS ============

export type AchievementKey =
  | 'THIEF'
  | 'WORDLE_FIRST_SOLVE'
  | 'WORDLE_5_SOLVES'
  | 'WORDLE_10_SOLVES'
  | 'VIDEO_POKER_ROYAL'
  | 'VIDEO_POKER_STREAK';

export type ActionType =
  | 'ROB_SUCCESS'
  | 'ROB_FAIL'
  | 'GAMBLE_WIN'
  | 'GAMBLE_LOSE'
  | 'BLACKJACK_WIN'
  | 'BLACKJACK_LOSE'
  | 'SLOTS_WIN'
  | 'SLOTS_LOSE'
  | 'STOCK_BUY'
  | 'STOCK_SELL'
  | 'REDZONE_WIN'
  | 'REDZONE_LOSE'
  | 'WORDLE_SOLVE'
  | 'WORDLE_FIRST_SOLVE'
  | 'VIDEO_POKER_WIN'
  | 'VIDEO_POKER_LOSE'
  | 'VIDEO_POKER_ROYAL_FLUSH';

export interface Achievement {
  readonly name: string;
  readonly description: string;
  readonly rewardValue: number;
}

// ============ CONFIGURATION ============

/**
 * Achievement definitions
 */
export const ACHIEVEMENTS: Record<AchievementKey, Achievement> = {
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
  VIDEO_POKER_ROYAL: {
    name: 'Royal Treatment',
    description: 'Hit a Royal Flush in Video Poker',
    rewardValue: 5000,
  },
  VIDEO_POKER_STREAK: {
    name: 'Hot Hand',
    description: 'Win 5 Video Poker hands in a row',
    rewardValue: 500,
  },
} as const;

/**
 * Action types that can trigger achievement checks
 */
export const ACTION_TYPES: Record<ActionType, ActionType> = {
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
  VIDEO_POKER_WIN: 'VIDEO_POKER_WIN',
  VIDEO_POKER_LOSE: 'VIDEO_POKER_LOSE',
  VIDEO_POKER_ROYAL_FLUSH: 'VIDEO_POKER_ROYAL_FLUSH',
} as const;

// ============ HELPER FUNCTIONS ============

/**
 * Get achievement by key
 */
export function getAchievement(key: string | null | undefined): Achievement | null {
  if (!key) return null;
  return ACHIEVEMENTS[key as AchievementKey] || null;
}

/**
 * Get all achievement keys
 */
export function getAllAchievementKeys(): AchievementKey[] {
  return Object.keys(ACHIEVEMENTS) as AchievementKey[];
}
