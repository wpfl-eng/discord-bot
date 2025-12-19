// Stock Trading Configuration
// Constants, limits, and helper functions for the /stock command

export const STOCK_CONFIG = {
  // Trade limits (coins)
  TRADE_MIN: 10,
  TRADE_MAX: 10000,

  // Cooldown between trades (seconds)
  TRADE_COOLDOWN_SECONDS: 30,

  // API configuration
  API_BASE_URL: "https://finnhub.io/api/v1",
  API_TIMEOUT_MS: 5000,

  // Display precision
  DECIMAL_PLACES_SHARES: 6,
  DECIMAL_PLACES_PRICE: 2,
};

// Error messages
export const STOCK_MESSAGES = {
  INVALID_TICKER:
    "Could not find stock ticker. Please use a valid US stock symbol (e.g., AAPL, MSFT, GOOGL).",
  API_ERROR: "Unable to fetch stock price. Please try again later.",
  API_NOT_CONFIGURED: "Stock trading is not configured. Please contact an admin.",
  INSUFFICIENT_FUNDS: "You don't have enough coins in your wallet!",
  INSUFFICIENT_SHARES: "You don't own enough shares to sell!",
  NO_HOLDINGS: "You don't own any shares of this stock.",
  COOLDOWN: (seconds) => `Slow down! You can trade again in ${seconds} seconds.`,
};

/**
 * Format share count for display (removes trailing zeros)
 * @param {number} shares - Number of shares
 * @returns {string} - Formatted share string
 */
export function formatShares(shares) {
  return parseFloat(shares.toFixed(STOCK_CONFIG.DECIMAL_PLACES_SHARES)).toString();
}

/**
 * Format price for display with commas and 2 decimal places
 * @param {number} price - Price in dollars/coins
 * @returns {string} - Formatted price string
 */
export function formatPrice(price) {
  return price.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
