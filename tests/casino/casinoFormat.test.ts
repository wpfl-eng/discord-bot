import { describe, test, expect } from '@jest/globals';
import { formatAmount, formatSigned, plural, relativeTime } from '../../casino/casinoFormat.js';
import { formatAmount as rouletteFormatAmount } from '../../discordCommands/roulette/rouletteConfig.js';
import { formatAmount as crapsFormatAmount } from '../../discordCommands/craps/crapsConfig.js';

describe('formatAmount', () => {
  test.each([
    [0, '0'],
    [999, '999'],
    [1000, '1K'],
    [1500, '1.5K'],
    [9999, '10K'],
    [10000, '10K'],
    [12500, '12.5K'],
    [100000, '100K'],
  ])('formats %i as %s', (input: number, expected: string) => {
    expect(formatAmount(input)).toBe(expected);
  });
});

describe('deduplication', () => {
  // The whole point of casinoFormat: roulette and craps previously carried byte-identical
  // private copies of this function. They must now resolve to the same implementation.
  test('roulette and craps re-export the shared formatter', () => {
    expect(rouletteFormatAmount).toBe(formatAmount);
    expect(crapsFormatAmount).toBe(formatAmount);
  });
});

describe('formatSigned', () => {
  test('marks direction explicitly', () => {
    expect(formatSigned(1500)).toBe('+1.5K');
    expect(formatSigned(-500)).toBe('-500');
    expect(formatSigned(0)).toBe('0');
  });
});

describe('plural', () => {
  test('only pluralises past one', () => {
    expect(plural(1, 'spin')).toBe('1 spin');
    expect(plural(0, 'spin')).toBe('0 spins');
    expect(plural(3, 'spin')).toBe('3 spins');
  });
});

describe('relativeTime', () => {
  test('emits a Discord relative timestamp in seconds', () => {
    expect(relativeTime(1_700_000_000_000)).toBe('<t:1700000000:R>');
  });
});
