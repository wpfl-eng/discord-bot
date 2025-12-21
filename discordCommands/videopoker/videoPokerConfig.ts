// Video Poker Configuration
// Hand rankings, payout tables, and game constants

// ============================================================
// Type Definitions
// ============================================================

/**
 * Hand rankings ordered by value (higher = better hand)
 * Used for hand evaluation and payout lookup
 */
export enum HandRank {
  HIGH_CARD = 0,
  JACKS_OR_BETTER = 1,
  TWO_PAIR = 2,
  THREE_OF_A_KIND = 3,
  STRAIGHT = 4,
  FLUSH = 5,
  FULL_HOUSE = 6,
  FOUR_OF_A_KIND = 7,
  STRAIGHT_FLUSH = 8,
  ROYAL_FLUSH = 9,
}

/**
 * Payout table mapping hand ranks to multipliers
 */
export type PayoutTable = Readonly<Record<HandRank, number>>;

/**
 * Result of evaluating a poker hand
 */
export interface HandResult {
  readonly rank: HandRank;
  readonly name: string;
  readonly multiplier: number;
  readonly isWin: boolean;
  readonly isBigWin?: boolean;
}

// ============================================================
// Constants
// ============================================================

/**
 * Human-readable names for each hand rank
 */
export const HAND_NAMES: Readonly<Record<HandRank, string>> = {
  [HandRank.HIGH_CARD]: 'High Card',
  [HandRank.JACKS_OR_BETTER]: 'Jacks or Better',
  [HandRank.TWO_PAIR]: 'Two Pair',
  [HandRank.THREE_OF_A_KIND]: 'Three of a Kind',
  [HandRank.STRAIGHT]: 'Straight',
  [HandRank.FLUSH]: 'Flush',
  [HandRank.FULL_HOUSE]: 'Full House',
  [HandRank.FOUR_OF_A_KIND]: 'Four of a Kind',
  [HandRank.STRAIGHT_FLUSH]: 'Straight Flush',
  [HandRank.ROYAL_FLUSH]: 'Royal Flush',
} as const;

/**
 * Jacks or Better payout table (standard 9/6 payouts)
 * Multipliers are applied to the bet amount
 */
export const JACKS_OR_BETTER_PAYOUTS: PayoutTable = {
  [HandRank.ROYAL_FLUSH]: 250,
  [HandRank.STRAIGHT_FLUSH]: 50,
  [HandRank.FOUR_OF_A_KIND]: 25,
  [HandRank.FULL_HOUSE]: 9,
  [HandRank.FLUSH]: 6,
  [HandRank.STRAIGHT]: 4,
  [HandRank.THREE_OF_A_KIND]: 3,
  [HandRank.TWO_PAIR]: 2,
  [HandRank.JACKS_OR_BETTER]: 1,
  [HandRank.HIGH_CARD]: 0,
} as const;

/**
 * Deuces Wild payout table (for future implementation)
 * Note: Two Pair and Jacks or Better don't pay in Deuces Wild
 */
export const DEUCES_WILD_PAYOUTS: PayoutTable = {
  [HandRank.ROYAL_FLUSH]: 250,
  [HandRank.STRAIGHT_FLUSH]: 50,
  [HandRank.FOUR_OF_A_KIND]: 15,
  [HandRank.FULL_HOUSE]: 9,
  [HandRank.FLUSH]: 5,
  [HandRank.STRAIGHT]: 4,
  [HandRank.THREE_OF_A_KIND]: 1,
  [HandRank.TWO_PAIR]: 0,
  [HandRank.JACKS_OR_BETTER]: 0,
  [HandRank.HIGH_CARD]: 0,
} as const;

/**
 * Bonus Poker payout table (for future implementation)
 * Higher payouts for specific four-of-a-kind hands
 */
export const BONUS_POKER_PAYOUTS: PayoutTable = {
  [HandRank.ROYAL_FLUSH]: 250,
  [HandRank.STRAIGHT_FLUSH]: 50,
  [HandRank.FOUR_OF_A_KIND]: 40, // Higher for aces, lower for 2-4, standard for 5-K
  [HandRank.FULL_HOUSE]: 8,
  [HandRank.FLUSH]: 5,
  [HandRank.STRAIGHT]: 4,
  [HandRank.THREE_OF_A_KIND]: 3,
  [HandRank.TWO_PAIR]: 2,
  [HandRank.JACKS_OR_BETTER]: 1,
  [HandRank.HIGH_CARD]: 0,
} as const;

// ============================================================
// Helper Functions
// ============================================================

/**
 * Get the display name for a hand rank
 * @param rank - The hand rank
 * @returns Human-readable name
 */
export function getHandName(rank: HandRank): string {
  return HAND_NAMES[rank];
}

/**
 * Check if a hand rank is a winning hand for a given payout table
 * @param rank - The hand rank
 * @param payoutTable - The payout table to check against
 * @returns true if the hand pays out
 */
export function isWinningHand(rank: HandRank, payoutTable: PayoutTable): boolean {
  return payoutTable[rank] > 0;
}

/**
 * Get the multiplier for a hand rank from a payout table
 * @param rank - The hand rank
 * @param payoutTable - The payout table
 * @returns The payout multiplier
 */
export function getMultiplier(rank: HandRank, payoutTable: PayoutTable): number {
  return payoutTable[rank];
}

/**
 * Create a HandResult from a rank and payout table
 * @param rank - The evaluated hand rank
 * @param payoutTable - The payout table to use
 * @returns Complete hand result
 */
export function createHandResult(rank: HandRank, payoutTable: PayoutTable): HandResult {
  const multiplier = payoutTable[rank];
  const isWin = multiplier > 0;
  const isBigWin = rank >= HandRank.FOUR_OF_A_KIND;

  return {
    rank,
    name: HAND_NAMES[rank],
    multiplier,
    isWin,
    isBigWin,
  };
}
