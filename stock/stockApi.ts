// Finnhub API Integration
// Handles fetching real-time stock quotes

import { STOCK_CONFIG, STOCK_MESSAGES } from './stockConfig.js';
import { cachePrice } from './stockDb.js';

// ============ TYPE DEFINITIONS ============

/**
 * Finnhub API quote response structure
 */
interface FinnhubQuoteResponse {
  c: number; // Current price
  d: number | null; // Change
  dp: number | null; // Change percent
  h: number; // High of day
  l: number; // Low of day
  o: number; // Open
  pc: number; // Previous close
  t: number; // Timestamp
}

/**
 * Normalized stock quote data
 */
export interface StockQuoteData {
  readonly ticker: string;
  readonly currentPrice: number;
  readonly change: number | null;
  readonly changePercent: number | null;
  readonly high: number;
  readonly low: number;
  readonly open: number;
  readonly previousClose: number;
  readonly timestamp: number;
}

/**
 * Result type for getQuote function
 */
export type QuoteResult =
  | { success: true; data: StockQuoteData }
  | { success: false; error: string };

// ============ API FUNCTIONS ============

/**
 * Fetch current stock quote from Finnhub API
 * @param ticker - Stock ticker symbol (e.g., "AAPL")
 * @returns Quote result with data on success or error message on failure
 */
export async function getQuote(ticker: string): Promise<QuoteResult> {
  const apiKey = process.env.FINNHUB_API_KEY;

  if (!apiKey) {
    console.error('FINNHUB_API_KEY not configured');
    return { success: false, error: STOCK_MESSAGES.API_NOT_CONFIGURED };
  }

  const normalizedTicker = ticker.toUpperCase().trim();
  const url = `${STOCK_CONFIG.API_BASE_URL}/quote?symbol=${normalizedTicker}&token=${apiKey}`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), STOCK_CONFIG.API_TIMEOUT_MS);

    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      console.error(`Finnhub API error: ${response.status} ${response.statusText}`);
      return { success: false, error: STOCK_MESSAGES.API_ERROR };
    }

    const data = (await response.json()) as FinnhubQuoteResponse;

    // Finnhub returns { c: 0, h: 0, l: 0, o: 0, pc: 0, d: null, dp: null } for invalid tickers
    if (data.c === 0 && data.pc === 0) {
      return { success: false, error: STOCK_MESSAGES.INVALID_TICKER };
    }

    // Cache price for leaderboard calculations (fire-and-forget)
    cachePrice(normalizedTicker, data.c).catch((err: unknown) =>
      console.error(`[STOCK] Failed to cache price for ${normalizedTicker}:`, err)
    );

    return {
      success: true,
      data: {
        ticker: normalizedTicker,
        currentPrice: data.c,
        change: data.d,
        changePercent: data.dp,
        high: data.h,
        low: data.l,
        open: data.o,
        previousClose: data.pc,
        timestamp: data.t,
      },
    };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      console.error('Finnhub API request timed out');
      return { success: false, error: 'Request timed out. Please try again.' };
    }
    console.error('Finnhub API error:', error);
    return { success: false, error: STOCK_MESSAGES.API_ERROR };
  }
}

// ============ VALIDATION FUNCTIONS ============

/**
 * Validate if a ticker appears to be a valid format
 * US tickers are 1-5 letters (case insensitive)
 * @param ticker - Stock ticker to validate
 * @returns True if valid format
 */
export function isValidTickerFormat(ticker: string | null | undefined): boolean {
  if (!ticker || typeof ticker !== 'string') {
    return false;
  }
  const tickerRegex = /^[A-Za-z]{1,5}$/;
  return tickerRegex.test(ticker.trim());
}
