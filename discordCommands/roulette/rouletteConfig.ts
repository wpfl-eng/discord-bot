// Roulette Configuration
// American roulette wheel with Vegas standard payouts

import { emoji } from '../../emoji/emojiRegistry.js';
import { pocketEmojiName } from '../../emoji/emojiRegistry.js';

// ============ WHEEL LAYOUT ============

export const RED_NUMBERS: readonly number[] = [
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
];

export const BLACK_NUMBERS: readonly number[] = [
  2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35,
];

export const GREEN_NUMBERS: readonly string[] = ['0', '00'];

// All 38 positions on American roulette wheel
export const WHEEL_POSITIONS: readonly string[] = [
  '0',
  '00',
  ...Array.from({ length: 36 }, (_, i) => String(i + 1)),
];

// ============ COLORS ============

export type RouletteColor = 'red' | 'black' | 'green';

export function getColor(num: string): RouletteColor {
  if (num === '0' || num === '00') return 'green';
  const n = parseInt(num, 10);
  return RED_NUMBERS.includes(n) ? 'red' : 'black';
}

export function getColorEmoji(color: RouletteColor): string {
  switch (color) {
    case 'red':
      return '🔴';
    case 'black':
      return '⚫';
    case 'green':
      return '🟢';
  }
}

// ============ BET TYPES ============

export interface BetType {
  readonly name: string;
  readonly display: string;
  readonly payout: number; // Profit multiplier (1:1 = 1, 35:1 = 35)
  readonly matches: (result: string, color: RouletteColor) => boolean;
}

// Column definitions
const FIRST_COLUMN = [1, 4, 7, 10, 13, 16, 19, 22, 25, 28, 31, 34];
const SECOND_COLUMN = [2, 5, 8, 11, 14, 17, 20, 23, 26, 29, 32, 35];
const THIRD_COLUMN = [3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36];

export const BET_TYPES: Record<string, BetType> = {
  // Outside bets - 1:1 payout
  red: {
    name: 'red',
    display: '🔴 Red',
    payout: 1,
    matches: (_r, color) => color === 'red',
  },
  black: {
    name: 'black',
    display: '⚫ Black',
    payout: 1,
    matches: (_r, color) => color === 'black',
  },
  odd: {
    name: 'odd',
    display: 'Odd',
    payout: 1,
    matches: (r, color) => {
      if (color === 'green') return false;
      const n = parseInt(r, 10);
      return n % 2 === 1;
    },
  },
  even: {
    name: 'even',
    display: 'Even',
    payout: 1,
    matches: (r, color) => {
      if (color === 'green') return false;
      const n = parseInt(r, 10);
      return n % 2 === 0;
    },
  },
  low: {
    name: 'low',
    display: '1-18',
    payout: 1,
    matches: (r, color) => {
      if (color === 'green') return false;
      const n = parseInt(r, 10);
      return n >= 1 && n <= 18;
    },
  },
  high: {
    name: 'high',
    display: '19-36',
    payout: 1,
    matches: (r, color) => {
      if (color === 'green') return false;
      const n = parseInt(r, 10);
      return n >= 19 && n <= 36;
    },
  },

  // Dozen bets - 2:1 payout
  'first-dozen': {
    name: 'first-dozen',
    display: '1st 12',
    payout: 2,
    matches: (r, color) => {
      if (color === 'green') return false;
      const n = parseInt(r, 10);
      return n >= 1 && n <= 12;
    },
  },
  'second-dozen': {
    name: 'second-dozen',
    display: '2nd 12',
    payout: 2,
    matches: (r, color) => {
      if (color === 'green') return false;
      const n = parseInt(r, 10);
      return n >= 13 && n <= 24;
    },
  },
  'third-dozen': {
    name: 'third-dozen',
    display: '3rd 12',
    payout: 2,
    matches: (r, color) => {
      if (color === 'green') return false;
      const n = parseInt(r, 10);
      return n >= 25 && n <= 36;
    },
  },

  // Column bets - 2:1 payout
  'first-column': {
    name: 'first-column',
    display: '1st Col',
    payout: 2,
    matches: (r, color) => {
      if (color === 'green') return false;
      return FIRST_COLUMN.includes(parseInt(r, 10));
    },
  },
  'second-column': {
    name: 'second-column',
    display: '2nd Col',
    payout: 2,
    matches: (r, color) => {
      if (color === 'green') return false;
      return SECOND_COLUMN.includes(parseInt(r, 10));
    },
  },
  'third-column': {
    name: 'third-column',
    display: '3rd Col',
    payout: 2,
    matches: (r, color) => {
      if (color === 'green') return false;
      return THIRD_COLUMN.includes(parseInt(r, 10));
    },
  },
};

