// Blackjack Card and Deck Utilities

// The emoji registry only imports types from this module, so this pairing is erased at
// runtime and creates no import cycle.
import { emoji, cardEmojiName, CARD_BACK_NAME } from '../../emoji/emojiRegistry.js';

// ============ TYPE DEFINITIONS ============

export type Suit = '♠' | '♥' | '♦' | '♣';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface TableConfig {
  readonly name: 'main';
  readonly displayName: string;
  readonly deckCount: number;
  readonly dealerHitsSoft17: boolean;
}

// ============ TABLE CONFIGURATIONS ============

/**
 * The house rules.
 *
 * There is one table now, not two. A shared multi-seat game only works on one shoe, and
 * a single-deck game reshuffled every hand makes the shoe indicator - and any counting
 * it enables - meaningless.
 *
 * This takes the six-deck persistent shoe from the old Vegas Strip table and the
 * player-friendly stand-on-soft-17 rule from the old Classic table. With 3:2 blackjack,
 * double after split, late surrender and re-splits to four hands, the house edge is
 * roughly 0.35%.
 */
export const TABLES: Readonly<Record<string, TableConfig>> = {
  main: {
    name: 'main',
    displayName: 'Blackjack',
    deckCount: 6,
    dealerHitsSoft17: false, // S17 - stands on soft 17
  },
} as const;

export const DEFAULT_TABLE: TableConfig = TABLES.main;

export interface Card {
  readonly suit: Suit;
  readonly rank: Rank;
}

/** A card's colour group. Spades and clubs are black; hearts and diamonds are red. */
export function cardColor(card: Card): 'red' | 'black' {
  return card.suit === '♥' || card.suit === '♦' ? 'red' : 'black';
}

export type Hand = Card[];
export type Deck = Card[];

// ============ CONSTANTS ============

export const SUITS: readonly Suit[] = ['♠', '♥', '♦', '♣'] as const;
export const RANKS: readonly Rank[] = [
  'A',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '10',
  'J',
  'Q',
  'K',
] as const;

// ============ DECK FUNCTIONS ============

/**
 * Creates a new shuffled deck with the specified number of 52-card decks
 * @param deckCount - Number of decks to use (default: 1)
 */
export function createDeck(deckCount: number = 1): Deck {
  const deck: Deck = [];
  for (let d = 0; d < deckCount; d++) {
    for (const suit of SUITS) {
      for (const rank of RANKS) {
        deck.push({ suit, rank });
      }
    }
  }
  return shuffle(deck);
}

/**
 * Fisher-Yates shuffle algorithm
 * @param deck - Deck to shuffle (mutated in place)
 * @returns The same deck array (shuffled)
 */
export function shuffle<T>(deck: T[]): T[] {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/**
 * Draw a card from the deck
 * @param deck - The deck to draw from
 * @returns The drawn card or undefined if deck is empty
 */
export function drawCard(deck: Deck): Card | undefined {
  return deck.pop();
}

// ============ HAND VALUE CALCULATIONS ============

/**
 * Calculate the value of a blackjack hand
 * Handles soft hands (Ace = 11 or 1)
 */
export function calculateHandValue(hand: Hand): number {
  let value = 0;
  let aces = 0;

  for (const card of hand) {
    if (card.rank === 'A') {
      aces++;
      value += 11;
    } else if (['K', 'Q', 'J'].includes(card.rank)) {
      value += 10;
    } else {
      value += parseInt(card.rank, 10);
    }
  }

  // Convert aces from 11 to 1 as needed to avoid bust
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }

  return value;
}

/**
 * Check if a hand is a natural blackjack (2 cards totaling 21)
 */
export function isBlackjack(hand: Hand): boolean {
  return hand.length === 2 && calculateHandValue(hand) === 21;
}

/**
 * Check if a hand is soft (has an Ace counted as 11)
 */
