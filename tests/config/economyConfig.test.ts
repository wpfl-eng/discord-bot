import { describe, test, expect } from '@jest/globals';
import {
  CONFIG,
  WORK_JOBS,
  CURRENCY_EMOJI,
  CURRENCY_NAME,
  SLOTS_SYMBOLS,
  SLOTS_PAYOUTS,
  REDZONE_FIELD_POSITIONS,
  formatCurrency,
  isCooldownOver,
  formatCooldown,
  randomInt,
  getRandomJob,
} from '../../economy/economyConfig.js';

describe('economyConfig', () => {
  describe('CONFIG', () => {
    test('has all required properties', () => {
      expect(CONFIG.DAILY_AMOUNT).toBeDefined();
      expect(CONFIG.WORK_MIN).toBeDefined();
      expect(CONFIG.WORK_MAX).toBeDefined();
      expect(CONFIG.GAMBLE_MIN).toBeDefined();
      expect(CONFIG.GAMBLE_MAX).toBeDefined();
      expect(CONFIG.BANK_STARTING_CAPACITY).toBeDefined();
    });

    test('WORK_MIN is less than WORK_MAX', () => {
      expect(CONFIG.WORK_MIN).toBeLessThan(CONFIG.WORK_MAX);
    });

    test('GAMBLE_MIN is less than GAMBLE_MAX', () => {
      expect(CONFIG.GAMBLE_MIN).toBeLessThan(CONFIG.GAMBLE_MAX);
    });
  });

  describe('WORK_JOBS', () => {
    test('is an array with at least one job', () => {
      expect(Array.isArray(WORK_JOBS)).toBe(true);
      expect(WORK_JOBS.length).toBeGreaterThan(0);
    });

    test('each job has success and fail messages', () => {
      WORK_JOBS.forEach((job) => {
        expect(typeof job.success).toBe('string');
        expect(typeof job.fail).toBe('string');
        expect(job.success.length).toBeGreaterThan(0);
        expect(job.fail.length).toBeGreaterThan(0);
      });
    });
  });

  describe('SLOTS_SYMBOLS', () => {
    test('is an array with at least one symbol', () => {
      expect(Array.isArray(SLOTS_SYMBOLS)).toBe(true);
      expect(SLOTS_SYMBOLS.length).toBeGreaterThan(0);
    });

    test('each symbol has required properties', () => {
      SLOTS_SYMBOLS.forEach((symbol) => {
        expect(typeof symbol.emoji).toBe('string');
        expect(typeof symbol.name).toBe('string');
        expect(typeof symbol.weight).toBe('number');
        expect(['common', 'uncommon', 'rare', 'legendary']).toContain(symbol.tier);
      });
    });

    test('weights sum to reasonable total', () => {
      const totalWeight = SLOTS_SYMBOLS.reduce((sum, s) => sum + s.weight, 0);
      expect(totalWeight).toBe(100);
    });
  });

  describe('REDZONE_FIELD_POSITIONS', () => {
    test('has positions from 20 to 100', () => {
      expect(REDZONE_FIELD_POSITIONS[20]).toBeDefined();
      expect(REDZONE_FIELD_POSITIONS[100]).toBeDefined();
    });

    test('multipliers increase as yard line increases', () => {
      const positions = [20, 30, 40, 50, 60, 70, 80, 90, 100];
      for (let i = 1; i < positions.length; i++) {
        const prevMultiplier =
          REDZONE_FIELD_POSITIONS[positions[i - 1] as keyof typeof REDZONE_FIELD_POSITIONS]
            .multiplier;
        const currMultiplier =
          REDZONE_FIELD_POSITIONS[positions[i] as keyof typeof REDZONE_FIELD_POSITIONS].multiplier;
        expect(currMultiplier).toBeGreaterThan(prevMultiplier);
      }
    });

    test('touchdown has 0 fumble chance', () => {
      expect(REDZONE_FIELD_POSITIONS[100].fumbleChance).toBe(0);
    });
  });

  describe('formatCurrency', () => {
    test('formats positive numbers with emoji', () => {
      const result = formatCurrency(100);
      expect(result).toContain(CURRENCY_EMOJI);
      expect(result).toContain('100');
    });

    test('formats large numbers with locale formatting', () => {
      const result = formatCurrency(1000000);
      expect(result).toContain(CURRENCY_EMOJI);
      // Should contain comma or locale-appropriate separator
      expect(result).toMatch(/1[,.]?000[,.]?000/);
    });

    test('formats zero', () => {
      const result = formatCurrency(0);
      expect(result).toContain(CURRENCY_EMOJI);
      expect(result).toContain('0');
    });

    test('formats negative numbers', () => {
      const result = formatCurrency(-500);
      expect(result).toContain(CURRENCY_EMOJI);
      expect(result).toContain('-');
      expect(result).toContain('500');
    });

    test('handles decimal numbers', () => {
      const result = formatCurrency(123.456);
      expect(result).toContain(CURRENCY_EMOJI);
      // toLocaleString behavior may vary, just check it doesn't throw
      expect(result).toBeDefined();
    });

    test('handles NaN input gracefully', () => {
      // This tests the bug fix - should not throw
      expect(() => formatCurrency(NaN)).not.toThrow();
    });
  });

  describe('isCooldownOver', () => {
    test('returns true when lastAction is null', () => {
      expect(isCooldownOver(null, 60000)).toBe(true);
    });

    test('returns true when lastAction is undefined', () => {
      expect(isCooldownOver(undefined, 60000)).toBe(true);
    });

    test('returns true when cooldown has expired', () => {
      const pastTime = new Date(Date.now() - 120000); // 2 minutes ago
      expect(isCooldownOver(pastTime, 60000)).toBe(true); // 1 minute cooldown
    });

    test('returns false when cooldown is still active', () => {
      const recentTime = new Date(Date.now() - 30000); // 30 seconds ago
      expect(isCooldownOver(recentTime, 60000)).toBe(false); // 1 minute cooldown
    });

    test('handles Date objects', () => {
      const pastTime = new Date(Date.now() - 120000);
      expect(isCooldownOver(pastTime, 60000)).toBe(true);
    });

    test('handles ISO date strings', () => {
      const pastTime = new Date(Date.now() - 120000).toISOString();
      expect(isCooldownOver(pastTime, 60000)).toBe(true);
    });

    test('handles invalid date string gracefully', () => {
      // This tests the bug fix - invalid dates should be handled
      expect(() => isCooldownOver('invalid-date', 60000)).not.toThrow();
    });

    test('returns true when elapsed exactly equals cooldown', () => {
      const exactTime = new Date(Date.now() - 60000);
      expect(isCooldownOver(exactTime, 60000)).toBe(true);
    });
  });

  describe('formatCooldown', () => {
    test('returns null when lastAction is null', () => {
      expect(formatCooldown(null, 60000)).toBeNull();
    });

    test('returns null when lastAction is undefined', () => {
      expect(formatCooldown(undefined, 60000)).toBeNull();
    });

    test('returns null when cooldown has expired', () => {
      const pastTime = new Date(Date.now() - 120000); // 2 minutes ago
      expect(formatCooldown(pastTime, 60000)).toBeNull(); // 1 minute cooldown
    });

    test('returns formatted time when cooldown is active', () => {
      const recentTime = new Date(Date.now() - 30000); // 30 seconds ago
      const result = formatCooldown(recentTime, 60000); // 1 minute cooldown
      expect(result).not.toBeNull();
      expect(result).toMatch(/\d+[sm]/); // Should contain seconds or minutes format
    });

    test('formats hours and minutes correctly', () => {
      const recentTime = new Date(Date.now() - 1000); // 1 second ago
      const result = formatCooldown(recentTime, 3700000); // ~1 hour cooldown
      expect(result).not.toBeNull();
      expect(result).toContain('h');
      expect(result).toContain('m');
    });

    test('formats minutes and seconds correctly', () => {
      const recentTime = new Date(Date.now() - 1000); // 1 second ago
      const result = formatCooldown(recentTime, 180000); // 3 minutes cooldown
      expect(result).not.toBeNull();
      expect(result).toContain('m');
      expect(result).toContain('s');
    });

    test('formats only seconds for short cooldowns', () => {
      const recentTime = new Date(Date.now() - 1000); // 1 second ago
      const result = formatCooldown(recentTime, 30000); // 30 second cooldown
      expect(result).not.toBeNull();
      expect(result).toMatch(/^\d+s$/);
    });

    test('handles invalid date string gracefully', () => {
      // This tests the bug fix - invalid dates should be handled
      expect(() => formatCooldown('invalid-date', 60000)).not.toThrow();
    });
  });

  describe('randomInt', () => {
    test('returns value within range', () => {
      for (let i = 0; i < 100; i++) {
        const result = randomInt(1, 10);
        expect(result).toBeGreaterThanOrEqual(1);
        expect(result).toBeLessThanOrEqual(10);
      }
    });

    test('returns integer values', () => {
      for (let i = 0; i < 100; i++) {
        const result = randomInt(1, 100);
        expect(Number.isInteger(result)).toBe(true);
      }
    });

    test('handles min === max', () => {
      expect(randomInt(5, 5)).toBe(5);
    });

    test('handles negative ranges', () => {
      for (let i = 0; i < 50; i++) {
        const result = randomInt(-10, -1);
        expect(result).toBeGreaterThanOrEqual(-10);
        expect(result).toBeLessThanOrEqual(-1);
      }
    });

    test('handles range crossing zero', () => {
      for (let i = 0; i < 50; i++) {
        const result = randomInt(-5, 5);
        expect(result).toBeGreaterThanOrEqual(-5);
        expect(result).toBeLessThanOrEqual(5);
      }
    });
  });

  describe('getRandomJob', () => {
    test('returns a job object', () => {
      const job = getRandomJob();
      expect(job).toBeDefined();
      expect(typeof job.success).toBe('string');
      expect(typeof job.fail).toBe('string');
    });

    test('returns a job from WORK_JOBS array', () => {
      const job = getRandomJob();
      expect(WORK_JOBS).toContainEqual(job);
    });

    test('returns different jobs over multiple calls', () => {
      const jobs = new Set();
      for (let i = 0; i < 100; i++) {
        jobs.add(JSON.stringify(getRandomJob()));
      }
      // With 100 calls and 15 jobs, we should get at least 3 different ones
      expect(jobs.size).toBeGreaterThan(2);
    });
  });

  describe('constants', () => {
    test('CURRENCY_EMOJI is a string', () => {
      expect(typeof CURRENCY_EMOJI).toBe('string');
      expect(CURRENCY_EMOJI.length).toBeGreaterThan(0);
    });

    test('CURRENCY_NAME is a string', () => {
      expect(typeof CURRENCY_NAME).toBe('string');
      expect(CURRENCY_NAME.length).toBeGreaterThan(0);
    });

    test('SLOTS_PAYOUTS has required multipliers', () => {
      expect(SLOTS_PAYOUTS.tripleJackpot).toBeDefined();
      expect(SLOTS_PAYOUTS.tripleTrophy).toBeDefined();
      expect(SLOTS_PAYOUTS.tripleGold).toBeDefined();
      expect(typeof SLOTS_PAYOUTS.tripleJackpot).toBe('number');
    });
  });
});
