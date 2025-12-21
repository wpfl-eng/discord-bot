// Video Poker Utility Functions
// Pure functions for hand evaluation and display

import type { Card, Hand, Rank, Suit } from '../blackjack/blackjackUtils.js';
import { formatCard } from '../blackjack/blackjackUtils.js';
import { HandRank } from './videoPokerConfig.js';

// ============================================================
// Type Definitions
// ============================================================

export type RankCounts = Map<Rank, number>;
export type SuitCounts = Map<Suit, number>;

// ============================================================
// Analysis Functions
// ============================================================

/**
 * Convert a rank to its numeric value for straight detection
 * A=14 (high), K=13, Q=12, J=11, 10-2=face value
 * Note: Ace can also be 1 for wheel straight (A-2-3-4-5)
 */
export function getRankValue(rank: Rank): number {
  switch (rank) {
    case 'A':
      return 14;
    case 'K':
      return 13;
    case 'Q':
      return 12;
    case 'J':
      return 11;
    default:
      return parseInt(rank, 10);
  }
}

/**
 * Count occurrences of each rank in a hand
 * @param hand - The 5-card hand
 * @returns Map of rank to count
 */
export function getRankCounts(hand: Hand): RankCounts {
  const counts: RankCounts = new Map();
  for (const card of hand) {
    counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  }
  return counts;
}

/**
 * Count occurrences of each suit in a hand
 * @param hand - The 5-card hand
 * @returns Map of suit to count
 */
export function getSuitCounts(hand: Hand): SuitCounts {
  const counts: SuitCounts = new Map();
  for (const card of hand) {
    counts.set(card.suit, (counts.get(card.suit) ?? 0) + 1);
  }
  return counts;
}

/**
 * Get sorted numeric values of the hand (highest to lowest)
 * @param hand - The 5-card hand
 * @returns Array of numeric values sorted descending
 */
export function getSortedValues(hand: Hand): number[] {
  return hand.map((card) => getRankValue(card.rank)).sort((a, b) => b - a);
}

/**
 * Get the count values sorted descending (e.g., [3, 2] for full house)
 * @param rankCounts - The rank counts from getRankCounts
 * @returns Array of counts sorted descending
 */
export function getCountPattern(rankCounts: RankCounts): number[] {
  return Array.from(rankCounts.values()).sort((a, b) => b - a);
}

// ============================================================
// Hand Detection Functions (Pure)
// ============================================================

/**
 * Check if all 5 cards are the same suit
 */
export function isFlush(hand: Hand): boolean {
  const suitCounts = getSuitCounts(hand);
  return suitCounts.size === 1;
}

/**
 * Check if the hand is a straight (5 consecutive ranks)
 * Handles wheel straight (A-2-3-4-5) as well as regular straights
 */
export function isStraight(hand: Hand): boolean {
  const values = getSortedValues(hand);

  // Check for regular straight (5 consecutive values)
  const isRegularStraight =
    new Set(values).size === 5 && values[0] - values[4] === 4;

  // Check for wheel straight (A-2-3-4-5)
  // Values would be [14, 5, 4, 3, 2]
  const isWheelStraight =
    values[0] === 14 &&
    values[1] === 5 &&
    values[2] === 4 &&
    values[3] === 3 &&
    values[4] === 2;

  return isRegularStraight || isWheelStraight;
}

/**
 * Check if the hand is a royal flush (A-K-Q-J-10 of same suit)
 */
export function isRoyalFlush(hand: Hand): boolean {
  if (!isFlush(hand)) return false;

  const values = getSortedValues(hand);
  // Royal flush: 14, 13, 12, 11, 10
  return (
    values[0] === 14 &&
    values[1] === 13 &&
    values[2] === 12 &&
    values[3] === 11 &&
    values[4] === 10
  );
}

/**
 * Check if the hand is a straight flush (straight + flush, but not royal)
 */
export function isStraightFlush(hand: Hand): boolean {
  return isFlush(hand) && isStraight(hand) && !isRoyalFlush(hand);
}

/**
 * Check if the hand has four of a kind
 */
export function isFourOfAKind(hand: Hand): boolean {
  const rankCounts = getRankCounts(hand);
  const pattern = getCountPattern(rankCounts);
  return pattern[0] === 4;
}

/**
 * Check if the hand is a full house (three of a kind + pair)
 */
export function isFullHouse(hand: Hand): boolean {
  const rankCounts = getRankCounts(hand);
  const pattern = getCountPattern(rankCounts);
  return pattern[0] === 3 && pattern[1] === 2;
}

/**
 * Check if the hand has three of a kind (but not full house or four of a kind)
 */