// Add straight-up number bets (0, 00, 1-36) - 35:1 payout
for (const pos of WHEEL_POSITIONS) {
  BET_TYPES[pos] = {
    name: pos,
    display: pos,
    payout: 35,
    matches: (r) => r === pos,
  };
}

// ============ AUTOCOMPLETE OPTIONS ============

export const ALL_BET_TYPES: readonly string[] = [
  'red',
  'black',
  'odd',
  'even',
  'low',
  'high',
  'first-dozen',
  'second-dozen',
  'third-dozen',
  'first-column',
  'second-column',
  'third-column',
  ...WHEEL_POSITIONS,
];

// ============ TIMING ============

/**
 * The table runs as a session: it opens on the first bet, spins repeatedly, and closes
 * after a spin nobody bets on. Windows are short and extend when bets land, so an
 * active table keeps moving instead of sitting through a fixed two-minute wait.
 *
 * Mirrors the shape of the craps table's TIMING block so both games feel the same.
 */
export const TIMING = {
  /** Betting window for the first spin after the table opens */
  FIRST_WINDOW_SECONDS: 45,

  /** Betting window for every spin after that */
  NEXT_WINDOW_SECONDS: 30,

  /** Each new bet pushes the window out by this much */
  BET_EXTENDS_BY_SECONDS: 5,

  /** Ceiling on extensions, so a busy table still spins */
  MAX_WINDOW_SECONDS: 60,

  /** How long the table stays open after a spin with no bets before closing */
  GRACE_SECONDS: 30,

  /** Gap between frames of the spin animation */
  SPIN_FRAME_MS: 800,

  /** How long the result stays up before the next betting window opens */
  RESULT_HOLD_MS: 3000,
} as const;

// ============ TABLE LIMITS ============

export const LIMITS = {
  MIN_BET: 10,

  /**
   * Roulette carries its own ceiling rather than borrowing CONFIG.GAMBLE_MAX (10,000).
   * At 35:1 a max straight-up returns 3,500,000; there is deliberately no house-side
   * cap on the payout.
   */
  MAX_BET: 100_000,

  /** How many spins the table remembers for the recent-results strip */
  HISTORY_LENGTH: 12,
} as const;

/** One-click stake buttons, spanning the range up to MAX_BET */
export const CHIPS: readonly number[] = [100, 1_000, 10_000, 50_000];

/** Stake a player starts on before touching a chip button */
export const DEFAULT_CHIP = 1_000;

// ============ EMBED COLORS ============

export const EMBED_COLORS = {
  ACTIVE: 0x3498db, // Blue
  SPINNING: 0xf1c40f, // Gold
  WIN: 0x2ecc71, // Green
  LOSE: 0xe74c3c, // Red
  CLOSED: 0x5d6874, // Slate - the table is shut
} as const;

// ============ FORMATTING ============

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

/**
 * Get display name for a bet type
 */
export function getBetDisplay(betType: string): string {
  const bet = BET_TYPES[betType];
  return bet?.display ?? betType;
}

// ============ POCKET DISPLAY ============

/**
 * Render a pocket as its custom tile, falling back to a coloured circle plus the
 * number when the emoji set has not been uploaded.
 *
 * Kept here rather than in the renderer so the strip, the result banner and the stats
 * command all read a pocket the same way.
 */
export function pocketDisplay(position: string): string {
  return emoji(pocketEmojiName(position), `${getColorEmoji(getColor(position))}${position}`);
}

/**
 * Just the pocket's icon, with no number baked in.
 *
 * pocketDisplay's text fallback includes the number so a bare strip still reads, which
 * makes it wrong anywhere the number is already printed alongside.
 */
export function pocketIcon(position: string): string {
  return emoji(pocketEmojiName(position), getColorEmoji(getColor(position)));
}

/**
 * Label for a bet as it appears on a slip or the live board. Straight-up bets show
 * their pocket tile; everything else uses its written name.
 */
export function betDisplayRich(betType: string): string {
  if (WHEEL_POSITIONS.includes(betType)) return pocketDisplay(betType);
  return getBetDisplay(betType);
}
