// Blackjack Side Bets
//
// 21+3 and Perfect Pairs. Both settle the INSTANT the cards are dealt, before any seat
// acts, so they add a second optional stake and a paytable but nothing at all to the
// turn model.
//
// That is also what makes them work on a shared board: a seat hitting suited trips for
// 100:1 is visible to the whole table the moment the deal finishes, rather than being
// buried in a private result several minutes later.

import { RANKS, cardColor, type Card, type Rank } from './blackjackUtils.js';

// ============ PERFECT PAIRS ============

export type PerfectPairsTier = 'perfect' | 'colored' | 'mixed';

/** Profit multiplier per tier. House edge is roughly 4.1% on six decks. */
export const PERFECT_PAIRS_PAYOUT: Readonly<Record<PerfectPairsTier, number>> = {
  /** Same rank and same suit - only possible with more than one deck */
  perfect: 25,
  /** Same rank, same colour, different suit */
  colored: 12,
  /** Same rank, different colour */
  mixed: 6,
} as const;

/**
 * Grade a player's opening two cards.
 *
 * @returns the tier, or null when the cards are not a pair at all
 */
export function gradePerfectPairs(cards: readonly Card[]): PerfectPairsTier | null {
  if (cards.length < 2) return null;

  const [a, b] = cards;
  if (a.rank !== b.rank) return null;

  if (a.suit === b.suit) return 'perfect';
  return cardColor(a) === cardColor(b) ? 'colored' : 'mixed';
}

// ============ 21+3 ============

export type TwentyOnePlusThreeTier =
  | 'suited_trips'
  | 'straight_flush'
  | 'trips'
  | 'straight'
  | 'flush';

/** Profit multiplier per tier. House edge is roughly 3.2% on six decks. */
export const TWENTY_ONE_PLUS_THREE_PAYOUT: Readonly<Record<TwentyOnePlusThreeTier, number>> = {
  suited_trips: 100,
  straight_flush: 40,
  trips: 30,
  straight: 10,
  flush: 5,
} as const;

/**
 * Rank order for straights.
 *
 * The ace is deliberately allowed at both ends: A-2-3 and Q-K-A are both straights at
 * every table that offers this bet.
 */
const STRAIGHT_ORDER: readonly Rank[] = RANKS;

function rankIndex(rank: Rank): number {
  return STRAIGHT_ORDER.indexOf(rank);
}

/** Whether three ranks form a run, treating the ace as either low or high. */
function isStraight(ranks: readonly Rank[]): boolean {
  const indices: number[] = ranks.map(rankIndex).sort((a, b) => a - b);

  const consecutive: boolean = indices[1] === indices[0] + 1 && indices[2] === indices[1] + 1;
  if (consecutive) return true;

  // Q-K-A wraps: with A at index 0, that sorts to [0, 11, 12].
  return indices[0] === 0 && indices[1] === 11 && indices[2] === 12;
}

/**
 * Grade the player's two cards plus the dealer's upcard as a three-card poker hand.
 *
 * @param playerCards - the seat's opening two cards
 * @param dealerUpcard - the dealer's face-up card
 * @returns the tier, or null when the three cards make nothing
 */
export function gradeTwentyOnePlusThree(
  playerCards: readonly Card[],
  dealerUpcard: Card | undefined
): TwentyOnePlusThreeTier | null {
  if (playerCards.length < 2 || !dealerUpcard) return null;

  const cards: Card[] = [playerCards[0], playerCards[1], dealerUpcard];
  const ranks: Rank[] = cards.map((c) => c.rank);
  const suited: boolean = cards.every((c) => c.suit === cards[0].suit);
  const sameRank: boolean = ranks.every((r) => r === ranks[0]);

  // Ordered most valuable first: suited trips beats a straight flush, which beats trips.
  if (sameRank && suited) return 'suited_trips';
  if (suited && isStraight(ranks)) return 'straight_flush';
  if (sameRank) return 'trips';
  if (isStraight(ranks)) return 'straight';
  if (suited) return 'flush';

  return null;
}

// ============ SETTLEMENT ============

export type SideBetKind = 'pairs' | 'p3';

export interface SideBetResult {
  readonly kind: SideBetKind;
  readonly stake: number;
  /** Tier hit, or null for a loss */
  readonly tier: string | null;
  /** Total returned to the wallet: stake plus profit, or 0 */
  readonly payout: number;
  /** Payout minus stake */
  readonly net: number;
  /** Human label for the board, e.g. 'Suited trips 100:1' */
  readonly label: string;
}

const TIER_LABEL: Readonly<Record<string, string>> = {
  perfect: 'Perfect pair',
  colored: 'Coloured pair',
  mixed: 'Mixed pair',
  suited_trips: 'Suited trips',
  straight_flush: 'Straight flush',
  trips: 'Three of a kind',
  straight: 'Straight',
  flush: 'Flush',
} as const;

function settle(
  kind: SideBetKind,
  stake: number,
  tier: string | null,
  multiplier: number
): SideBetResult {
  if (stake <= 0 || tier === null) {
    return {
      kind,
      stake,
      tier: null,
      payout: 0,
      net: stake > 0 ? -stake : 0,
      label: kind === 'pairs' ? 'Perfect Pairs — no pair' : '21+3 — no hand',
    };
  }

  const payout: number = stake + stake * multiplier;
  return {
    kind,
    stake,
    tier,
    payout,
    net: payout - stake,
    label: `${TIER_LABEL[tier] ?? tier} ${multiplier}:1`,
  };
}

/**
 * Settle Perfect Pairs for one seat.
 *
 * @param stake - the side stake; 0 means the seat did not take the bet
 * @param cards - the seat's opening two cards
 */
export function resolvePerfectPairs(stake: number, cards: readonly Card[]): SideBetResult {
  const tier: PerfectPairsTier | null = gradePerfectPairs(cards);
  return settle('pairs', stake, tier, tier ? PERFECT_PAIRS_PAYOUT[tier] : 0);
}

/**
 * Settle 21+3 for one seat.
 *
 * @param stake - the side stake; 0 means the seat did not take the bet
 * @param cards - the seat's opening two cards
 * @param dealerUpcard - the dealer's face-up card
 */
export function resolveTwentyOnePlusThree(
  stake: number,
  cards: readonly Card[],
  dealerUpcard: Card | undefined
): SideBetResult {
  const tier: TwentyOnePlusThreeTier | null = gradeTwentyOnePlusThree(cards, dealerUpcard);
  return settle('p3', stake, tier, tier ? TWENTY_ONE_PLUS_THREE_PAYOUT[tier] : 0);
}
