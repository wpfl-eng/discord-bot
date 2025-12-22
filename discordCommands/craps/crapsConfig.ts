// Craps Configuration
// Bet types, payouts, timing, and helpers for the craps game

import { CONFIG } from '../../economy/economyConfig.js';

// ============ TYPE DEFINITIONS ============

/**
 * Phases when bets can be placed
 */
export type BetPhase = 'comeout' | 'point' | 'any';

/**
 * Bet resolution behavior
 */
export type BetBehavior = 'one-roll' | 'multi-roll';

/**
 * Possible outcomes when resolving a bet
 */
export type BetOutcome = 'win' | 'lose' | 'push' | 'win_and_stay' | 'pending';

/**
 * Available bet types
 */
export type BetType = 'pass_line' | 'dont_pass' | 'field' | 'place_6' | 'place_8';

/**
 * Table status states
 */
export type TableStatus = 'idle' | 'betting' | 'rolling' | 'resolved';

/**
 * Session outcome types
 */
export type SessionOutcome = 'natural' | 'craps' | 'point_hit' | 'seven_out';

/**
 * Dice roll result
 */
export interface Roll {
  readonly die1: number;
  readonly die2: number;
  readonly total: number;
  readonly timestamp: Date;
}

/**
 * Bet type configuration
 */
export interface BetTypeConfig {
  readonly id: BetType;
  readonly name: string;
  readonly description: string;
  readonly payout: readonly [number, number]; // [win, wager] e.g., [7, 6] for 7:6
  readonly houseEdge: number;
  readonly phase: BetPhase;
  readonly behavior: BetBehavior;
}

/**
 * Payout result from bet resolution
 */
export interface PayoutResult {
  readonly outcome: BetOutcome;
  readonly payout: number;
  readonly description?: string;
}

// ============ BET TYPE DEFINITIONS ============

export const BET_TYPES: Record<BetType, BetTypeConfig> = {
  pass_line: {
    id: 'pass_line',
    name: 'Pass Line',
    description: 'Win on 7/11 come-out, or point before 7',
    payout: [1, 1], // 1:1
    houseEdge: 1.41,
    phase: 'comeout',
    behavior: 'multi-roll',
  },
  dont_pass: {
    id: 'dont_pass',
    name: "Don't Pass",
    description: 'Win on 2/3 come-out (12 push), or 7 before point',
    payout: [1, 1], // 1:1
    houseEdge: 1.36,
    phase: 'comeout',
    behavior: 'multi-roll',
  },
  field: {
    id: 'field',
    name: 'Field',
    description: 'Win on 2,3,4,9,10,11,12 (2x on 2, 3x on 12)',
    payout: [1, 1], // Base 1:1, special payouts handled in resolution
    houseEdge: 5.56,
    phase: 'any',
    behavior: 'one-roll',
  },
  place_6: {
    id: 'place_6',
    name: 'Place 6',
    description: 'Win when 6 is rolled, lose on 7',
    payout: [7, 6], // 7:6
    houseEdge: 1.52,
    phase: 'point',
    behavior: 'multi-roll',
  },
  place_8: {
    id: 'place_8',
    name: 'Place 8',
    description: 'Win when 8 is rolled, lose on 7',
    payout: [7, 6], // 7:6
    houseEdge: 1.52,
    phase: 'point',
    behavior: 'multi-roll',
  },
} as const;

/**
 * All bet type IDs for iteration
 */
export const ALL_BET_TYPES: readonly BetType[] = Object.keys(BET_TYPES) as BetType[];

/**
 * Bet types available during come-out phase
 */
export const COMEOUT_BET_TYPES: readonly BetType[] = ['pass_line', 'dont_pass', 'field'];

/**
 * Bet types available during point phase
 */
export const POINT_BET_TYPES: readonly BetType[] = ['field', 'place_6', 'place_8'];

// ============ TIMING CONFIGURATION ============

