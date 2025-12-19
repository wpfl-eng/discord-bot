// Finnhub API Integration
// Handles fetching real-time stock quotes

import { STOCK_CONFIG, STOCK_MESSAGES } from "./stockConfig.js";

/**
 * Fetch current stock quote from Finnhub API
 * @param {string} ticker - Stock ticker symbol (e.g., "AAPL")
 * @returns {Promise<{success: boolean, data?: object, error?: string}>}
 *
 * On success, data contains:
 * - ticker: Normalized ticker symbol
 * - currentPrice: Current price
 * - change: Dollar change from previous close
 * - changePercent: Percent change from previous close
 * - high: Day high
 * - low: Day low
 * - open: Opening price
 * - previousClose: Previous closing price
 * - timestamp: Quote timestamp
 */
export async function getQuote(ticker) {
  const apiKey = process.env.FINNHUB_API_KEY;

  if (!apiKey) {
    console.error("FINNHUB_API_KEY not configured");
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

    const data = await response.json();

    // Finnhub returns { c: 0, h: 0, l: 0, o: 0, pc: 0, d: null, dp: null } for invalid tickers
    if (data.c === 0 && data.pc === 0) {
      return { success: false, error: STOCK_MESSAGES.INVALID_TICKER };
    }

    return {
      success: true,
      data: {
        ticker: normalizedTicker,
        currentPrice: data.c, // Current price
        change: data.d, // Change
        changePercent: data.dp, // Change percent
        high: data.h, // High of day
        low: data.l, // Low of day
        open: data.o, // Open
        previousClose: data.pc, // Previous close
        timestamp: data.t, // Timestamp
      },
    };
  } catch (error) {
    if (error.name === "AbortError") {
      console.error("Finnhub API request timed out");
      return { success: false, error: "Request timed out. Please try again." };
    }
    console.error("Finnhub API error:", error);
    return { success: false, error: STOCK_MESSAGES.API_ERROR };
  }
}

/**
 * Validate if a ticker appears to be a valid format
 * US tickers are 1-5 uppercase letters
 * @param {string} ticker - Stock ticker to validate
 * @returns {boolean} - True if valid format
 */
export function isValidTickerFormat(ticker) {
  if (!ticker || typeof ticker !== "string") {
    return false;
  }
  const tickerRegex = /^[A-Za-z]{1,5}$/;
  return tickerRegex.test(ticker.trim());
}
