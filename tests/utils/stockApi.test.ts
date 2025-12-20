import { describe, test, expect } from '@jest/globals';
import { isValidTickerFormat } from '../../stock/stockApi.js';

describe('stockApi', () => {
  // ============ isValidTickerFormat TESTS ============
  // Note: getQuote tests require mocking fetch and environment variables
  // Those would be better suited for integration tests

  describe('isValidTickerFormat', () => {
    test('returns true for valid tickers (1-5 letters)', () => {
      expect(isValidTickerFormat('A')).toBe(true);
      expect(isValidTickerFormat('AB')).toBe(true);
      expect(isValidTickerFormat('ABC')).toBe(true);
      expect(isValidTickerFormat('ABCD')).toBe(true);
      expect(isValidTickerFormat('ABCDE')).toBe(true);
    });

    test('returns true for uppercase tickers', () => {
      expect(isValidTickerFormat('AAPL')).toBe(true);
      expect(isValidTickerFormat('MSFT')).toBe(true);
      expect(isValidTickerFormat('GOOGL')).toBe(true);
      expect(isValidTickerFormat('TSLA')).toBe(true);
    });

    test('returns true for lowercase tickers', () => {
      expect(isValidTickerFormat('aapl')).toBe(true);
      expect(isValidTickerFormat('msft')).toBe(true);
      expect(isValidTickerFormat('googl')).toBe(true);
    });

    test('returns true for mixed case tickers', () => {
      expect(isValidTickerFormat('Aapl')).toBe(true);
      expect(isValidTickerFormat('MsFt')).toBe(true);
    });

    test('returns true for tickers with leading/trailing whitespace', () => {
      expect(isValidTickerFormat(' AAPL')).toBe(true);
      expect(isValidTickerFormat('AAPL ')).toBe(true);
      expect(isValidTickerFormat(' AAPL ')).toBe(true);
    });

    test('returns false for empty string', () => {
      expect(isValidTickerFormat('')).toBe(false);
    });

    test('returns false for null/undefined', () => {
      expect(isValidTickerFormat(null as unknown as string)).toBe(false);
      expect(isValidTickerFormat(undefined as unknown as string)).toBe(false);
    });

    test('returns false for non-strings', () => {
      expect(isValidTickerFormat(12345 as unknown as string)).toBe(false);
      expect(isValidTickerFormat({} as unknown as string)).toBe(false);
      expect(isValidTickerFormat([] as unknown as string)).toBe(false);
    });

    test('returns false for strings with numbers', () => {
      expect(isValidTickerFormat('AAPL1')).toBe(false);
      expect(isValidTickerFormat('1AAPL')).toBe(false);
      expect(isValidTickerFormat('A1PL')).toBe(false);
      expect(isValidTickerFormat('12345')).toBe(false);
    });

    test('returns false for >5 characters', () => {
      expect(isValidTickerFormat('ABCDEF')).toBe(false);
      expect(isValidTickerFormat('MICROSFT')).toBe(false);
      expect(isValidTickerFormat('VERYLONGTICKER')).toBe(false);
    });

    test('returns false for special characters', () => {
      expect(isValidTickerFormat('AAP!')).toBe(false);
      expect(isValidTickerFormat('AA.PL')).toBe(false);
      expect(isValidTickerFormat('AA-PL')).toBe(false);
      expect(isValidTickerFormat('AA_PL')).toBe(false);
      expect(isValidTickerFormat('AA$PL')).toBe(false);
    });

    test('returns false for whitespace-only strings', () => {
      expect(isValidTickerFormat('   ')).toBe(false);
      expect(isValidTickerFormat('\t')).toBe(false);
      expect(isValidTickerFormat('\n')).toBe(false);
    });
  });

  // ============ getQuote TESTS (Integration - Commented Out) ============
  // These tests require mocking fetch() and process.env.FINNHUB_API_KEY
  // They are better suited for integration tests with proper mocking setup

  /*
  describe('getQuote', () => {
    // Would need to mock:
    // 1. process.env.FINNHUB_API_KEY
    // 2. global.fetch

    test('returns success false when API key not configured', async () => {
      // Mock process.env.FINNHUB_API_KEY = undefined
    });

    test('returns success true with data for valid ticker', async () => {
      // Mock successful fetch response
    });

    test('returns error for invalid ticker (all zeros response)', async () => {
      // Mock Finnhub's invalid ticker response
    });

    test('handles fetch timeout', async () => {
      // Mock AbortError
    });

    test('handles network errors', async () => {
      // Mock fetch throwing an error
    });
  });
  */
});