export const TIMING = {
  /** Initial come-out betting window in seconds */
  COMEOUT_BETTING_SECONDS: 45,

  /** Betting window between point phase rolls in seconds */
  POINT_BETTING_SECONDS: 15,

  /** Time added when a new bet is placed in seconds */
  BET_EXTENDS_TIMER_BY: 5,

  /** Maximum betting window in seconds */
  MAX_BETTING_SECONDS: 60,

  /** Dice rolling animation duration in ms */
  ROLL_ANIMATION_MS: 2500,

  /** Result display duration before next phase in ms */
  RESULT_DISPLAY_MS: 3000,

  /** Grace period before table goes cold in seconds */
  GRACE_PERIOD_SECONDS: 15,
} as const;

// ============ LIMITS ============

export const LIMITS = {
  /** Minimum bet amount */
  MIN_BET: CONFIG.CRAPS_MIN,

  /** Maximum bet amount */
  MAX_BET: CONFIG.CRAPS_MAX,

  /** Maximum total exposure per user per session */
  MAX_EXPOSURE: CONFIG.CRAPS_MAX_EXPOSURE,
} as const;

// ============ EMBED COLORS ============

export const EMBED_COLORS = {
  /** Table is idle/cold */
  COLD: 0x95a5a6,
  /** Betting is open */
  BETTING: 0x3498db,
  /** Dice are rolling */
  ROLLING: 0xf1c40f,
  /** Win result */
  WIN: 0x2ecc71,
  /** Loss result */
  LOSE: 0xe74c3c,
  /** Push/return */
  PUSH: 0x9b59b6,
  /** Point established */
  POINT: 0xe67e22,
  /** Hot streak */
  HOT: 0xff6b6b,
} as const;

// ============ DICE DISPLAY ============

/**
 * Unicode dice face emojis
 */
export const DICE_EMOJI: Record<number, string> = {
  1: '⚀',
  2: '⚁',
  3: '⚂',
  4: '⚃',
  5: '⚄',
  6: '⚅',
} as const;

/**
 * Get the emoji for a single die value
 */
export function getDieEmoji(value: number): string {
  return DICE_EMOJI[value] || '?';
}

/**
 * Format a dice roll as emoji display
 * @example formatDiceRoll(4, 5) → "⚃ ⚄"
 */
export function formatDiceRoll(die1: number, die2: number): string {
  return `${getDieEmoji(die1)} ${getDieEmoji(die2)}`;
}

/**
 * Roll two dice and return the result
 */
export function rollDice(): Roll {
  const die1 = Math.floor(Math.random() * 6) + 1;
  const die2 = Math.floor(Math.random() * 6) + 1;
  return {
    die1,
    die2,
    total: die1 + die2,
    timestamp: new Date(),
  };
}

// ============ ROLL CLASSIFICATION ============

/** Numbers that establish a point */
export const POINT_NUMBERS: readonly number[] = [4, 5, 6, 8, 9, 10];

/** Natural win on come-out */
export const NATURAL_NUMBERS: readonly number[] = [7, 11];

/** Craps loss on come-out */
export const CRAPS_NUMBERS: readonly number[] = [2, 3, 12];

/** Field winning numbers */
export const FIELD_WINNERS: readonly number[] = [2, 3, 4, 9, 10, 11, 12];

/** Field losing numbers */
export const FIELD_LOSERS: readonly number[] = [5, 6, 7, 8];

/**
 * Check if a roll is a natural (7 or 11)
 */
export function isNatural(total: number): boolean {
  return NATURAL_NUMBERS.includes(total);
}

/**
 * Check if a roll is craps (2, 3, or 12)
 */
export function isCraps(total: number): boolean {
  return CRAPS_NUMBERS.includes(total);
}

/**
 * Check if a roll establishes a point
 */
export function isPointNumber(total: number): boolean {
  return POINT_NUMBERS.includes(total);
}

