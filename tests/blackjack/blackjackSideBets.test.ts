import { describe, test, expect } from '@jest/globals';
import {
  PERFECT_PAIRS_PAYOUT,
  TWENTY_ONE_PLUS_THREE_PAYOUT,
  gradePerfectPairs,
  gradeTwentyOnePlusThree,
  resolvePerfectPairs,
  resolveTwentyOnePlusThree,
} from '../../discordCommands/blackjack/blackjackSideBets.js';
import { RANKS, SUITS, type Card, type Rank, type Suit } from '../../discordCommands/blackjack/blackjackUtils.js';

const c = (rank: Rank, suit: Suit): Card => ({ rank, suit });

// ============ PERFECT PAIRS ============

describe('perfect pairs grading', () => {
  test('same rank and suit is a perfect pair', () => {
    // Only reachable with more than one deck, which the six-deck shoe provides.
    expect(gradePerfectPairs([c('8', '♠'), c('8', '♠')])).toBe('perfect');
  });

  test('same rank and colour but different suit is a coloured pair', () => {
    expect(gradePerfectPairs([c('8', '♠'), c('8', '♣')])).toBe('colored');
    expect(gradePerfectPairs([c('8', '♥'), c('8', '♦')])).toBe('colored');
  });

  test('same rank across colours is a mixed pair', () => {
    expect(gradePerfectPairs([c('8', '♠'), c('8', '♥')])).toBe('mixed');
    expect(gradePerfectPairs([c('K', '♦'), c('K', '♣')])).toBe('mixed');
  });

  // Face cards share a blackjack VALUE but are not the same rank, so they are not a pair
  // for this bet even though they can be split at some tables.
  test('two different ten-value cards are not a pair', () => {
    expect(gradePerfectPairs([c('K', '♠'), c('Q', '♠')])).toBeNull();
    expect(gradePerfectPairs([c('10', '♠'), c('J', '♠')])).toBeNull();
  });

  test('needs two cards', () => {
    expect(gradePerfectPairs([c('8', '♠')])).toBeNull();
    expect(gradePerfectPairs([])).toBeNull();
  });
});

describe('perfect pairs payouts', () => {
  test.each([
    ['perfect', [c('8', '♠'), c('8', '♠')], 25],
    ['colored', [c('8', '♠'), c('8', '♣')], 12],
    ['mixed', [c('8', '♠'), c('8', '♥')], 6],
  ])('a %s pair returns stake plus %i x stake', (_tier, cards, multiplier) => {
    const result = resolvePerfectPairs(100, cards as Card[]);
    expect(result.payout).toBe(100 + 100 * (multiplier as number));
    expect(result.net).toBe(100 * (multiplier as number));
  });

  test('no pair loses the stake', () => {
    const result = resolvePerfectPairs(100, [c('8', '♠'), c('9', '♠')]);
    expect(result.payout).toBe(0);
    expect(result.net).toBe(-100);
    expect(result.tier).toBeNull();
  });

  test('a seat that did not take the bet neither wins nor loses', () => {
    const result = resolvePerfectPairs(0, [c('8', '♠'), c('8', '♠')]);
    expect(result.payout).toBe(0);
    expect(result.net).toBe(0);
  });

  test('the paytable descends by rarity', () => {
    expect(PERFECT_PAIRS_PAYOUT.perfect).toBeGreaterThan(PERFECT_PAIRS_PAYOUT.colored);
    expect(PERFECT_PAIRS_PAYOUT.colored).toBeGreaterThan(PERFECT_PAIRS_PAYOUT.mixed);
  });
});

// ============ 21+3 ============

