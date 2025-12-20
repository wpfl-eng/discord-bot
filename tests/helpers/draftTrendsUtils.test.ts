import { describe, test, expect } from '@jest/globals';
import {
  calculateStats,
  getRoundCategory,
  validateSeasonRange,
  formatPercentage,
  truncateFieldValue,
  getDraftArchetype,
  getRankEmoji,
  isAuctionPick,
  groupAndCount,
  getTopItems,
  safeParseFloat,
  bulletList,
  getLastName,
  DRAFT_CONSTANTS,
} from '../../helpers/draftTrendsUtils.js';

describe('draftTrendsUtils', () => {
  describe('calculateStats', () => {
    test('returns zeros for empty array', () => {
      expect(calculateStats([])).toEqual({ mean: 0, variance: 0, stdDev: 0 });
    });

    test('returns zeros for null/undefined', () => {
      expect(calculateStats(null)).toEqual({ mean: 0, variance: 0, stdDev: 0 });
      expect(calculateStats(undefined)).toEqual({ mean: 0, variance: 0, stdDev: 0 });
    });

    test('calculates correct stats for simple array', () => {
      const result = calculateStats([2, 4, 6]);
      expect(result.mean).toBe(4);
      expect(result.variance).toBeCloseTo(2.67, 1);
      expect(result.stdDev).toBeCloseTo(1.63, 1);
    });

    test('handles single value array', () => {
      const result = calculateStats([5]);
      expect(result.mean).toBe(5);
      expect(result.variance).toBe(0);
      expect(result.stdDev).toBe(0);
    });
  });

  describe('getRoundCategory', () => {
    test('returns early for positions 1-36 (rounds 1-3)', () => {
      expect(getRoundCategory(1)).toBe('early');
      expect(getRoundCategory(12)).toBe('early');
      expect(getRoundCategory(36)).toBe('early');
    });

    test('returns mid for positions 37-96 (rounds 4-8)', () => {
      expect(getRoundCategory(37)).toBe('mid');
      expect(getRoundCategory(60)).toBe('mid');
      expect(getRoundCategory(96)).toBe('mid');
    });

    test('returns late for positions 97+ (rounds 9+)', () => {
      expect(getRoundCategory(97)).toBe('late');
      expect(getRoundCategory(120)).toBe('late');
      expect(getRoundCategory(144)).toBe('late');
    });
  });

  describe('validateSeasonRange', () => {
    test('returns defaults when both undefined', () => {
      const result = validateSeasonRange(undefined, undefined);
      expect(result.seasonMin).toBe(DRAFT_CONSTANTS.MIN_SEASON);
      expect(result.seasonMax).toBe(DRAFT_CONSTANTS.MAX_SEASON);
    });

    test('returns defaults when both null', () => {
      const result = validateSeasonRange(null, null);
      expect(result.seasonMin).toBe(DRAFT_CONSTANTS.MIN_SEASON);
      expect(result.seasonMax).toBe(DRAFT_CONSTANTS.MAX_SEASON);
    });

    test('handles season 0 correctly (bug fix - 0 should not be treated as falsy)', () => {
      // This test verifies the fix for the falsy 0 bug
      const result = validateSeasonRange(0, 2024);
      expect(result.seasonMin).toBe(0); // Should NOT be replaced with MIN_SEASON
      expect(result.seasonMax).toBe(2024);
    });

    test('uses default max when only min provided', () => {
      const result = validateSeasonRange(2020, undefined);
      expect(result.seasonMin).toBe(2020);
      expect(result.seasonMax).toBe(DRAFT_CONSTANTS.MAX_SEASON);
    });

    test('uses default min when only max provided', () => {
      const result = validateSeasonRange(undefined, 2024);
      expect(result.seasonMin).toBe(DRAFT_CONSTANTS.MIN_SEASON);
      expect(result.seasonMax).toBe(2024);
    });

    test('swaps if min > max', () => {
      const result = validateSeasonRange(2024, 2020);
      expect(result.seasonMin).toBe(2020);
      expect(result.seasonMax).toBe(2024);
    });

    test('handles equal values', () => {
      const result = validateSeasonRange(2022, 2022);
      expect(result.seasonMin).toBe(2022);
      expect(result.seasonMax).toBe(2022);
    });
  });

  describe('formatPercentage', () => {
    test('calculates percentage correctly', () => {
      expect(formatPercentage(25, 100)).toBe('25.0');
      expect(formatPercentage(1, 3, 2)).toBe('33.33');
    });

    test('returns 0 for zero total', () => {
      expect(formatPercentage(10, 0)).toBe('0');
    });

    test('handles falsy total', () => {
      expect(formatPercentage(10, 0)).toBe('0');
    });

    test('handles different decimal places', () => {
      expect(formatPercentage(1, 3, 0)).toBe('33');
      expect(formatPercentage(1, 3, 3)).toBe('33.333');
    });
  });

  describe('truncateFieldValue', () => {
    test('returns value unchanged if under limit', () => {
      expect(truncateFieldValue('short', 100)).toBe('short');
    });

    test('truncates long values with ellipsis', () => {
      const result = truncateFieldValue('a'.repeat(20), 10);
      expect(result).toBe('aaaaaaa...');
      expect(result?.length).toBe(10);
    });

    test('handles null gracefully', () => {
      expect(truncateFieldValue(null)).toBeNull();
    });

    test('handles undefined gracefully', () => {
      expect(truncateFieldValue(undefined)).toBeUndefined();
    });

    test('uses default max length', () => {
      const longString = 'a'.repeat(2000);
      const result = truncateFieldValue(longString);
      expect(result?.length).toBeLessThanOrEqual(DRAFT_CONSTANTS.MAX_FIELD_LENGTH);
    });
  });

  describe('getDraftArchetype', () => {
    test('returns SHARK for high auction bids', () => {
      const stats = { auction_max_bid: 70 };
      expect(getDraftArchetype(stats)).toContain('SHARK');
    });

    test('returns VALUE VULTURE for low average value', () => {
      const stats = { auction_max_bid: 30, auction_avg_value: 10 };
      expect(getDraftArchetype(stats)).toContain('VALUE VULTURE');
    });

    test('returns PRECISION DRAFTER for high consistency', () => {
      const stats = {
        auction_max_bid: 30,
        auction_avg_value: 15,
        complexStats: { draftTrends: { consistency: 90 } },
      };
      expect(getDraftArchetype(stats)).toContain('PRECISION');
    });

    test('returns LOYALTY LEGEND for many repeat players', () => {
      const stats = {
        auction_max_bid: 30,
        auction_avg_value: 15,
        complexStats: { repeatPlayers: [1, 2, 3, 4, 5, 6] },
      };
      expect(getDraftArchetype(stats)).toContain('LOYALTY');
    });

    test('handles missing complexStats gracefully (bug fix)', () => {
      const stats = { auction_max_bid: 30, auction_avg_value: 15 };
      // Should not throw, should return CHAOS AGENT
      expect(() => getDraftArchetype(stats)).not.toThrow();
      expect(getDraftArchetype(stats)).toContain('CHAOS');
    });

    test('handles empty stats object', () => {
      expect(() => getDraftArchetype({})).not.toThrow();
    });
  });

  describe('getRankEmoji', () => {
    test('returns crown for rank 0', () => {
      expect(getRankEmoji(0)).toBe(DRAFT_CONSTANTS.EMOJI.CROWN);
    });

    test('returns silver for rank 1', () => {
      expect(getRankEmoji(1)).toBe(DRAFT_CONSTANTS.EMOJI.SILVER);
    });

    test('returns bronze for rank 2', () => {
      expect(getRankEmoji(2)).toBe(DRAFT_CONSTANTS.EMOJI.BRONZE);
    });

    test('returns empty string for other ranks', () => {
      expect(getRankEmoji(3)).toBe('');
      expect(getRankEmoji(10)).toBe('');
    });
  });

  describe('isAuctionPick', () => {
    test('returns true for valid auction pick', () => {
      expect(isAuctionPick({ auction_value: 50, season: 2020 })).toBe(true);
    });

    test('returns false for snake draft pick', () => {
      expect(isAuctionPick({ season: 2020 })).toBe(false);
    });

    test('returns false for zero auction value', () => {
      expect(isAuctionPick({ auction_value: 0, season: 2020 })).toBe(false);
    });

    test('returns false for pre-auction era', () => {
      expect(isAuctionPick({ auction_value: 50, season: 2015 })).toBe(false);
    });
  });

  describe('groupAndCount', () => {
    test('groups items by key', () => {
      const items = [
        { position: 'QB' },
        { position: 'RB' },
        { position: 'QB' },
        { position: 'WR' },
      ];
      const result = groupAndCount(items, 'position');
      expect(result).toEqual({ QB: 2, RB: 1, WR: 1 });
    });

    test('handles missing keys as Unknown', () => {
      const items = [{ position: 'QB' }, { name: 'Test' }];
      const result = groupAndCount(items, 'position');
      expect(result).toEqual({ QB: 1, Unknown: 1 });
    });
  });

  describe('getTopItems', () => {
    test('returns top N items sorted by count', () => {
      const frequency = { QB: 5, RB: 10, WR: 3 };
      const result = getTopItems(frequency, 2);
      expect(result[0].key).toBe('RB');
      expect(result[1].key).toBe('QB');
      expect(result.length).toBe(2);
    });

    test('includes percentage when total provided', () => {
      const frequency = { QB: 5, RB: 5 };
      const result = getTopItems(frequency, 2, 10);
      expect(result[0].percentage).toBe('50.0');
    });

    test('filters out Unknown', () => {
      const frequency = { QB: 5, Unknown: 100 };
      const result = getTopItems(frequency, 2);
      expect(result.length).toBe(1);
      expect(result[0].key).toBe('QB');
    });
  });

  describe('safeParseFloat', () => {
    test('parses valid numbers', () => {
      expect(safeParseFloat('3.14')).toBe(3.14);
      expect(safeParseFloat(42)).toBe(42);
    });

    test('returns default for invalid input', () => {
      expect(safeParseFloat('not a number')).toBe(0);
      expect(safeParseFloat('not a number', 5)).toBe(5);
    });
  });

  describe('bulletList', () => {
    test('formats items as bullet points', () => {
      const result = bulletList(['one', 'two', 'three']);
      expect(result).toBe('• one\n• two\n• three');
    });

    test('handles empty array', () => {
      expect(bulletList([])).toBe('');
    });
  });

  describe('getLastName', () => {
    test('extracts last name', () => {
      expect(getLastName('Tom Brady')).toBe('Brady');
      expect(getLastName('Patrick Mahomes')).toBe('Mahomes');
    });

    test('handles single name', () => {
      expect(getLastName('Madonna')).toBe('Madonna');
    });

    test('handles null/undefined', () => {
      expect(getLastName(null)).toBe('');
      expect(getLastName(undefined)).toBe('');
    });

    test('handles names with multiple parts', () => {
      expect(getLastName('Odell Beckham Jr')).toBe('Jr');
    });
  });
});