export function isThreeOfAKind(hand: Hand): boolean {
  const rankCounts = getRankCounts(hand);
  const pattern = getCountPattern(rankCounts);
  return pattern[0] === 3 && pattern[1] === 1;
}

/**
 * Check if the hand has two pair
 */
export function isTwoPair(hand: Hand): boolean {
  const rankCounts = getRankCounts(hand);
  const pattern = getCountPattern(rankCounts);
  return pattern[0] === 2 && pattern[1] === 2;
}

/**
 * Check if the hand has exactly one pair
 */
export function isPair(hand: Hand): boolean {
  const rankCounts = getRankCounts(hand);
  const pattern = getCountPattern(rankCounts);
  return pattern[0] === 2 && pattern[1] === 1;
}

/**
 * Check if the hand has a pair of Jacks or better (J, Q, K, A)
 * This is the minimum paying hand in Jacks or Better variant
 */
export function isJacksOrBetter(hand: Hand): boolean {
  if (!isPair(hand)) return false;

  const rankCounts = getRankCounts(hand);
  const highRanks: Rank[] = ['J', 'Q', 'K', 'A'];

  for (const [rank, count] of rankCounts) {
    if (count === 2 && highRanks.includes(rank)) {
      return true;
    }
  }
  return false;
}

/**
 * Get the rank of the pair in a hand (for display/stats)
 * Returns undefined if no pair exists
 */
export function getPairRank(hand: Hand): Rank | undefined {
  const rankCounts = getRankCounts(hand);
  for (const [rank, count] of rankCounts) {
    if (count === 2) {
      return rank;
    }
  }
  return undefined;
}

// ============================================================
// Main Evaluation Function
// ============================================================

/**
 * Evaluate a 5-card poker hand and return its rank
 * Checks from highest to lowest ranked hand
 * @param hand - The 5-card hand to evaluate
 * @returns The HandRank enum value
 */
export function evaluateHand(hand: Hand): HandRank {
  if (hand.length !== 5) {
    throw new Error(`Invalid hand size: expected 5 cards, got ${hand.length}`);
  }

  // Check from highest to lowest
  if (isRoyalFlush(hand)) return HandRank.ROYAL_FLUSH;
  if (isStraightFlush(hand)) return HandRank.STRAIGHT_FLUSH;
  if (isFourOfAKind(hand)) return HandRank.FOUR_OF_A_KIND;
  if (isFullHouse(hand)) return HandRank.FULL_HOUSE;
  if (isFlush(hand)) return HandRank.FLUSH;
  if (isStraight(hand)) return HandRank.STRAIGHT;
  if (isThreeOfAKind(hand)) return HandRank.THREE_OF_A_KIND;
  if (isTwoPair(hand)) return HandRank.TWO_PAIR;
  if (isJacksOrBetter(hand)) return HandRank.JACKS_OR_BETTER;

  return HandRank.HIGH_CARD;
}

// ============================================================
// Display Functions
// ============================================================

/**
 * Format a video poker hand for Discord display
 * Shows cards with HOLD indicators underneath held cards
 * @param hand - The 5-card hand
 * @param heldCards - Boolean array indicating which cards are held
 * @returns Formatted string for embed display
 */
export function formatVideoPokerHand(
  hand: Hand,
  heldCards: [boolean, boolean, boolean, boolean, boolean]
): string {
  const cardRow = hand.map((card) => `\`${formatCard(card)}\``).join('  ');
  const holdRow = heldCards.map((held) => (held ? 'HOLD' : '    ')).join('  ');

  return `${cardRow}\n${holdRow}`;
}

/**
 * Format a video poker hand for display without hold indicators
 * @param hand - The 5-card hand
 * @returns Formatted string for embed display
 */
export function formatVideoPokerHandSimple(hand: Hand): string {
  return hand.map((card) => `\`${formatCard(card)}\``).join('  ');
}

/**
 * Get emoji for hand rank result display
 * @param rank - The hand rank
 * @returns Emoji string
 */
export function getHandEmoji(rank: HandRank): string {
  switch (rank) {
    case HandRank.ROYAL_FLUSH:
      return '👑';
    case HandRank.STRAIGHT_FLUSH:
      return '🌟';
    case HandRank.FOUR_OF_A_KIND:
      return '🎯';
    case HandRank.FULL_HOUSE:
      return '🏠';
    case HandRank.FLUSH:
      return '♦️';
    case HandRank.STRAIGHT:
      return '➡️';
    case HandRank.THREE_OF_A_KIND:
      return '🎲';
    case HandRank.TWO_PAIR:
      return '✌️';
    case HandRank.JACKS_OR_BETTER:
      return '👍';
    default:
      return '💨';
  }
}