describe('21+3 grading', () => {
  test('three of the same rank and suit is suited trips', () => {
    expect(gradeTwentyOnePlusThree([c('7', '♠'), c('7', '♠')], c('7', '♠'))).toBe(
      'suited_trips'
    );
  });

  test('three suited in sequence is a straight flush', () => {
    expect(gradeTwentyOnePlusThree([c('5', '♥'), c('6', '♥')], c('7', '♥'))).toBe(
      'straight_flush'
    );
  });

  test('three of the same rank across suits is trips', () => {
    expect(gradeTwentyOnePlusThree([c('7', '♠'), c('7', '♥')], c('7', '♦'))).toBe('trips');
  });

  test('three in sequence across suits is a straight', () => {
    expect(gradeTwentyOnePlusThree([c('5', '♥'), c('6', '♠')], c('7', '♦'))).toBe('straight');
  });

  test('three of one suit out of sequence is a flush', () => {
    expect(gradeTwentyOnePlusThree([c('2', '♣'), c('9', '♣')], c('K', '♣'))).toBe('flush');
  });

  test('three unrelated cards make nothing', () => {
    expect(gradeTwentyOnePlusThree([c('2', '♣'), c('9', '♥')], c('K', '♦'))).toBeNull();
  });

  // The ace plays at both ends of the deck, which is standard wherever this bet is
  // offered.
  test('the ace is low in A-2-3', () => {
    expect(gradeTwentyOnePlusThree([c('A', '♠'), c('2', '♥')], c('3', '♦'))).toBe('straight');
  });

  test('the ace is high in Q-K-A', () => {
    expect(gradeTwentyOnePlusThree([c('Q', '♠'), c('K', '♥')], c('A', '♦'))).toBe('straight');
  });

  test('K-A-2 is not a straight - the run does not wrap twice', () => {
    expect(gradeTwentyOnePlusThree([c('K', '♠'), c('A', '♥')], c('2', '♦'))).toBeNull();
  });

  test('order of the three cards never matters', () => {
    expect(gradeTwentyOnePlusThree([c('7', '♥'), c('5', '♥')], c('6', '♥'))).toBe(
      'straight_flush'
    );
    expect(gradeTwentyOnePlusThree([c('6', '♥'), c('7', '♥')], c('5', '♥'))).toBe(
      'straight_flush'
    );
  });

  test('needs a dealer upcard', () => {
    expect(gradeTwentyOnePlusThree([c('7', '♠'), c('7', '♠')], undefined)).toBeNull();
  });
});

describe('21+3 payouts', () => {
  test.each([
    ['suited trips', [c('7', '♠'), c('7', '♠')], c('7', '♠'), 100],
    ['straight flush', [c('5', '♥'), c('6', '♥')], c('7', '♥'), 40],
    ['trips', [c('7', '♠'), c('7', '♥')], c('7', '♦'), 30],
    ['straight', [c('5', '♥'), c('6', '♠')], c('7', '♦'), 10],
    ['flush', [c('2', '♣'), c('9', '♣')], c('K', '♣'), 5],
  ])('%s returns stake plus %i x stake', (_label, cards, upcard, multiplier) => {
    const result = resolveTwentyOnePlusThree(100, cards as Card[], upcard as Card);
    expect(result.payout).toBe(100 + 100 * (multiplier as number));
    expect(result.net).toBe(100 * (multiplier as number));
  });

  test('nothing loses the stake', () => {
    const result = resolveTwentyOnePlusThree(100, [c('2', '♣'), c('9', '♥')], c('K', '♦'));
    expect(result.payout).toBe(0);
    expect(result.net).toBe(-100);
  });

  test('the paytable descends by rarity', () => {
    const p = TWENTY_ONE_PLUS_THREE_PAYOUT;
    expect(p.suited_trips).toBeGreaterThan(p.straight_flush);
    expect(p.straight_flush).toBeGreaterThan(p.trips);
    expect(p.trips).toBeGreaterThan(p.straight);
    expect(p.straight).toBeGreaterThan(p.flush);
  });
});

// ============ EXHAUSTIVE CONSISTENCY ============

describe('grading is total and consistent', () => {
  // Sweep a real slice of the space rather than trusting the hand-picked cases: every
  // graded tier must be reachable and nothing may throw.
  test('every rank pairs with itself at all three tiers', () => {
    for (const rank of RANKS) {
      expect(gradePerfectPairs([c(rank, '♠'), c(rank, '♠')])).toBe('perfect');
      expect(gradePerfectPairs([c(rank, '♠'), c(rank, '♣')])).toBe('colored');
      expect(gradePerfectPairs([c(rank, '♠'), c(rank, '♥')])).toBe('mixed');
    }
  });

  test('a suited run of three is always a straight flush, at every position', () => {
    for (let i = 0; i + 2 < RANKS.length; i++) {
      const run = [RANKS[i], RANKS[i + 1], RANKS[i + 2]];
      for (const suit of SUITS) {
        expect(gradeTwentyOnePlusThree([c(run[0], suit), c(run[1], suit)], c(run[2], suit))).toBe(
          'straight_flush'
        );
      }
    }
  });

  test('trips of every rank grade as trips', () => {
    for (const rank of RANKS) {
      expect(gradeTwentyOnePlusThree([c(rank, '♠'), c(rank, '♥')], c(rank, '♦'))).toBe('trips');
    }
  });
});