export function isSoft(hand: Hand): boolean {
  let value = 0;
  let aces = 0;

  for (const card of hand) {
    if (card.rank === 'A') {
      aces++;
      value += 11;
    } else if (['K', 'Q', 'J'].includes(card.rank)) {
      value += 10;
    } else {
      value += parseInt(card.rank, 10);
    }
  }

  // Check if we have at least one ace still counted as 11
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }

  return aces > 0 && value <= 21;
}

// ============ DISPLAY FORMATTING ============

/**
 * Format a single card for display
 * @returns Formatted card string (e.g., "A♠")
 */
export function formatCard(card: Card): string {
  return `${card.rank}${card.suit}`;
}

/**
 * Format a hand for embed display
 * @param hideSecond - Whether to hide the second card (dealer's hole card)
 */
export function formatHand(hand: Hand, hideSecond: boolean = false): string {
  if (hideSecond && hand.length >= 2) {
    return `\`${formatCard(hand[0])}\` \`🎴\``;
  }
  return hand.map((card) => `\`${formatCard(card)}\``).join(' ');
}

/**
 * Get the visible value of dealer's hand (only first card if hideSecond)
 * @param hideSecond - Whether the second card is hidden
 */
export function getVisibleDealerValue(hand: Hand, hideSecond: boolean = false): number {
  if (hideSecond && hand.length >= 2) {
    // Only count the first card
    const card = hand[0];
    if (card.rank === 'A') return 11;
    if (['K', 'Q', 'J'].includes(card.rank)) return 10;
    return parseInt(card.rank, 10);
  }
  return calculateHandValue(hand);
}

// ============ SPLIT LOGIC ============

/**
 * Get the card value for split comparison (10 for all face cards)
 */
export function getSplitValue(card: Card): number {
  if (card.rank === 'A') return 11;
  if (['K', 'Q', 'J', '10'].includes(card.rank)) return 10;
  return parseInt(card.rank, 10);
}

/**
 * Check if a hand can be split (two cards of same split value)
 * Allows any 10-value cards to split with each other (10, J, Q, K)
 */
export function canSplit(hand: Hand): boolean {
  if (hand.length !== 2) return false;
  return getSplitValue(hand[0]) === getSplitValue(hand[1]);
}

/**
 * Check if a hand can be split with EXACT rank match only
 * Only allows identical ranks (8-8, K-K, not K-Q)
 * Used for simplified split rules
 */
export function canSplitExactMatch(hand: Hand): boolean {
  if (hand.length !== 2) return false;
  return hand[0].rank === hand[1].rank;
}

/**
 * Check if a hand is a pair of Aces (for split aces special rules)
 */
export function isPairOfAces(hand: Hand): boolean {
  if (hand.length !== 2) return false;
  return hand[0].rank === 'A' && hand[1].rank === 'A';
}

// ============ DEALER DETECTION ============

/**
 * Check if dealer's upcard is an Ace (for insurance offer)
 */
export function dealerShowsAce(dealerHand: Hand): boolean {
  return dealerHand.length >= 1 && dealerHand[0].rank === 'A';
}

/**
 * Check if dealer's upcard is a 10-value (for dealer peek)
 */
export function dealerShowsTen(dealerHand: Hand): boolean {
  if (dealerHand.length < 1) return false;
  return ['10', 'J', 'Q', 'K'].includes(dealerHand[0].rank);
}

/**
 * Check if dealer peek is needed (showing 10 or Ace)
 */
export function shouldDealerPeek(dealerHand: Hand): boolean {
  return dealerShowsAce(dealerHand) || dealerShowsTen(dealerHand);
}

// ============ INSURANCE ============

/**
 * Calculate insurance bet amount (half of original bet)
 */
export function calculateInsuranceBet(originalBet: number): number {
  return Math.floor(originalBet / 2);
}

// ============ DEALER LOGIC ============

/**
 * Determine if dealer should hit based on hand value and table rules
 * @param dealerHand - The dealer's current hand
 * @param table - Table configuration with soft 17 rule
 * @returns true if dealer should hit, false if dealer should stand
 */
