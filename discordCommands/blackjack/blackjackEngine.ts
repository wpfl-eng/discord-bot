// Blackjack Rules Engine
//
// Pure functions only: no Discord, no database, no state. Everything that decides an
// outcome or a payout lives here so it can be tested directly.
//
// The hand model is an array rather than the previous main-plus-split pair, because
// re-splitting produces up to four hands and each carries its own bet, doubled flag
// and status.

import {
  calculateHandValue,
  canSplitExactMatch,
  isBlackjack,
  isPairOfAces,
  shouldDealerHit,
  drawFromShoe,
  type Hand,
  type Shoe,
  type TableConfig,
} from './blackjackUtils.js';

// ============ TYPES ============

export type HandStatus = 'playing' | 'stood' | 'busted' | 'surrendered';

export interface PlayerHand {
  cards: Hand;
  /** This hand's own stake, doubled included */
  bet: number;
  doubled: boolean;
  status: HandStatus;
  /** Split hands cannot make a natural blackjack */
  fromSplit: boolean;
  /** Split aces receive one card and stand automatically */
  fromSplitAces: boolean;
}

export type HandOutcome = 'blackjack' | 'win' | 'push' | 'loss' | 'surrender';

export interface HandResult {
  readonly outcome: HandOutcome;
  /** Total returned to the wallet: stake plus profit, or 0 on a loss */
  readonly payout: number;
  /** Payout minus the stake */
  readonly net: number;
  readonly isBust: boolean;
}

// ============ CONSTANTS ============

/**
 * Four hands, meaning three splits - the standard casino allowance.
 */
export const MAX_HANDS = 4;

// ============ HAND CONSTRUCTION ============

export function newHand(cards: Hand, bet: number, fromSplit: boolean = false): PlayerHand {
  return {
    cards,
    bet,
    doubled: false,
    status: 'playing',
    fromSplit,
    fromSplitAces: false,
  };
}

// ============ AVAILABLE ACTIONS ============

/**
 * Whether this hand can be split again.
 *
 * Exact rank match only, so K-Q cannot be split - unchanged from before. Split aces
 * are frozen after their one card, and the table caps at MAX_HANDS.
 */
export function canSplitHand(hand: PlayerHand, handCount: number): boolean {
  if (hand.status !== 'playing') return false;
  if (hand.cards.length !== 2) return false;
  if (hand.fromSplitAces) return false;
  if (handCount >= MAX_HANDS) return false;
  return canSplitExactMatch(hand.cards);
}

/** Doubling is only allowed on the opening two cards of a hand. */
export function canDoubleHand(hand: PlayerHand): boolean {
  return hand.status === 'playing' && hand.cards.length === 2 && !hand.fromSplitAces;
}

/**
 * Surrender is only offered on the opening hand, before any other action - late
 * surrender, taken after the dealer has peeked.
 */
export function canSurrenderHand(hand: PlayerHand, handCount: number): boolean {
  return (
    handCount === 1 &&
    hand.status === 'playing' &&
    hand.cards.length === 2 &&
    !hand.fromSplit &&
    !hand.doubled
  );
}

/** A natural pays 3:2 and cannot happen on a hand produced by a split. */
export function isNatural(hand: PlayerHand): boolean {
  return !hand.fromSplit && isBlackjack(hand.cards);
}

// ============ PLAY ============

/**
 * Deal one card to a hand and update its status.
 *
 * Reaching 21 stands automatically - there is never a reason to hit a 21, and the
 * prompt would only invite a misclick.
 */
export function hitHand(hand: PlayerHand, shoe: Shoe): void {
  hand.cards.push(drawFromShoe(shoe));

  const value: number = calculateHandValue(hand.cards);
  if (value > 21) hand.status = 'busted';
  else if (value === 21) hand.status = 'stood';
}

/**
 * Double the stake, take exactly one card, and stand.
 *
 * The caller is responsible for taking the extra stake from the wallet first.
 */
export function doubleHand(hand: PlayerHand, shoe: Shoe, extraBet: number): void {
  hand.bet += extraBet;
  hand.doubled = true;
  hand.cards.push(drawFromShoe(shoe));

  hand.status = calculateHandValue(hand.cards) > 21 ? 'busted' : 'stood';
}

/**
 * Split a hand into two, dealing one fresh card to each.
 *
 * Aces are a special case everywhere: each gets exactly one card and both stand, so a
 * pair of aces cannot be turned into a series of drawn hands.
 *
 * @returns the newly created hand, to be inserted directly after the original
 */
