// Blackjack Card and Deck Utilities

// ============ TYPE DEFINITIONS ============

export type Suit = '♠' | '♥' | '♦' | '♣';
export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K';

export interface Card {
  readonly suit: Suit;
  readonly rank: Rank;
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
 * Creates a new shuffled 52-card deck
 */
export function createDeck(): Deck {
  const deck: Deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
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
