// Stock Trading Configuration
// Constants, limits, and helper functions for the /stock command

// ============ TYPE DEFINITIONS ============

export interface StockConfigType {
  readonly TRADE_MIN: number;
  readonly TRADE_MAX: number;
  readonly TRADE_COOLDOWN_SECONDS: number;
  readonly API_BASE_URL: string;
  readonly API_TIMEOUT_MS: number;
  readonly DECIMAL_PLACES_SHARES: number;
  readonly DECIMAL_PLACES_PRICE: number;
}

export interface StockMessagesType {
  readonly INVALID_TICKER: string;
  readonly API_ERROR: string;
  readonly API_NOT_CONFIGURED: string;
  readonly INSUFFICIENT_FUNDS: string;
  readonly INSUFFICIENT_SHARES: string;
  readonly NO_HOLDINGS: string;
  readonly COOLDOWN: (seconds: number) => string;
}

// ============ CONFIGURATION ============

export const STOCK_CONFIG: StockConfigType = {
  // Trade limits (coins)
  TRADE_MIN: 10,
  TRADE_MAX: 10000,

  // Cooldown between trades (seconds)
  TRADE_COOLDOWN_SECONDS: 30,

  // API configuration
  API_BASE_URL: 'https://finnhub.io/api/v1',
  API_TIMEOUT_MS: 5000,

  // Display precision
  DECIMAL_PLACES_SHARES: 6,
  DECIMAL_PLACES_PRICE: 2,
} as const;

// Error messages
export const STOCK_MESSAGES: StockMessagesType = {
  INVALID_TICKER:
    'Could not find stock ticker. Please use a valid US stock symbol (e.g., AAPL, MSFT, GOOGL).',
  API_ERROR: 'Unable to fetch stock price. Please try again later.',
  API_NOT_CONFIGURED: 'Stock trading is not configured. Please contact an admin.',
  INSUFFICIENT_FUNDS: "You don't have enough coins in your wallet!",
  INSUFFICIENT_SHARES: "You don't own enough shares to sell!",
  NO_HOLDINGS: "You don't own any shares of this stock.",
  COOLDOWN: (seconds: number): string => `Slow down! You can trade again in ${seconds} seconds.`,
};

// ============ HELPER FUNCTIONS ============

/**
 * Format share count for display (removes trailing zeros)
 */
export function formatShares(shares: number): string {
  return parseFloat(shares.toFixed(STOCK_CONFIG.DECIMAL_PLACES_SHARES)).toString();
}

/**
 * Format price for display with commas and 2 decimal places
 */
export function formatPrice(price: number): string {
  return price.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
