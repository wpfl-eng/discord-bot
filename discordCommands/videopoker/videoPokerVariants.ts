// Video Poker Variants
// Extensible variant system for different video poker games

import type { Card, Hand, Deck } from '../blackjack/blackjackUtils.js';
import { createDeck } from '../blackjack/blackjackUtils.js';
import {
  HandRank,
  PayoutTable,
  HandResult,
  JACKS_OR_BETTER_PAYOUTS,
  DEUCES_WILD_PAYOUTS,
  HAND_NAMES,
} from './videoPokerConfig.js';
import { evaluateHand } from './videoPokerUtils.js';

// ============================================================
// Type Definitions
// ============================================================

/**
 * Interface for video poker game variants
 * Each variant can have different rules, payouts, and wild cards
 */
export interface VideoPokerVariant {
  /** Unique identifier for this variant */
  readonly id: string;

  /** Display name for the variant */
  readonly name: string;

  /** Short description of the variant */
  readonly description: string;

  /** Payout table for this variant */
  readonly payoutTable: PayoutTable;

  /**
   * Create the deck for this variant
   * Standard is 52 cards, but Joker Poker would have 53
   */
  createDeck(): Deck;

  /**
   * Check if a card is wild in this variant
   * @param card - The card to check
   * @returns true if the card is wild
   */
  isWildCard(card: Card): boolean;

  /**
   * Evaluate a 5-card hand for this variant
   * @param hand - The hand to evaluate
   * @returns Complete hand result with rank, name, and payout
   */
  evaluateHand(hand: Hand): HandResult;

  /**
   * Get the minimum hand rank that pays out in this variant
   */
  getMinPayingRank(): HandRank;
}

// ============================================================
// Jacks or Better Variant
// ============================================================

/**
 * Jacks or Better - The classic video poker variant
 * Standard 52-card deck, no wild cards
 * Minimum paying hand is a pair of Jacks or better
 */
export class JacksOrBetterVariant implements VideoPokerVariant {
  readonly id = 'jacks_or_better';
  readonly name = 'Jacks or Better';
  readonly description = 'Classic video poker - pair of Jacks or better to win';
  readonly payoutTable = JACKS_OR_BETTER_PAYOUTS;

  createDeck(): Deck {
    return createDeck();
  }

  isWildCard(_card: Card): boolean {
    return false; // No wild cards in Jacks or Better
  }

  evaluateHand(hand: Hand): HandResult {
    const rank = evaluateHand(hand);
    const multiplier = this.payoutTable[rank];
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

  getMinPayingRank(): HandRank {
    return HandRank.JACKS_OR_BETTER;
  }
}

// ============================================================
// Deuces Wild Variant (Future Implementation)
// ============================================================

/**
 * Deuces Wild - All 2s are wild cards
 * Minimum paying hand is Three of a Kind
 * Two Pair and Jacks or Better don't pay
 */
export class DeucesWildVariant implements VideoPokerVariant {
  readonly id = 'deuces_wild';
  readonly name = 'Deuces Wild';
  readonly description = 'All 2s are wild - three of a kind or better to win';
  readonly payoutTable = DEUCES_WILD_PAYOUTS;

  createDeck(): Deck {
    return createDeck();
  }

  isWildCard(card: Card): boolean {
    return card.rank === '2';
  }

  evaluateHand(hand: Hand): HandResult {
    // For Deuces Wild, we need to find the best possible hand
    // by considering all possible substitutions for the 2s
    const rank = this.evaluateWithWilds(hand);
    const multiplier = this.payoutTable[rank];
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

  getMinPayingRank(): HandRank {
    return HandRank.THREE_OF_A_KIND;
  }

  /**
   * Evaluate a hand with wild cards by finding the best possible hand
   * This is a simplified implementation - for production, use optimized algorithm
   */
  private evaluateWithWilds(hand: Hand): HandRank {
    const wildCount = hand.filter((card) => this.isWildCard(card)).length;

    if (wildCount === 0) {
      // No wilds, evaluate normally
      return evaluateHand(hand);
    }

    // With wilds, we can guarantee certain hands based on wild count
    // This is a simplified heuristic - full implementation would enumerate all possibilities
    const nonWilds = hand.filter((card) => !this.isWildCard(card));
    const nonWildRank = nonWilds.length >= 2 ? this.evaluateNonWilds(nonWilds, wildCount) : HandRank.HIGH_CARD;

    // With wilds, we can boost hands significantly
    switch (wildCount) {
      case 4:
        return HandRank.FOUR_OF_A_KIND; // 4 wilds = at least 4 of a kind
      case 3:
        return Math.max(HandRank.FOUR_OF_A_KIND, nonWildRank) as HandRank;
      case 2:
        return Math.max(HandRank.THREE_OF_A_KIND, this.boostWithWilds(nonWildRank, 2)) as HandRank;
      case 1:
        return this.boostWithWilds(nonWildRank, 1);
      default:
        return nonWildRank;
    }
  }

  private evaluateNonWilds(nonWilds: Card[], _wildCount: number): HandRank {
    // Simplified: just check patterns in non-wild cards
    if (nonWilds.length < 2) return HandRank.HIGH_CARD;

    // Pad to 5 cards with placeholder for evaluation
    // This is a simplification - real implementation would be more sophisticated
    return HandRank.HIGH_CARD;
  }

  private boostWithWilds(baseRank: HandRank, wildCount: number): HandRank {
    // Simplified boosting logic
    if (wildCount >= 2) {
      if (baseRank >= HandRank.THREE_OF_A_KIND) return HandRank.FOUR_OF_A_KIND;
      if (baseRank >= HandRank.TWO_PAIR) return HandRank.FOUR_OF_A_KIND;
      return HandRank.THREE_OF_A_KIND;
    }
    if (wildCount === 1) {
      if (baseRank >= HandRank.THREE_OF_A_KIND) return HandRank.FOUR_OF_A_KIND;
      if (baseRank >= HandRank.TWO_PAIR) return HandRank.FULL_HOUSE;
      if (baseRank >= HandRank.JACKS_OR_BETTER) return HandRank.THREE_OF_A_KIND;
      return HandRank.JACKS_OR_BETTER; // At minimum, one wild makes a pair
    }
    return baseRank;
  }
}

// ============================================================
// Variant Registry
// ============================================================

/**
 * Registry of all available video poker variants
 */
export const VARIANTS: Map<string, VideoPokerVariant> = new Map<string, VideoPokerVariant>([
  ['jacks_or_better', new JacksOrBetterVariant()],
  ['deuces_wild', new DeucesWildVariant()],
]);

/**
 * Get the default variant (Jacks or Better)
 */
export function getDefaultVariant(): VideoPokerVariant {
  return VARIANTS.get('jacks_or_better')!;
}

/**
 * Get a variant by ID
 * @param id - The variant ID
 * @returns The variant or undefined if not found
 */
export function getVariant(id: string): VideoPokerVariant | undefined {
  return VARIANTS.get(id);
}

/**
 * Get all available variants
 * @returns Array of all variants
 */
export function getAllVariants(): VideoPokerVariant[] {
  return Array.from(VARIANTS.values());
}

/**
 * Get all variant IDs
 * @returns Array of variant IDs
 */
export function getVariantIds(): string[] {
  return Array.from(VARIANTS.keys());
}
