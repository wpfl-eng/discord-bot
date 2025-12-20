import { describe, test, expect } from '@jest/globals';
import {
  SUITS,
  RANKS,
  createDeck,
  shuffle,
  drawCard,
  calculateHandValue,
  isBlackjack,
  isSoft,
  formatCard,
  formatHand,
  getVisibleDealerValue,
  getSplitValue,
  canSplit,
  dealerShowsAce,
  dealerShowsTen,
  shouldDealerPeek,
  calculateInsuranceBet,
  Card,
  Suit,
  Rank,
} from '../../discordCommands/blackjack/blackjackUtils.js';

// ============ TYPE HELPERS FOR TESTS ============

function card(rank: Rank, suit: Suit = '♠'): Card {
  return { rank, suit };
}

// ============ CONSTANTS TESTS ============

describe('blackjackUtils', () => {
  describe('SUITS', () => {
    test('has all 4 suits', () => {
      expect(SUITS).toHaveLength(4);
      expect(SUITS).toContain('♠');
      expect(SUITS).toContain('♥');
      expect(SUITS).toContain('♦');
      expect(SUITS).toContain('♣');
    });
  });

  describe('RANKS', () => {
    test('has all 13 ranks', () => {
      expect(RANKS).toHaveLength(13);
      expect(RANKS).toContain('A');
      expect(RANKS).toContain('2');
      expect(RANKS).toContain('10');
      expect(RANKS).toContain('J');
      expect(RANKS).toContain('Q');
      expect(RANKS).toContain('K');
    });
  });

  // ============ DECK FUNCTIONS ============

  describe('createDeck', () => {
    test('returns 52 cards', () => {
      const deck = createDeck();
      expect(deck).toHaveLength(52);
    });

    test('has all 4 suits represented', () => {
      const deck = createDeck();
      const suits = new Set(deck.map((c: Card) => c.suit));
      expect(suits.size).toBe(4);
      expect(suits).toContain('♠');
      expect(suits).toContain('♥');
      expect(suits).toContain('♦');
      expect(suits).toContain('♣');
    });

    test('has all 13 ranks represented', () => {
      const deck = createDeck();
      const ranks = new Set(deck.map((c: Card) => c.rank));
      expect(ranks.size).toBe(13);
    });

    test('returns unique cards (no duplicates)', () => {
      const deck = createDeck();
      const cardStrings = deck.map((c: Card) => `${c.rank}${c.suit}`);
      const uniqueCards = new Set(cardStrings);
      expect(uniqueCards.size).toBe(52);
    });

    test('each suit has 13 cards', () => {
      const deck = createDeck();
      for (const suit of SUITS) {
        const suitCards = deck.filter((c: Card) => c.suit === suit);
        expect(suitCards).toHaveLength(13);
      }
    });
  });

  describe('shuffle', () => {
    test('returns same length array', () => {
      const original = [1, 2, 3, 4, 5];
      const result = shuffle([...original]);
      expect(result).toHaveLength(original.length);
    });

    test('contains all original elements', () => {
      const original = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const result = shuffle([...original]);
      expect(result.sort()).toEqual(original.sort());
    });

    test('returns the same array reference (in-place)', () => {
      const arr = [1, 2, 3];
      const result = shuffle(arr);
      expect(result).toBe(arr);
    });

    test('handles empty array', () => {
      const result = shuffle([]);
      expect(result).toEqual([]);
    });

    test('handles single element array', () => {
      const result = shuffle([42]);
      expect(result).toEqual([42]);
    });
  });

  describe('drawCard', () => {
    test('returns the last card in deck', () => {
      const deck = [card('A'), card('K'), card('Q')];
      const drawn = drawCard(deck);
      expect(drawn).toEqual(card('Q'));
    });

    test('removes the card from deck', () => {
      const deck = [card('A'), card('K'), card('Q')];
      drawCard(deck);
      expect(deck).toHaveLength(2);
      expect(deck).toEqual([card('A'), card('K')]);
    });

    test('returns undefined for empty deck', () => {
      const deck: Card[] = [];
      const drawn = drawCard(deck);
      expect(drawn).toBeUndefined();
    });
  });

  // ============ HAND VALUE CALCULATIONS ============

  describe('calculateHandValue', () => {
    test('counts numbered cards at face value', () => {
      expect(calculateHandValue([card('2'), card('3')])).toBe(5);
      expect(calculateHandValue([card('5'), card('7')])).toBe(12);
      expect(calculateHandValue([card('9'), card('10')])).toBe(19);
    });

    test('counts face cards (J, Q, K) as 10', () => {
      expect(calculateHandValue([card('J')])).toBe(10);
      expect(calculateHandValue([card('Q')])).toBe(10);
      expect(calculateHandValue([card('K')])).toBe(10);
      expect(calculateHandValue([card('J'), card('Q'), card('K')])).toBe(30);
    });

    test('counts ace as 11 when hand is under 21', () => {
      expect(calculateHandValue([card('A'), card('5')])).toBe(16);
      expect(calculateHandValue([card('A'), card('9')])).toBe(20);
    });

    test('counts ace as 1 when 11 would bust', () => {
      expect(calculateHandValue([card('A'), card('10'), card('5')])).toBe(16);
      expect(calculateHandValue([card('A'), card('K'), card('Q')])).toBe(21);
    });

    test('handles multiple aces correctly', () => {
      // Two aces: one must be 1, one could be 11 = 12
      expect(calculateHandValue([card('A'), card('A')])).toBe(12);
      // Three aces: two must be 1, one is 11 = 13
      expect(calculateHandValue([card('A'), card('A'), card('A')])).toBe(13);
      // A + A + 9: Both aces are 1 to avoid bust = 21
      expect(calculateHandValue([card('A'), card('A'), card('9')])).toBe(21);
    });

    test('handles empty hand', () => {
      expect(calculateHandValue([])).toBe(0);
    });

    test('calculates blackjack correctly (A + 10-value)', () => {
      expect(calculateHandValue([card('A'), card('K')])).toBe(21);
      expect(calculateHandValue([card('A'), card('10')])).toBe(21);
      expect(calculateHandValue([card('Q'), card('A')])).toBe(21);
    });

    test('handles bust scenarios', () => {
      expect(calculateHandValue([card('10'), card('K'), card('5')])).toBe(25);
      expect(calculateHandValue([card('J'), card('Q'), card('K')])).toBe(30);
    });
  });

  // ============ BLACKJACK DETECTION ============

  describe('isBlackjack', () => {
    test('returns true for Ace + 10-value card (natural 21)', () => {
      expect(isBlackjack([card('A'), card('10')])).toBe(true);
      expect(isBlackjack([card('A'), card('J')])).toBe(true);
      expect(isBlackjack([card('A'), card('Q')])).toBe(true);
      expect(isBlackjack([card('A'), card('K')])).toBe(true);
      expect(isBlackjack([card('K'), card('A')])).toBe(true);
    });

    test('returns false for 3+ cards totaling 21', () => {
      expect(isBlackjack([card('7'), card('7'), card('7')])).toBe(false);
      expect(isBlackjack([card('5'), card('6'), card('10')])).toBe(false);
    });

    test('returns false for 2 cards not totaling 21', () => {
      expect(isBlackjack([card('10'), card('9')])).toBe(false);
      expect(isBlackjack([card('A'), card('A')])).toBe(false);
    });

    test('returns false for empty hand', () => {
      expect(isBlackjack([])).toBe(false);
    });

    test('returns false for single card', () => {
      expect(isBlackjack([card('A')])).toBe(false);
    });
  });

  // ============ SOFT HAND DETECTION ============

  describe('isSoft', () => {
    test('returns true when ace is counted as 11', () => {
      expect(isSoft([card('A'), card('6')])).toBe(true); // Soft 17
      expect(isSoft([card('A'), card('7')])).toBe(true); // Soft 18
      expect(isSoft([card('A'), card('9')])).toBe(true); // Soft 20
    });

    test('returns false when all aces must be counted as 1', () => {
      expect(isSoft([card('A'), card('10'), card('5')])).toBe(false); // Hard 16
      expect(isSoft([card('A'), card('K'), card('Q')])).toBe(false); // Hard 21
    });

    test('returns false with no aces', () => {
      expect(isSoft([card('10'), card('7')])).toBe(false);
      expect(isSoft([card('K'), card('Q')])).toBe(false);
    });

    test('returns true for blackjack (has ace as 11)', () => {
      expect(isSoft([card('A'), card('K')])).toBe(true);
    });

    test('handles multiple aces with soft result', () => {
      // A + A = 12 (one is 11, one is 1) - soft
      expect(isSoft([card('A'), card('A')])).toBe(true);
    });

    test('returns false for empty hand', () => {
      expect(isSoft([])).toBe(false);
    });
  });

  // ============ CARD FORMATTING ============

  describe('formatCard', () => {
    test('formats card as rank + suit', () => {
      expect(formatCard(card('A', '♠'))).toBe('A♠');
      expect(formatCard(card('K', '♥'))).toBe('K♥');
      expect(formatCard(card('10', '♦'))).toBe('10♦');
      expect(formatCard(card('2', '♣'))).toBe('2♣');
    });
  });

  describe('formatHand', () => {
    test('formats all cards with backticks', () => {
      const hand = [card('A', '♠'), card('K', '♥')];
      const result = formatHand(hand);
      expect(result).toBe('`A♠` `K♥`');
    });

    test('hides second card when hideSecond is true', () => {
      const hand = [card('A', '♠'), card('K', '♥')];
      const result = formatHand(hand, true);
      expect(result).toBe('`A♠` `🎴`');
    });

    test('shows all cards when hideSecond is false', () => {
      const hand = [card('A', '♠'), card('K', '♥'), card('5', '♦')];
      const result = formatHand(hand, false);
      expect(result).toBe('`A♠` `K♥` `5♦`');
    });

    test('handles single card hand', () => {
      const hand = [card('A', '♠')];
      expect(formatHand(hand)).toBe('`A♠`');
      expect(formatHand(hand, true)).toBe('`A♠`');
    });

    test('handles empty hand', () => {
      expect(formatHand([])).toBe('');
    });
  });

  // ============ DEALER VALUE ============

  describe('getVisibleDealerValue', () => {
    test('returns full hand value when hideSecond is false', () => {
      const hand = [card('A'), card('K')];
      expect(getVisibleDealerValue(hand, false)).toBe(21);
    });

    test('returns only first card value when hideSecond is true', () => {
      const hand = [card('7'), card('K')];
      expect(getVisibleDealerValue(hand, true)).toBe(7);
    });

    test('handles ace as first card (visible as 11)', () => {
      const hand = [card('A'), card('K')];
      expect(getVisibleDealerValue(hand, true)).toBe(11);
    });

    test('handles face card as first card (visible as 10)', () => {
      const hand = [card('K'), card('7')];
      expect(getVisibleDealerValue(hand, true)).toBe(10);
      expect(getVisibleDealerValue([card('Q'), card('5')], true)).toBe(10);
      expect(getVisibleDealerValue([card('J'), card('3')], true)).toBe(10);
    });

    test('defaults hideSecond to false', () => {
      const hand = [card('5'), card('10')];
      expect(getVisibleDealerValue(hand)).toBe(15);
    });
  });

  // ============ SPLIT LOGIC ============

  describe('getSplitValue', () => {
    test('returns 11 for ace', () => {
      expect(getSplitValue(card('A'))).toBe(11);
    });

    test('returns 10 for all face cards and 10', () => {
      expect(getSplitValue(card('10'))).toBe(10);
      expect(getSplitValue(card('J'))).toBe(10);
      expect(getSplitValue(card('Q'))).toBe(10);
      expect(getSplitValue(card('K'))).toBe(10);
    });

    test('returns face value for number cards', () => {
      expect(getSplitValue(card('2'))).toBe(2);
      expect(getSplitValue(card('5'))).toBe(5);
      expect(getSplitValue(card('9'))).toBe(9);
    });
  });

  describe('canSplit', () => {
    test('returns true for matching ranks', () => {
      expect(canSplit([card('8', '♠'), card('8', '♥')])).toBe(true);
      expect(canSplit([card('A', '♠'), card('A', '♣')])).toBe(true);
    });

    test('returns true for any 10-value cards together', () => {
      expect(canSplit([card('10'), card('J')])).toBe(true);
      expect(canSplit([card('Q'), card('K')])).toBe(true);
      expect(canSplit([card('J'), card('Q')])).toBe(true);
      expect(canSplit([card('K'), card('10')])).toBe(true);
    });

    test('returns false for non-pairs', () => {
      expect(canSplit([card('7'), card('8')])).toBe(false);
      expect(canSplit([card('A'), card('K')])).toBe(false);
    });

    test('returns false for 3+ cards', () => {
      expect(canSplit([card('8'), card('8'), card('8')])).toBe(false);
    });

    test('returns false for single card', () => {
      expect(canSplit([card('8')])).toBe(false);
    });

    test('returns false for empty hand', () => {
      expect(canSplit([])).toBe(false);
    });
  });

  // ============ DEALER DETECTION ============

  describe('dealerShowsAce', () => {
    test('returns true when first card is ace', () => {
      expect(dealerShowsAce([card('A'), card('K')])).toBe(true);
    });

    test('returns false when first card is not ace', () => {
      expect(dealerShowsAce([card('K'), card('A')])).toBe(false);
      expect(dealerShowsAce([card('10'), card('7')])).toBe(false);
    });

    test('returns false for empty hand', () => {
      expect(dealerShowsAce([])).toBe(false);
    });
  });

  describe('dealerShowsTen', () => {
    test('returns true for 10, J, Q, K as first card', () => {
      expect(dealerShowsTen([card('10'), card('7')])).toBe(true);
      expect(dealerShowsTen([card('J'), card('5')])).toBe(true);
      expect(dealerShowsTen([card('Q'), card('3')])).toBe(true);
      expect(dealerShowsTen([card('K'), card('2')])).toBe(true);
    });

    test('returns false for non-10-value first card', () => {
      expect(dealerShowsTen([card('A'), card('K')])).toBe(false);
      expect(dealerShowsTen([card('9'), card('10')])).toBe(false);
    });

    test('returns false for empty hand', () => {
      expect(dealerShowsTen([])).toBe(false);
    });
  });

  describe('shouldDealerPeek', () => {
    test('returns true when dealer shows ace', () => {
      expect(shouldDealerPeek([card('A'), card('7')])).toBe(true);
    });

    test('returns true when dealer shows 10-value', () => {
      expect(shouldDealerPeek([card('10'), card('7')])).toBe(true);
      expect(shouldDealerPeek([card('K'), card('5')])).toBe(true);
    });

    test('returns false for other upcards', () => {
      expect(shouldDealerPeek([card('9'), card('7')])).toBe(false);
      expect(shouldDealerPeek([card('5'), card('K')])).toBe(false);
    });

    test('returns false for empty hand', () => {
      expect(shouldDealerPeek([])).toBe(false);
    });
  });

  // ============ INSURANCE ============

  describe('calculateInsuranceBet', () => {
    test('returns half of original bet (floored)', () => {
      expect(calculateInsuranceBet(100)).toBe(50);
      expect(calculateInsuranceBet(200)).toBe(100);
    });

    test('floors odd numbers', () => {
      expect(calculateInsuranceBet(101)).toBe(50);
      expect(calculateInsuranceBet(99)).toBe(49);
    });

    test('handles zero', () => {
      expect(calculateInsuranceBet(0)).toBe(0);
    });

    test('handles small amounts', () => {
      expect(calculateInsuranceBet(1)).toBe(0);
      expect(calculateInsuranceBet(2)).toBe(1);
      expect(calculateInsuranceBet(3)).toBe(1);
    });
  });
});
