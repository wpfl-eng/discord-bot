import { describe, test, expect } from '@jest/globals';
import {
  STOCK_CONFIG,
  STOCK_MESSAGES,
  formatShares,
  formatPrice,
} from '../../stock/stockConfig.js';

describe('stockConfig', () => {
  // ============ STOCK_CONFIG TESTS ============

  describe('STOCK_CONFIG', () => {
    test('has valid trade limits', () => {
      expect(STOCK_CONFIG.TRADE_MIN).toBe(10);
      expect(STOCK_CONFIG.TRADE_MAX).toBe(10000);
      expect(STOCK_CONFIG.TRADE_MIN).toBeLessThan(STOCK_CONFIG.TRADE_MAX);
    });

    test('has trade cooldown', () => {
      expect(STOCK_CONFIG.TRADE_COOLDOWN_SECONDS).toBe(30);
    });

    test('has API configuration', () => {
      expect(STOCK_CONFIG.API_BASE_URL).toBe('https://finnhub.io/api/v1');
      expect(STOCK_CONFIG.API_TIMEOUT_MS).toBe(5000);
    });

    test('has display precision settings', () => {
      expect(STOCK_CONFIG.DECIMAL_PLACES_SHARES).toBe(6);
      expect(STOCK_CONFIG.DECIMAL_PLACES_PRICE).toBe(2);
    });
  });

  // ============ STOCK_MESSAGES TESTS ============

  describe('STOCK_MESSAGES', () => {
    test('has all error messages', () => {
      expect(typeof STOCK_MESSAGES.INVALID_TICKER).toBe('string');
      expect(typeof STOCK_MESSAGES.API_ERROR).toBe('string');
      expect(typeof STOCK_MESSAGES.API_NOT_CONFIGURED).toBe('string');
      expect(typeof STOCK_MESSAGES.INSUFFICIENT_FUNDS).toBe('string');
      expect(typeof STOCK_MESSAGES.INSUFFICIENT_SHARES).toBe('string');
      expect(typeof STOCK_MESSAGES.NO_HOLDINGS).toBe('string');
    });

    test('COOLDOWN is a function that returns message with seconds', () => {
      expect(typeof STOCK_MESSAGES.COOLDOWN).toBe('function');
      const message = STOCK_MESSAGES.COOLDOWN(15);
      expect(message).toContain('15');
      expect(message).toContain('seconds');
    });
  });

  // ============ FUNCTION TESTS ============

  describe('formatShares', () => {
    test('formats whole numbers', () => {
      expect(formatShares(100)).toBe('100');
      expect(formatShares(5)).toBe('5');
    });

    test('removes trailing zeros', () => {
      expect(formatShares(100.0)).toBe('100');
      expect(formatShares(5.5)).toBe('5.5');
    });

    test('limits decimal places to 6', () => {
      expect(formatShares(1.123456789)).toBe('1.123457');
    });

    test('handles small fractional shares', () => {
      expect(formatShares(0.000001)).toBe('0.000001');
    });

    test('handles zero', () => {
      expect(formatShares(0)).toBe('0');
    });
  });

  describe('formatPrice', () => {
    test('formats with 2 decimal places', () => {
      expect(formatPrice(100)).toBe('100.00');
      expect(formatPrice(5.5)).toBe('5.50');
    });

    test('adds thousands separators', () => {
      expect(formatPrice(1000)).toBe('1,000.00');
      expect(formatPrice(1000000)).toBe('1,000,000.00');
    });

    test('handles small values', () => {
      expect(formatPrice(0.01)).toBe('0.01');
      expect(formatPrice(0.1)).toBe('0.10');
    });

    test('handles zero', () => {
      expect(formatPrice(0)).toBe('0.00');
    });

    test('handles negative prices', () => {
      const result = formatPrice(-100.5);
      expect(result).toContain('100');
      expect(result).toContain('50');
    });
  });
});
