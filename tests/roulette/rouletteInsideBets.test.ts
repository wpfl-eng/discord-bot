import { describe, test, expect } from '@jest/globals';
import {
  INSIDE_BETS,
  INSIDE_PAYOUT,
  colOf,
  insideBet,
  insideBetCovers,
  insideBetsCovering,
  rowOf,
  type InsideFamily,
} from '../../discordCommands/roulette/rouletteInsideBets.js';
import { WHEEL_POSITIONS } from '../../discordCommands/roulette/rouletteConfig.js';

function ofFamily(family: InsideFamily) {
  return INSIDE_BETS.filter((b) => b.family === family);
}

// ============ THE GRID ============

describe('felt geometry', () => {
  test('numbers land in twelve rows of three', () => {
    expect(rowOf(1)).toBe(0);
    expect(colOf(1)).toBe(0);
    expect(rowOf(3)).toBe(0);
    expect(colOf(3)).toBe(2);
    expect(rowOf(36)).toBe(11);
    expect(colOf(36)).toBe(2);
    expect(rowOf(17)).toBe(5);
    expect(colOf(17)).toBe(1);
  });
});

// ============ POPULATION ============

describe('bet population', () => {
  // These counts are the whole point: an American felt has exactly this many
  // combinations, and a generator that drifts is silently offering bets that do not
  // exist or missing ones that do.
  test.each([
    ['straight' as InsideFamily, 38],
    ['split' as InsideFamily, 62],
    ['street' as InsideFamily, 12],
    ['corner' as InsideFamily, 22],
    ['line' as InsideFamily, 11],
    ['basket' as InsideFamily, 1],
  ])('there are exactly %i %s bets', (family, count) => {
    expect(ofFamily(family)).toHaveLength(count);
  });

  test('146 inside bets in total', () => {
    expect(INSIDE_BETS).toHaveLength(146);
  });

  test('every key is unique', () => {
    const keys = INSIDE_BETS.map((b) => b.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  // roulette_bets.bet_type is VARCHAR(20). A longer key would be truncated on write and
  // never match on read.
  test('every key fits roulette_bets.bet_type VARCHAR(20)', () => {
    for (const bet of INSIDE_BETS) {
      expect(bet.key.length).toBeLessThanOrEqual(20);
    }
  });

  test('every pocket referenced is a real wheel position', () => {
    for (const bet of INSIDE_BETS) {
      for (const pocket of bet.pockets) {
        expect(WHEEL_POSITIONS).toContain(pocket);
      }
    }
  });

  test('each family pays its standard price', () => {
    for (const bet of INSIDE_BETS) {
      expect(bet.payout).toBe(INSIDE_PAYOUT[bet.family]);
    }
  });
});

// ============ SHAPES ============

describe('bet shapes', () => {
  test.each([
    ['straight' as InsideFamily, 1],
    ['split' as InsideFamily, 2],
    ['street' as InsideFamily, 3],
    ['corner' as InsideFamily, 4],
    ['line' as InsideFamily, 6],
    ['basket' as InsideFamily, 5],
  ])('%s bets cover %i pockets', (family, size) => {
    for (const bet of ofFamily(family)) {
      expect(bet.pockets).toHaveLength(size);
    }
  });

  test('splits only ever join genuinely adjacent pockets', () => {
    for (const bet of ofFamily('split')) {
      const [a, b] = bet.pockets;
      if (a === '0' || a === '00' || b === '0' || b === '00') continue;

      const x = Number(a);
      const y = Number(b);
      const sameRow: boolean = rowOf(x) === rowOf(y) && Math.abs(colOf(x) - colOf(y)) === 1;
      const sameCol: boolean = colOf(x) === colOf(y) && Math.abs(rowOf(x) - rowOf(y)) === 1;

      expect(sameRow || sameCol).toBe(true);
    }
  });

  test('corners are a real 2x2 block', () => {
    for (const bet of ofFamily('corner')) {
      const [tl, tr, bl, br] = bet.pockets.map(Number);
      expect(tr).toBe(tl + 1);
      expect(bl).toBe(tl + 3);
      expect(br).toBe(tl + 4);
      expect(rowOf(tl)).toBe(rowOf(tr));
      expect(rowOf(bl)).toBe(rowOf(tl) + 1);
    }
  });

  test('streets are a whole row', () => {
    for (const bet of ofFamily('street')) {
      const nums = bet.pockets.map(Number);
      expect(new Set(nums.map(rowOf)).size).toBe(1);
      expect(nums.map(colOf).sort()).toEqual([0, 1, 2]);
    }
  });

  test('six lines are two consecutive whole rows', () => {
    for (const bet of ofFamily('line')) {
      const rows = [...new Set(bet.pockets.map((p) => rowOf(Number(p))))].sort((a, b) => a - b);
      expect(rows).toHaveLength(2);
      expect(rows[1]).toBe(rows[0] + 1);
    }
  });

  test('the basket is the American five-number bet', () => {
    expect(insideBet('basket')?.pockets).toEqual(['0', '00', '1', '2', '3']);
  });
});

// ============ COVERAGE ============

describe('coverage', () => {
  // The panel shows every bet covering one number, so this index has to be exhaustive
  // and consistent with the bets themselves in both directions.
  test('the reverse index agrees with every bet, in both directions', () => {
    for (const pocket of WHEEL_POSITIONS) {
      const covering = insideBetsCovering(pocket);

      for (const bet of covering) {
        expect(bet.pockets).toContain(pocket);
      }

      const expected = INSIDE_BETS.filter((b) => b.pockets.includes(pocket));
      expect(covering.length).toBe(expected.length);
    }
  });

  test('every pocket is covered by at least its own straight-up bet', () => {
    for (const pocket of WHEEL_POSITIONS) {
      expect(insideBetsCovering(pocket).some((b) => b.family === 'straight')).toBe(true);
    }
  });

  // The 25-option select cap is what makes the number-anchored panel viable at all.
  test('no pocket is covered by more than 20 inside bets', () => {
    for (const pocket of WHEEL_POSITIONS) {
      expect(insideBetsCovering(pocket).length).toBeLessThanOrEqual(20);
    }
  });

  test('17 is covered by exactly the bets a felt would offer', () => {
    const keys = insideBetsCovering('17')
      .map((b) => b.key)
      .sort();
    expect(keys).toEqual(
      [
        '17',
        'split-14-17',
        'split-16-17',
        'split-17-18',
        'split-17-20',
        'street-16',
        'corner-13',
        'corner-14',
        'corner-16',
        'corner-17',
        'line-13',
        'line-16',
      ].sort()
    );
  });

  test('a corner number is covered by only one corner', () => {
    // 1 sits in the top-left of the felt, so only the 1-2-4-5 corner touches it.
    expect(insideBetsCovering('1').filter((b) => b.family === 'corner')).toHaveLength(1);
  });

  test('insideBetCovers is exhaustive over every bet and every pocket', () => {
    for (const bet of INSIDE_BETS) {
      for (const pocket of WHEEL_POSITIONS) {
        expect(insideBetCovers(bet.key, pocket)).toBe(bet.pockets.includes(pocket));
      }
    }
  });

  test('an unknown key covers nothing', () => {
    expect(insideBetCovers('not-a-bet', '17')).toBe(false);
    expect(insideBet('not-a-bet')).toBeNull();
  });
});
