import { describe, test, expect } from '@jest/globals';
import {
  formatNumber,
  getCurrentNFLWeek,
  getCurrentNFLSeason,
  produceResponseObjectForText,
  produceImmediateResponse,
} from '../../helpers/utils.js';

describe('utils', () => {
  describe('formatNumber', () => {
    test('rounds to 2 decimal places', () => {
      expect(formatNumber(3.14159)).toBe(3.14);
      expect(formatNumber(2.555)).toBe(2.56);
      expect(formatNumber(100.999)).toBe(101);
    });

    test('handles NaN input gracefully', () => {
      expect(formatNumber(NaN)).toBe(0);
    });

    test('handles negative numbers', () => {
      expect(formatNumber(-3.14159)).toBe(-3.14);
    });

    test('handles integers', () => {
      expect(formatNumber(42)).toBe(42);
    });

    test('handles zero', () => {
      expect(formatNumber(0)).toBe(0);
    });
  });

  describe('getCurrentNFLWeek', () => {
    test('returns week 1 at season start (2024)', () => {
      // 2024: Labor Day = Sept 2, Season starts Sept 5 (Thursday)
      const week1 = new Date('2024-09-05');
      expect(getCurrentNFLWeek(week1)).toBe(1);
    });

    test('returns week 1 during first week of season', () => {
      // First Saturday of week 1
      const firstSaturday = new Date('2024-09-07');
      expect(getCurrentNFLWeek(firstSaturday)).toBe(1);
    });

    test('returns week 2 after first week', () => {
      // Week 2 starts Sept 12 - use local time to avoid UTC midnight issues
      const week2 = new Date(2024, 8, 14, 12, 0, 0); // Sept 14, 2024 noon local
      expect(getCurrentNFLWeek(week2)).toBe(2);
    });

    test('returns correct week mid-season', () => {
      // Mid-November should be around week 10-11
      const midNovember = new Date('2024-11-14');
      const week = getCurrentNFLWeek(midNovember);
      expect(week).toBeGreaterThanOrEqual(9);
      expect(week).toBeLessThanOrEqual(12);
    });

    test('returns 1 before season starts', () => {
      const preseason = new Date('2024-08-15');
      expect(getCurrentNFLWeek(preseason)).toBe(1);
    });

    test('returns week 17 in late December', () => {
      // Dec 28, 2024 is ~114 days from Sept 5 = week 17
      // Week 18 games are in Jan 2025, which calculates for 2025 season
      const lateDecember = new Date(2024, 11, 28, 12, 0, 0); // Dec 28, 2024
      expect(getCurrentNFLWeek(lateDecember)).toBe(17);
    });

    test('returns 1 before season starts (next year)', () => {
      // Feb 2025 is before the 2025 season starts
      const preseason2025 = new Date(2025, 1, 1, 12, 0, 0); // Feb 1, 2025
      expect(getCurrentNFLWeek(preseason2025)).toBe(1);
    });

    test('handles different years correctly', () => {
      // 2025: Labor Day = Sept 1, Season starts Sept 4
      const week1_2025 = new Date('2025-09-04');
      expect(getCurrentNFLWeek(week1_2025)).toBe(1);
    });

    test('defaults to current date when no argument provided', () => {
      const result = getCurrentNFLWeek();
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(18);
    });
  });

  describe('produceResponseObjectForText', () => {
    test('wraps text in response object', () => {
      const result = produceResponseObjectForText('hello');
      expect(result).toEqual({ text: 'hello' });
    });

    test('handles empty string', () => {
      const result = produceResponseObjectForText('');
      expect(result).toEqual({ text: '' });
    });

    test('handles special characters', () => {
      const result = produceResponseObjectForText('Hello! @user #channel');
      expect(result).toEqual({ text: 'Hello! @user #channel' });
    });
  });

  describe('produceImmediateResponse', () => {
    test('delegates to produceResponseObjectForText', () => {
      const result = produceImmediateResponse('test');
      expect(result).toEqual({ text: 'test' });
    });

    test('produces same result as produceResponseObjectForText', () => {
      const text = 'Hello world';
      expect(produceImmediateResponse(text)).toEqual(produceResponseObjectForText(text));
    });
  });
  /**
   * An NFL season is named for the calendar year it starts in and runs into
   * February of the next one, which is also how ESPN keys `seasonId`. The
   * codebase had been reaching for `new Date().getFullYear()` directly, which
   * is right for ten months of the year and wrong for the two that contain the
   * fantasy playoffs and the championship.
   */
  describe('getCurrentNFLSeason', () => {
    test('is the calendar year during the season itself', () => {
      expect(getCurrentNFLSeason(new Date('2026-09-15T12:00:00Z'))).toBe(2026);
      expect(getCurrentNFLSeason(new Date('2026-12-25T12:00:00Z'))).toBe(2026);
    });

    test('is still the previous year through January and February', () => {
      expect(getCurrentNFLSeason(new Date('2027-01-05T12:00:00Z'))).toBe(2026);
      expect(getCurrentNFLSeason(new Date('2027-02-08T12:00:00Z'))).toBe(2026);
    });

    test('rolls over in March, when the NFL league year begins', () => {
      expect(getCurrentNFLSeason(new Date('2027-03-15T12:00:00Z'))).toBe(2027);
      expect(getCurrentNFLSeason(new Date('2027-08-01T12:00:00Z'))).toBe(2027);
    });

    test('defaults to now', () => {
      expect(typeof getCurrentNFLSeason()).toBe('number');
    });
  });
});
