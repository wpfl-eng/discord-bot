import { describe, test, expect } from '@jest/globals';
import {
  BET_TYPES,
  WHEEL_POSITIONS,
  RED_NUMBERS,
  BLACK_NUMBERS,
  ALL_BET_TYPES,
  OUTSIDE_BET_TYPES,
  getColor,
  type RouletteColor,
} from '../../discordCommands/roulette/rouletteConfig.js';

/**
 * These guard the money. A bet type that matches a pocket it should not pays 35:1 on a
 * losing spin; one that fails to match a pocket it should silently keeps a winner's
 * stake. Both are exercised here against every pocket on the wheel.
 */
describe('roulette wheel', () => {
  test('has all 38 American pockets exactly once', () => {
    expect(WHEEL_POSITIONS).toHaveLength(38);
    expect(new Set(WHEEL_POSITIONS).size).toBe(38);
    expect(WHEEL_POSITIONS).toContain('0');
    expect(WHEEL_POSITIONS).toContain('00');
    for (let n = 1; n <= 36; n++) {
      expect(WHEEL_POSITIONS).toContain(String(n));
    }
  });

  test('red and black partition 1-36 with no overlap', () => {
    expect(RED_NUMBERS).toHaveLength(18);
    expect(BLACK_NUMBERS).toHaveLength(18);

    const overlap = RED_NUMBERS.filter((n) => BLACK_NUMBERS.includes(n));
    expect(overlap).toEqual([]);

    const combined = [...RED_NUMBERS, ...BLACK_NUMBERS].sort((a, b) => a - b);
    expect(combined).toEqual(Array.from({ length: 36 }, (_, i) => i + 1));
  });

  test('only the zeroes are green', () => {
    const greens = WHEEL_POSITIONS.filter((p) => getColor(p) === 'green');
    expect(greens.sort()).toEqual(['0', '00']);
  });
});