export function shouldDealerHit(dealerHand: Hand, table: TableConfig): boolean {
  const value = calculateHandValue(dealerHand);

  // Always hit on < 17
  if (value < 17) return true;

  // H17 rule: hit on soft 17
  if (value === 17 && table.dealerHitsSoft17 && isSoft(dealerHand)) {
    return true;
  }

  // Stand on hard 17+ or soft 18+
  return false;
}

// ============ CARD RENDERING ============

/**
 * Render a card as its custom tile, falling back to the backticked text this used to
 * show when the emoji set has not been uploaded.
 *
 * Kept separate from formatCard, which is the plain-text contract other code and the
 * tests rely on.
 */
export function renderCard(card: Card): string {
  return emoji(cardEmojiName(card.rank, card.suit), `\`${formatCard(card)}\``);
}

/** The face-down hole card. */
export function renderCardBack(): string {
  return emoji(CARD_BACK_NAME, '`🎴`');
}

/**
 * Render a hand, optionally keeping the dealer's hole card face down.
 */
export function renderHand(hand: Hand, hideSecond: boolean = false): string {
  if (hideSecond && hand.length >= 2) {
    return `${renderCard(hand[0])} ${renderCardBack()}`;
  }
  return hand.map(renderCard).join(' ');
}

// ============ SHOE ============

/**
 * A dealing shoe that survives between hands.
 *
 * Fresh-shuffling every hand makes deck count almost meaningless, so the multi-deck
 * table now deals from a persistent shoe with a cut card. The single-deck table
 * deliberately does not: a deeply-dealt single deck is the one configuration where
 * counting gives a real edge over the house.
 */
export interface Shoe {
  cards: Deck;
  readonly deckCount: number;
  /** Share of the shoe dealt before the cut card comes out */
  readonly penetration: number;
  /** True when the most recent hand start triggered a shuffle, for the UI */
  justShuffled: boolean;
}

/** Cut card at three quarters, the usual depth for a six-deck game. */
export const SHOE_PENETRATION = 0.75;

export function createShoe(deckCount: number, penetration: number = SHOE_PENETRATION): Shoe {
  return {
    cards: createDeck(deckCount),
    deckCount,
    penetration,
    justShuffled: false,
  };
}

/** Total cards in a full shoe of this size. */
export function shoeSize(shoe: Shoe): number {
  return shoe.deckCount * 52;
}

/** Cards left in the shoe. */
export function shoeRemaining(shoe: Shoe): number {
  return shoe.cards.length;
}

/**
 * Whether the cut card has been reached.
 *
 * Measured off the cards actually left rather than a separate dealt counter, so the
 * two can never disagree.
 */
export function needsShuffle(shoe: Shoe): boolean {
  return shoe.cards.length <= shoeSize(shoe) * (1 - shoe.penetration);
}

/**
 * Reshuffle between hands. Never called mid-hand: a real table finishes the hand it
 * is dealing before the cut card takes effect.
 */
export function shuffleShoe(shoe: Shoe): void {
  shoe.cards = createDeck(shoe.deckCount);
}

/**
 * Prepare a shoe for a new hand, shuffling if the cut card has come out.
 *
 * @returns true if the shoe was shuffled, so the UI can say so
 */
export function beginHand(shoe: Shoe): boolean {
  if (needsShuffle(shoe)) {
    shuffleShoe(shoe);
    shoe.justShuffled = true;
    return true;
  }
  shoe.justShuffled = false;
  return false;
}

/**
 * Draw one card.
 *
 * Reshuffles defensively if the shoe is somehow exhausted - with a cut card at 75%
 * that should be unreachable, but running out mid-hand would otherwise deal undefined.
 */
export function drawFromShoe(shoe: Shoe): Card {
  if (shoe.cards.length === 0) {
    console.warn('[BLACKJACK] Shoe exhausted mid-hand; reshuffling');
    shuffleShoe(shoe);
  }
  return shoe.cards.pop()!;
}
