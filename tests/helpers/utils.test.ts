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
      // Dec 28, 2024 is ~114 days from Sept 5 = week 17. Week 18 falls in
      // January 2025 and still belongs to the 2024 season.
      const lateDecember = new Date(2024, 11, 28, 12, 0, 0); // Dec 28, 2024
      expect(getCurrentNFLWeek(lateDecember)).toBe(17);
    });

    /**
     * This case used to assert week 1, on the reasoning -- written into its own
     * comment -- that "Feb 2025 is before the 2025 season starts". True, and
     * beside the point: February 2025 is the tail of the *2024* season, whose
     * Super Bowl was played on the 9th. Asserting week 1 there was asserting
     * the defect. It reads 18 now, the end of the season actually in progress.
     */
    test('February belongs to the season ending, not the one to come', () => {
      const february = new Date(2025, 1, 1, 12, 0, 0); // Feb 1, 2025
      expect(getCurrentNFLWeek(february)).toBe(18);
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

  /**
   * getCurrentNFLWeek measures from the Thursday after Labor Day. It used to
   * take that Labor Day from the calendar year, so from January 1st it was
   * measuring against a season start eight months in the future -- and every
   * date before the start returns week 1. The fantasy playoffs and the
   * championship are exactly the weeks that fell into that hole.
   *
   * The 2026 season starts Thursday 10 September 2026 (Labor Day is the 7th),
   * so week 18 ends 14 January 2027.
   */
  describe('getCurrentNFLWeek across the new year', () => {
    test('early January is late in the season, not week 1', () => {
      expect(getCurrentNFLWeek(new Date('2027-01-05T12:00:00-05:00'))).toBe(17);
    });

    test('the last day of week 18 is still week 18', () => {
      expect(getCurrentNFLWeek(new Date('2027-01-13T12:00:00-05:00'))).toBe(18);
    });

    test('February, past the end of the regular season, clamps to 18', () => {
      expect(getCurrentNFLWeek(new Date('2027-02-08T12:00:00-05:00'))).toBe(18);
    });

    test('December of the same calendar year is unaffected', () => {
      expect(getCurrentNFLWeek(new Date('2026-12-15T12:00:00-05:00'))).toBe(14);
    });
  });
});