/**
 * Check if a roll wins the field bet
 */
export function isFieldWinner(total: number): boolean {
  return FIELD_WINNERS.includes(total);
}

// ============ PAYOUT CALCULATION ============

/**
 * Calculate payout for a winning bet
 * @param amount - Original bet amount
 * @param payout - Payout ratio [win, wager]
 * @returns Total return (original bet + winnings)
 */
export function calculatePayout(amount: number, payout: readonly [number, number]): number {
  const [win, wager] = payout;
  const winnings = Math.floor((amount * win) / wager);
  return amount + winnings;
}

/**
 * Calculate field bet payout (special cases for 2 and 12)
 * @param amount - Original bet amount
 * @param total - Dice total
 * @returns Total return
 */
export function calculateFieldPayout(amount: number, total: number): number {
  if (total === 2) {
    // 2:1 on 2
    return amount + amount * 2;
  }
  if (total === 12) {
    // 3:1 on 12
    return amount + amount * 3;
  }
  // 1:1 on other field winners
  return amount * 2;
}

/**
 * Calculate place bet payout (7:6)
 * @param amount - Original bet amount
 * @returns Winnings only (bet stays active)
 */
export function calculatePlacePayout(amount: number): number {
  return Math.floor((amount * 7) / 6);
}

// ============ DISPLAY HELPERS ============

/**
 * Get human-readable name for a roll total
 */
export function getRollName(total: number, point: number | null): string {
  if (total === 7) {
    return point === null ? 'SEVEN! Natural!' : 'SEVEN OUT!';
  }
  if (total === 11) {
    return 'YO-LEVEN!';
  }
  if (total === 2) {
    return 'SNAKE EYES!';
  }
  if (total === 3) {
    return 'ACE-DEUCE!';
  }
  if (total === 12) {
    return 'BOXCARS!';
  }
  if (point !== null && total === point) {
    return `${total}! POINT HIT!`;
  }
  return `${total}!`;
}

/**
 * Get display name for a bet type
 */
export function getBetDisplay(betType: BetType): string {
  return BET_TYPES[betType]?.name ?? betType;
}

/**
 * Format amount with abbreviation (1000 -> 1K)
 */
export function formatAmount(amount: number): string {
  if (amount >= 10000) {
    return `${(amount / 1000).toFixed(amount % 1000 === 0 ? 0 : 1)}K`;
  }
  if (amount >= 1000) {
    return `${(amount / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  }
  return String(amount);
}

// ============ CHANNEL CONFIGURATION ============

/**
 * Get the craps channel ID from environment
 */
export function getCrapsChannelId(): string | undefined {
  return process.env.CRAPS_CHANNEL_ID;
}

// ============ HOT STREAK THRESHOLDS ============

export const HOT_STREAK_THRESHOLDS = {
  /** Rolls needed for "warming up" message */
  WARM: 5,
  /** Rolls needed for "hot table" message */
  HOT: 8,
  /** Rolls needed for "monster roll" message */
  MONSTER: 12,
  /** Rolls needed for "legendary" message */
  LEGENDARY: 15,
} as const;

/**
 * Get hot streak message based on roll count
 */
export function getHotStreakMessage(rollCount: number): string | null {
  if (rollCount >= HOT_STREAK_THRESHOLDS.LEGENDARY) {
    return `LEGENDARY! ${rollCount} rolls!`;
  }
  if (rollCount >= HOT_STREAK_THRESHOLDS.MONSTER) {
    return `MONSTER ROLL! ${rollCount} rolls!`;
  }
  if (rollCount >= HOT_STREAK_THRESHOLDS.HOT) {
    return `HOT TABLE! ${rollCount} rolls and counting!`;
  }
  if (rollCount >= HOT_STREAK_THRESHOLDS.WARM) {
    return `Table is heating up! ${rollCount} rolls!`;
  }
  return null;
}