describe('bet type resolution', () => {
  /** Resolve which bet names win on a given pocket. */
  function winnersFor(position: string): string[] {
    const color: RouletteColor = getColor(position);
    return Object.keys(BET_TYPES).filter((name) => BET_TYPES[name].matches(position, color));
  }

  test('every autocomplete option is a real bet type', () => {
    for (const name of ALL_BET_TYPES) {
      expect(BET_TYPES[name]).toBeDefined();
    }
  });

  test('exactly one straight-up bet wins on each pocket', () => {
    for (const position of WHEEL_POSITIONS) {
      const straightWinners = winnersFor(position).filter((n) => WHEEL_POSITIONS.includes(n));
      expect(straightWinners).toEqual([position]);
    }
  });

  // The green pockets are the entire house edge. If any even-money or 2:1 bet were to
  // pay on 0 or 00 the game would be better than break-even for the player.
  //
  // OUTSIDE_BET_TYPES is used rather than "everything that is not a pocket": since the
  // inside bets were generated, splits and the basket are also not pockets, and some of
  // them cover green quite legitimately.
  test.each(['0', '00'])('no outside bet wins on %s', (position) => {
    for (const name of OUTSIDE_BET_TYPES) {
      expect(BET_TYPES[name].matches(position, getColor(position))).toBe(false);
    }
  });

  // The complement: the inside bets that are SUPPOSED to reach green must actually do
  // so, or a player betting the basket would never be paid.
  test.each([
    ['basket', '0'],
    ['basket', '00'],
    ['split-0-00', '0'],
    ['split-0-00', '00'],
    ['split-0-1', '0'],
    ['split-00-3', '00'],
  ])('%s covers %s', (betType, position) => {
    expect(BET_TYPES[betType].matches(position, getColor(position))).toBe(true);
  });

  test('the only bets reaching green are straight ups, zero splits and the basket', () => {
    for (const position of ['0', '00']) {
      const winners = ALL_BET_TYPES.filter((name) =>
        BET_TYPES[name].matches(position, getColor(position))
      );
      for (const name of winners) {
        const allowed: boolean =
          name === position || name === 'basket' || name.startsWith('split-0');
        expect(allowed).toBe(true);
      }
    }
  });

  test('red and black are mutually exclusive and cover every numbered pocket', () => {
    for (let n = 1; n <= 36; n++) {
      const position = String(n);
      const color = getColor(position);
      const red = BET_TYPES.red.matches(position, color);
      const black = BET_TYPES.black.matches(position, color);
      expect(red).not.toBe(black);
    }
  });

  test('odd and even are mutually exclusive and correct', () => {
    for (let n = 1; n <= 36; n++) {
      const position = String(n);
      const color = getColor(position);
      expect(BET_TYPES.odd.matches(position, color)).toBe(n % 2 === 1);
      expect(BET_TYPES.even.matches(position, color)).toBe(n % 2 === 0);
    }
  });

  test('low and high split at 18/19', () => {
    for (let n = 1; n <= 36; n++) {
      const position = String(n);
      const color = getColor(position);
      expect(BET_TYPES.low.matches(position, color)).toBe(n <= 18);
      expect(BET_TYPES.high.matches(position, color)).toBe(n >= 19);
    }
  });

  test('dozens partition 1-36 into three blocks of twelve', () => {
    const dozens = ['first-dozen', 'second-dozen', 'third-dozen'] as const;
    const counts: Record<string, number> = {
      'first-dozen': 0,
      'second-dozen': 0,
      'third-dozen': 0,
    };

    for (let n = 1; n <= 36; n++) {
      const position = String(n);
      const color = getColor(position);
      const hits = dozens.filter((d) => BET_TYPES[d].matches(position, color));
      expect(hits).toHaveLength(1);
      counts[hits[0]]++;
    }

    expect(counts).toEqual({ 'first-dozen': 12, 'second-dozen': 12, 'third-dozen': 12 });
  });

  test('columns partition 1-36 into three blocks of twelve', () => {
    const columns = ['first-column', 'second-column', 'third-column'] as const;
    const counts: Record<string, number> = {
      'first-column': 0,
      'second-column': 0,
      'third-column': 0,
    };

    for (let n = 1; n <= 36; n++) {
      const position = String(n);
      const color = getColor(position);
      const hits = columns.filter((c) => BET_TYPES[c].matches(position, color));
      expect(hits).toHaveLength(1);
      counts[hits[0]]++;
    }

    expect(counts).toEqual({ 'first-column': 12, 'second-column': 12, 'third-column': 12 });
  });
});

describe('payout multipliers', () => {
  test('straight-up pays 35:1', () => {
    for (const position of WHEEL_POSITIONS) {
      expect(BET_TYPES[position].payout).toBe(35);
    }
  });

  test('even-money bets pay 1:1', () => {
    for (const name of ['red', 'black', 'odd', 'even', 'low', 'high']) {
      expect(BET_TYPES[name].payout).toBe(1);
    }
  });

  test('dozens and columns pay 2:1', () => {
    for (const name of [
      'first-dozen',
      'second-dozen',
      'third-dozen',
      'first-column',
      'second-column',
      'third-column',
    ]) {
      expect(BET_TYPES[name].payout).toBe(2);
    }
  });

  // Sanity check on the maths the payout code performs: profit = stake * payout,
  // and the player gets stake + profit back.
  test('a winning straight-up returns 36x the stake', () => {
    const stake = 1000;
    const profit = stake * BET_TYPES['17'].payout;
    expect(profit).toBe(35000);
    expect(stake + profit).toBe(36000);
  });

  test('house edge holds: 38 pockets, straight-up pays 36', () => {
    // The two green pockets are the entire edge. If WHEEL_POSITIONS ever gained or lost
    // a pocket without the payout changing, this catches it.
    const stake = 1;
    const expectedReturnPerSpin = (1 / WHEEL_POSITIONS.length) * (stake + stake * 35);
    expect(expectedReturnPerSpin).toBeCloseTo(36 / 38, 10);
    expect(expectedReturnPerSpin).toBeLessThan(1);
  });
});
