// Blackjack Card and Deck Utilities

export const SUITS = ["♠", "♥", "♦", "♣"];
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];

/**
 * Creates a new shuffled 52-card deck
 * @returns {Array<{suit: string, rank: string}>} Shuffled deck
 */
export function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ suit, rank });
    }
  }
  return shuffle(deck);
}

/**
 * Fisher-Yates shuffle algorithm
 * @param {Array} deck - Deck to shuffle
 * @returns {Array} Shuffled deck (in place)
 */
export function shuffle(deck) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

/**
 * Draw a card from the deck
 * @param {Array} deck - The deck to draw from
 * @returns {{suit: string, rank: string}} The drawn card
 */
export function drawCard(deck) {
  return deck.pop();
}

/**
 * Calculate the value of a blackjack hand
 * Handles soft hands (Ace = 11 or 1)
 * @param {Array<{suit: string, rank: string}>} hand - The hand to evaluate
 * @returns {number} The hand value
 */
export function calculateHandValue(hand) {
  let value = 0;
  let aces = 0;

  for (const card of hand) {
    if (card.rank === "A") {
      aces++;
      value += 11;
    } else if (["K", "Q", "J"].includes(card.rank)) {
      value += 10;
    } else {
      value += parseInt(card.rank);
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
 * @param {Array<{suit: string, rank: string}>} hand - The hand to check
 * @returns {boolean} True if natural blackjack
 */
export function isBlackjack(hand) {
  return hand.length === 2 && calculateHandValue(hand) === 21;
}

/**
 * Check if a hand is soft (has an Ace counted as 11)
 * @param {Array<{suit: string, rank: string}>} hand - The hand to check
 * @returns {boolean} True if hand is soft
 */
export function isSoft(hand) {
  let value = 0;
  let aces = 0;

  for (const card of hand) {
    if (card.rank === "A") {
      aces++;
      value += 11;
    } else if (["K", "Q", "J"].includes(card.rank)) {
      value += 10;
    } else {
      value += parseInt(card.rank);
    }
  }

  // Check if we have at least one ace still counted as 11
  while (value > 21 && aces > 0) {
    value -= 10;
    aces--;
  }

  return aces > 0 && value <= 21;
}

/**
 * Format a single card for display
 * @param {{suit: string, rank: string}} card - The card to format
 * @returns {string} Formatted card string (e.g., "A♠")
 */
export function formatCard(card) {
  return `${card.rank}${card.suit}`;
}

/**
 * Format a hand for embed display
 * @param {Array<{suit: string, rank: string}>} hand - The hand to format
 * @param {boolean} hideSecond - Whether to hide the second card (dealer's hole card)
 * @returns {string} Formatted hand string
 */
export function formatHand(hand, hideSecond = false) {
  if (hideSecond && hand.length >= 2) {
    return `\`${formatCard(hand[0])}\` \`🎴\``;
  }
  return hand.map((card) => `\`${formatCard(card)}\``).join(" ");
}

/**
 * Get the visible value of dealer's hand (only first card if hideSecond)
 * @param {Array<{suit: string, rank: string}>} hand - The dealer's hand
 * @param {boolean} hideSecond - Whether the second card is hidden
 * @returns {number} Visible hand value
 */
export function getVisibleDealerValue(hand, hideSecond = false) {
  if (hideSecond && hand.length >= 2) {
    // Only count the first card
    const card = hand[0];
    if (card.rank === "A") return 11;
    if (["K", "Q", "J"].includes(card.rank)) return 10;
    return parseInt(card.rank);
  }
  return calculateHandValue(hand);
}

/**
 * Get the card value for split comparison (10 for all face cards)
 * @param {{suit: string, rank: string}} card - The card to get split value for
 * @returns {number} Card value for split comparison
 */
export function getSplitValue(card) {
  if (card.rank === "A") return 11;
  if (["K", "Q", "J", "10"].includes(card.rank)) return 10;
  return parseInt(card.rank);
}

/**
 * Check if a hand can be split (two cards of same split value)
 * Allows any 10-value cards to split with each other (10, J, Q, K)
 * @param {Array<{suit: string, rank: string}>} hand - The hand to check
 * @returns {boolean} True if hand can be split
 */
export function canSplit(hand) {
  if (hand.length !== 2) return false;
  return getSplitValue(hand[0]) === getSplitValue(hand[1]);
}

/**
 * Check if dealer's upcard is an Ace (for insurance offer)
 * @param {Array<{suit: string, rank: string}>} dealerHand - The dealer's hand
 * @returns {boolean} True if dealer shows an Ace
 */
export function dealerShowsAce(dealerHand) {
  return dealerHand.length >= 1 && dealerHand[0].rank === "A";
}

/**
 * Check if dealer's upcard is a 10-value (for dealer peek)
 * @param {Array<{suit: string, rank: string}>} dealerHand - The dealer's hand
 * @returns {boolean} True if dealer shows 10, J, Q, or K
 */
export function dealerShowsTen(dealerHand) {
  if (dealerHand.length < 1) return false;
  return ["10", "J", "Q", "K"].includes(dealerHand[0].rank);
}

/**
 * Check if dealer peek is needed (showing 10 or Ace)
 * @param {Array<{suit: string, rank: string}>} dealerHand - The dealer's hand
 * @returns {boolean} True if dealer peek should happen
 */
export function shouldDealerPeek(dealerHand) {
  return dealerShowsAce(dealerHand) || dealerShowsTen(dealerHand);
}

/**
 * Calculate insurance bet amount (half of original bet)
 * @param {number} originalBet - The original bet amount
 * @returns {number} Insurance bet amount
 */
export function calculateInsuranceBet(originalBet) {
  return Math.floor(originalBet / 2);
}