export function splitHand(hand: PlayerHand, shoe: Shoe, extraBet: number): PlayerHand {
  const wasAces: boolean = isPairOfAces(hand.cards);
  const movedCard = hand.cards.pop()!;

  const created: PlayerHand = {
    cards: [movedCard],
    bet: extraBet,
    doubled: false,
    status: 'playing',
    fromSplit: true,
    fromSplitAces: wasAces,
  };

  hand.fromSplit = true;
  hand.fromSplitAces = wasAces;

  hand.cards.push(drawFromShoe(shoe));
  created.cards.push(drawFromShoe(shoe));

  if (wasAces) {
    hand.status = calculateHandValue(hand.cards) > 21 ? 'busted' : 'stood';
    created.status = calculateHandValue(created.cards) > 21 ? 'busted' : 'stood';
  } else {
    // A split hand that lands on 21 stands, but it is 21 - not a natural.
    if (calculateHandValue(hand.cards) === 21) hand.status = 'stood';
    if (calculateHandValue(created.cards) === 21) created.status = 'stood';
  }

  return created;
}

/**
 * Index of the next hand still waiting to be played, or -1 when the player is done.
 */
export function nextPlayableHand(hands: readonly PlayerHand[], from: number = 0): number {
  for (let i = from; i < hands.length; i++) {
    if (hands[i].status === 'playing') return i;
  }
  return -1;
}

/**
 * Whether the dealer needs to play at all.
 *
 * If every hand busted or surrendered there is nothing left to beat, so the dealer
 * does not draw - which also means the hole card is never revealed unnecessarily.
 */
export function dealerMustPlay(hands: readonly PlayerHand[]): boolean {
  return hands.some((h) => h.status === 'stood');
}

/** Draw for the dealer until the table's standing rule is met. */
export function playDealerTurn(dealerHand: Hand, shoe: Shoe, table: TableConfig): void {
  while (shouldDealerHit(dealerHand, table)) {
    dealerHand.push(drawFromShoe(shoe));
  }
}

// ============ RESOLUTION ============

export interface ResolveOptions {
  /** Player took the guaranteed 1:1 instead of risking the 3:2 */
  readonly evenMoney?: boolean;
}

/**
 * Settle one hand against the dealer.
 *
 * Payout is the total returned to the wallet - the stake is already gone, having been
 * taken when the hand was dealt, so a push returns the stake and a win returns twice it.
 */
export function resolveHand(
  hand: PlayerHand,
  dealerHand: Hand,
  options: ResolveOptions = {}
): HandResult {
  const bet: number = hand.bet;

  if (hand.status === 'surrendered') {
    const payout: number = Math.floor(bet / 2);
    return { outcome: 'surrender', payout, net: payout - bet, isBust: false };
  }

  if (hand.status === 'busted') {
    return { outcome: 'loss', payout: 0, net: -bet, isBust: true };
  }

  const playerValue: number = calculateHandValue(hand.cards);
  const dealerValue: number = calculateHandValue(dealerHand);
  const playerNatural: boolean = isNatural(hand);
  const dealerNatural: boolean = isBlackjack(dealerHand);

  // Even money settles before the hole card matters at all: a guaranteed 1:1.
  if (playerNatural && options.evenMoney) {
    return { outcome: 'win', payout: bet * 2, net: bet, isBust: false };
  }

  if (playerNatural && dealerNatural) {
    return { outcome: 'push', payout: bet, net: 0, isBust: false };
  }

  if (playerNatural) {
    // 3:2. Floor so a stake with an odd half never pays a fraction of a coin.
    const payout: number = Math.floor(bet * 2.5);
    return { outcome: 'blackjack', payout, net: payout - bet, isBust: false };
  }

  if (dealerNatural) {
    return { outcome: 'loss', payout: 0, net: -bet, isBust: false };
  }

  if (dealerValue > 21) {
    return { outcome: 'win', payout: bet * 2, net: bet, isBust: false };
  }

  if (playerValue > dealerValue) {
    return { outcome: 'win', payout: bet * 2, net: bet, isBust: false };
  }
  if (playerValue < dealerValue) {
    return { outcome: 'loss', payout: 0, net: -bet, isBust: false };
  }
  return { outcome: 'push', payout: bet, net: 0, isBust: false };
}

/**
 * Insurance settles independently of the hands: a side bet on the hole card.
 *
 * @returns total returned, being the 2:1 win plus the stake back, or 0
 */
export function resolveInsurance(insuranceBet: number, dealerHand: Hand): number {
  if (insuranceBet <= 0) return 0;
  return isBlackjack(dealerHand) ? insuranceBet * 3 : 0;
}

/** Total staked across every hand, doubles included. */
export function totalStaked(hands: readonly PlayerHand[], insuranceBet: number = 0): number {
  return hands.reduce((sum, h) => sum + h.bet, 0) + insuranceBet;
}
