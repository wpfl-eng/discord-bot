import { describe, test, expect } from '@jest/globals';
import type { Card, Rank, Suit } from '../../discordCommands/blackjack/blackjackUtils.js';
import {
  getRankValue,
  getRankCounts,
  getSuitCounts,
  getSortedValues,
  getCountPattern,
  isFlush,
  isStraight,
  isRoyalFlush,
  isStraightFlush,
  isFourOfAKind,
  isFullHouse,
  isThreeOfAKind,
  isTwoPair,
  isPair,
  isJacksOrBetter,
  evaluateHand,
  formatVideoPokerHand,
  formatVideoPokerHandSimple,
  getHandEmoji,
} from '../../discordCommands/videopoker/videoPokerUtils.js';
import { HandRank } from '../../discordCommands/videopoker/videoPokerConfig.js';

// ============ TYPE HELPERS FOR TESTS ============

function card(rank: Rank, suit: Suit = '♠'): Card {
  return { rank, suit };
}

function hand(...cards: Card[]): Card[] {
  return cards;
}

// ============ ANALYSIS FUNCTIONS ============

describe('videoPokerUtils', () => {
  describe('getRankValue', () => {
    test('Ace is 14', () => {
      expect(getRankValue('A')).toBe(14);
    });

    test('King is 13', () => {
      expect(getRankValue('K')).toBe(13);
    });

    test('Queen is 12', () => {
      expect(getRankValue('Q')).toBe(12);
    });

    test('Jack is 11', () => {
      expect(getRankValue('J')).toBe(11);
    });

    test('Number cards are face value', () => {
      expect(getRankValue('10')).toBe(10);
      expect(getRankValue('9')).toBe(9);
      expect(getRankValue('5')).toBe(5);
      expect(getRankValue('2')).toBe(2);
    });
  });

  describe('getRankCounts', () => {
    test('counts each rank correctly', () => {
      const h = hand(card('A'), card('A'), card('K'), card('K'), card('K'));
      const counts = getRankCounts(h);
      expect(counts.get('A')).toBe(2);
      expect(counts.get('K')).toBe(3);
      expect(counts.size).toBe(2);
    });

    test('handles all different ranks', () => {
      const h = hand(card('A'), card('K'), card('Q'), card('J'), card('10'));
      const counts = getRankCounts(h);
      expect(counts.size).toBe(5);
      for (const [, count] of counts) {
        expect(count).toBe(1);
      }
    });
  });

  describe('getSuitCounts', () => {
    test('counts flush correctly', () => {
      const h = hand(
        card('A', '♥'),
        card('K', '♥'),
        card('Q', '♥'),
        card('J', '♥'),
        card('9', '♥')
      );
      const counts = getSuitCounts(h);
      expect(counts.get('♥')).toBe(5);
      expect(counts.size).toBe(1);
    });

    test('counts mixed suits', () => {
      const h = hand(
        card('A', '♠'),
        card('K', '♥'),
        card('Q', '♦'),
        card('J', '♣'),
        card('9', '♠')
      );
      const counts = getSuitCounts(h);
      expect(counts.get('♠')).toBe(2);
      expect(counts.get('♥')).toBe(1);
      expect(counts.size).toBe(4);
    });
  });

  describe('getSortedValues', () => {
    test('sorts values descending', () => {
      const h = hand(card('5'), card('A'), card('K'), card('2'), card('10'));
      const sorted = getSortedValues(h);
      expect(sorted).toEqual([14, 13, 10, 5, 2]);
    });
  });

  describe('getCountPattern', () => {
    test('returns pattern for full house', () => {
      const h = hand(card('K'), card('K'), card('K'), card('Q'), card('Q'));
      const counts = getRankCounts(h);
      const pattern = getCountPattern(counts);
      expect(pattern).toEqual([3, 2]);
    });

    test('returns pattern for two pair', () => {
      const h = hand(card('K'), card('K'), card('Q'), card('Q'), card('J'));
      const counts = getRankCounts(h);
      const pattern = getCountPattern(counts);
      expect(pattern).toEqual([2, 2, 1]);
    });
  });

  // ============ HAND DETECTION ============

  describe('isFlush', () => {
    test('returns true for 5 same suit', () => {
      const h = hand(
        card('A', '♥'),
        card('K', '♥'),
        card('Q', '♥'),
        card('J', '♥'),
        card('9', '♥')
      );
      expect(isFlush(h)).toBe(true);
    });

    test('returns false for mixed suits', () => {
      const h = hand(
        card('A', '♥'),
        card('K', '♠'),
        card('Q', '♥'),
        card('J', '♥'),
        card('9', '♥')
      );
      expect(isFlush(h)).toBe(false);
    });
  });

  describe('isStraight', () => {
    test('returns true for regular straight', () => {
      const h = hand(card('9'), card('8'), card('7'), card('6'), card('5'));
      expect(isStraight(h)).toBe(true);
    });

    test('returns true for broadway straight', () => {
      const h = hand(card('A'), card('K'), card('Q'), card('J'), card('10'));
      expect(isStraight(h)).toBe(true);
    });

    test('returns true for wheel straight (A-2-3-4-5)', () => {
      const h = hand(card('A'), card('2'), card('3'), card('4'), card('5'));
      expect(isStraight(h)).toBe(true);
    });

    test('returns false for non-consecutive', () => {
      const h = hand(card('A'), card('K'), card('Q'), card('J'), card('9'));
      expect(isStraight(h)).toBe(false);
    });

    test('returns false for wrap-around (K-A-2-3-4)', () => {
      const h = hand(card('K'), card('A'), card('2'), card('3'), card('4'));
      expect(isStraight(h)).toBe(false);
    });
  });

  describe('isRoyalFlush', () => {
    test('returns true for A-K-Q-J-10 same suit', () => {
      const h = hand(
        card('A', '♠'),
        card('K', '♠'),
        card('Q', '♠'),
        card('J', '♠'),
        card('10', '♠')
      );
      expect(isRoyalFlush(h)).toBe(true);
    });

    test('returns false for broadway different suits', () => {
      const h = hand(
        card('A', '♠'),
        card('K', '♥'),
        card('Q', '♠'),
        card('J', '♠'),
        card('10', '♠')
      );
      expect(isRoyalFlush(h)).toBe(false);
    });

    test('returns false for non-broadway flush', () => {
      const h = hand(
        card('K', '♠'),
        card('Q', '♠'),
        card('J', '♠'),
        card('10', '♠'),
        card('9', '♠')
      );
      expect(isRoyalFlush(h)).toBe(false);
    });
  });

  describe('isStraightFlush', () => {
    test('returns true for straight flush (not royal)', () => {
      const h = hand(
        card('9', '♦'),
        card('8', '♦'),
        card('7', '♦'),
        card('6', '♦'),
        card('5', '♦')
      );
      expect(isStraightFlush(h)).toBe(true);
    });

    test('returns true for wheel straight flush', () => {
      const h = hand(
        card('A', '♣'),
        card('2', '♣'),
        card('3', '♣'),
        card('4', '♣'),
        card('5', '♣')
      );
      expect(isStraightFlush(h)).toBe(true);
    });

    test('returns false for royal flush', () => {
      const h = hand(
        card('A', '♠'),
        card('K', '♠'),
        card('Q', '♠'),
        card('J', '♠'),
        card('10', '♠')
      );
      expect(isStraightFlush(h)).toBe(false);
    });

    test('returns false for straight different suits', () => {
      const h = hand(
        card('9', '♦'),
        card('8', '♠'),
        card('7', '♦'),
        card('6', '♦'),
        card('5', '♦')
      );
      expect(isStraightFlush(h)).toBe(false);
    });
  });

  describe('isFourOfAKind', () => {
    test('returns true for four of a kind', () => {
      const h = hand(card('A'), card('A', '♥'), card('A', '♦'), card('A', '♣'), card('K'));
      expect(isFourOfAKind(h)).toBe(true);
    });

    test('returns false for full house', () => {
      const h = hand(card('A'), card('A', '♥'), card('A', '♦'), card('K'), card('K', '♥'));
      expect(isFourOfAKind(h)).toBe(false);
    });
  });

  describe('isFullHouse', () => {
    test('returns true for full house', () => {
      const h = hand(card('K'), card('K', '♥'), card('K', '♦'), card('Q'), card('Q', '♥'));
      expect(isFullHouse(h)).toBe(true);
    });

    test('returns false for three of a kind', () => {
      const h = hand(card('K'), card('K', '♥'), card('K', '♦'), card('Q'), card('J'));
      expect(isFullHouse(h)).toBe(false);
    });
  });

  describe('isThreeOfAKind', () => {
    test('returns true for three of a kind', () => {
      const h = hand(card('K'), card('K', '♥'), card('K', '♦'), card('Q'), card('J'));
      expect(isThreeOfAKind(h)).toBe(true);
    });

    test('returns false for full house', () => {
      const h = hand(card('K'), card('K', '♥'), card('K', '♦'), card('Q'), card('Q', '♥'));
      expect(isThreeOfAKind(h)).toBe(false);
    });

    test('returns false for two pair', () => {
      const h = hand(card('K'), card('K', '♥'), card('Q'), card('Q', '♥'), card('J'));
      expect(isThreeOfAKind(h)).toBe(false);
    });
  });

  describe('isTwoPair', () => {
    test('returns true for two pair', () => {
      const h = hand(card('K'), card('K', '♥'), card('Q'), card('Q', '♥'), card('J'));
      expect(isTwoPair(h)).toBe(true);
    });

    test('returns false for one pair', () => {
      const h = hand(card('K'), card('K', '♥'), card('Q'), card('J'), card('10'));
      expect(isTwoPair(h)).toBe(false);
    });
  });

  describe('isPair', () => {
    test('returns true for one pair', () => {
      const h = hand(card('K'), card('K', '♥'), card('Q'), card('J'), card('10'));
      expect(isPair(h)).toBe(true);
    });

    test('returns false for two pair', () => {
      const h = hand(card('K'), card('K', '♥'), card('Q'), card('Q', '♥'), card('J'));
      expect(isPair(h)).toBe(false);
    });

    test('returns false for high card', () => {
      const h = hand(card('A'), card('K'), card('Q'), card('J'), card('9'));
      expect(isPair(h)).toBe(false);
    });
  });

  describe('isJacksOrBetter', () => {
    test('returns true for pair of Jacks', () => {
      const h = hand(card('J'), card('J', '♥'), card('5'), card('3'), card('2'));
      expect(isJacksOrBetter(h)).toBe(true);
    });

    test('returns true for pair of Queens', () => {
      const h = hand(card('Q'), card('Q', '♥'), card('5'), card('3'), card('2'));
      expect(isJacksOrBetter(h)).toBe(true);
    });

    test('returns true for pair of Kings', () => {
      const h = hand(card('K'), card('K', '♥'), card('5'), card('3'), card('2'));
      expect(isJacksOrBetter(h)).toBe(true);
    });

    test('returns true for pair of Aces', () => {
      const h = hand(card('A'), card('A', '♥'), card('5'), card('3'), card('2'));
      expect(isJacksOrBetter(h)).toBe(true);
    });

    test('returns false for pair of 10s', () => {
      const h = hand(card('10'), card('10', '♥'), card('5'), card('3'), card('2'));
      expect(isJacksOrBetter(h)).toBe(false);
    });

    test('returns false for low pair', () => {
      const h = hand(card('5'), card('5', '♥'), card('K'), card('Q'), card('J'));
      expect(isJacksOrBetter(h)).toBe(false);
    });

    test('returns false for high card only', () => {
      // Use different suits to avoid flush
      const h = hand(card('A', '♠'), card('K', '♥'), card('Q', '♦'), card('J', '♣'), card('9', '♠'));
      expect(isJacksOrBetter(h)).toBe(false);
    });
  });

  // ============ MAIN EVALUATION ============

  describe('evaluateHand', () => {
    test('throws for invalid hand size', () => {
      expect(() => evaluateHand([card('A'), card('K')])).toThrow();
      expect(() => evaluateHand([])).toThrow();
    });

    test('evaluates Royal Flush', () => {
      const h = hand(
        card('A', '♠'),
        card('K', '♠'),
        card('Q', '♠'),
        card('J', '♠'),
        card('10', '♠')
      );
      expect(evaluateHand(h)).toBe(HandRank.ROYAL_FLUSH);
    });

    test('evaluates Straight Flush', () => {
      const h = hand(
        card('9', '♦'),
        card('8', '♦'),
        card('7', '♦'),
        card('6', '♦'),
        card('5', '♦')
      );
      expect(evaluateHand(h)).toBe(HandRank.STRAIGHT_FLUSH);
    });

    test('evaluates Four of a Kind', () => {
      const h = hand(card('7'), card('7', '♥'), card('7', '♦'), card('7', '♣'), card('K'));
      expect(evaluateHand(h)).toBe(HandRank.FOUR_OF_A_KIND);
    });

    test('evaluates Full House', () => {
      const h = hand(card('K'), card('K', '♥'), card('K', '♦'), card('Q'), card('Q', '♥'));
      expect(evaluateHand(h)).toBe(HandRank.FULL_HOUSE);
    });

    test('evaluates Flush', () => {
      const h = hand(
        card('A', '♥'),
        card('J', '♥'),
        card('8', '♥'),
        card('5', '♥'),
        card('2', '♥')
      );
      expect(evaluateHand(h)).toBe(HandRank.FLUSH);
    });

    test('evaluates Straight', () => {
      const h = hand(card('9'), card('8', '♥'), card('7'), card('6', '♦'), card('5'));
      expect(evaluateHand(h)).toBe(HandRank.STRAIGHT);
    });

    test('evaluates Wheel Straight (A-2-3-4-5)', () => {
      const h = hand(card('A'), card('2', '♥'), card('3'), card('4', '♦'), card('5'));
      expect(evaluateHand(h)).toBe(HandRank.STRAIGHT);
    });

    test('evaluates Three of a Kind', () => {
      const h = hand(card('8'), card('8', '♥'), card('8', '♦'), card('K'), card('2'));
      expect(evaluateHand(h)).toBe(HandRank.THREE_OF_A_KIND);
    });

    test('evaluates Two Pair', () => {
      const h = hand(card('K'), card('K', '♥'), card('Q'), card('Q', '♥'), card('2'));
      expect(evaluateHand(h)).toBe(HandRank.TWO_PAIR);
    });

    test('evaluates Jacks or Better (pair of Jacks)', () => {
      const h = hand(card('J'), card('J', '♥'), card('8'), card('5'), card('2'));
      expect(evaluateHand(h)).toBe(HandRank.JACKS_OR_BETTER);
    });

    test('evaluates Jacks or Better (pair of Aces)', () => {
      const h = hand(card('A'), card('A', '♥'), card('8'), card('5'), card('2'));
      expect(evaluateHand(h)).toBe(HandRank.JACKS_OR_BETTER);
    });

    test('evaluates High Card for low pair', () => {
      const h = hand(card('10'), card('10', '♥'), card('8'), card('5'), card('2'));
      expect(evaluateHand(h)).toBe(HandRank.HIGH_CARD);
    });

    test('evaluates High Card for no pair', () => {
      // Use different suits to avoid flush
      const h = hand(card('A', '♠'), card('K', '♥'), card('Q', '♦'), card('J', '♣'), card('9', '♠'));
      expect(evaluateHand(h)).toBe(HandRank.HIGH_CARD);
    });
  });

  // ============ DISPLAY FUNCTIONS ============

  describe('formatVideoPokerHand', () => {
    test('formats hand with hold indicators', () => {
      const h = hand(card('A'), card('K'), card('Q'), card('J'), card('10'));
      const result = formatVideoPokerHand(h, [true, false, true, false, true]);
      expect(result).toContain('`A♠`');
      expect(result).toContain('`K♠`');
      expect(result).toContain('HOLD');
    });
  });

  describe('formatVideoPokerHandSimple', () => {
    test('formats hand without hold indicators', () => {
      const h = hand(card('A'), card('K'), card('Q'), card('J'), card('10'));
      const result = formatVideoPokerHandSimple(h);
      expect(result).toContain('`A♠`');
      expect(result).toContain('`K♠`');
      expect(result).not.toContain('HOLD');
    });
  });

  describe('getHandEmoji', () => {
    test('returns crown for royal flush', () => {
      expect(getHandEmoji(HandRank.ROYAL_FLUSH)).toBe('👑');
    });

    test('returns star for straight flush', () => {
      expect(getHandEmoji(HandRank.STRAIGHT_FLUSH)).toBe('🌟');
    });

    test('returns dash for high card', () => {
      expect(getHandEmoji(HandRank.HIGH_CARD)).toBe('💨');
    });
  });
});
